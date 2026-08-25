from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from sibyl_memory_client import MemoryClient, NotFoundError


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("VOWKEEPER_MEMORY_DB", ROOT / "data" / "vowkeeper.db"))
TENANT_ID = os.getenv("VOWKEEPER_TENANT", "demo_investor_01")

app = FastAPI(title="Vowkeeper API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4173", "http://127.0.0.1:4173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


DEMO_RULES = [
    {
        "name": "leverage_ceiling",
        "label": "Leverage ceiling",
        "detail": "Never approve more than 2× leverage.",
        "source": "Signed mandate · 18 Aug",
        "kind": "leverage",
        "max_leverage": 2,
    },
    {
        "name": "job_budget",
        "label": "Payment cap",
        "detail": "Any single provider payment may be at most $2,000.",
        "source": "Budget revision · 20 Aug",
        "kind": "budget",
        "max_budget": 2000,
    },
    {
        "name": "atlas_incident",
        "label": "Atlas Grid incident",
        "detail": "Block Atlas Grid until its dry run succeeds.",
        "source": "Failed delivery · 22 Aug",
        "kind": "provider_condition",
        "provider": "atlas grid",
    },
]


class DecisionRequest(BaseModel):
    request: str = Field(min_length=8, max_length=800)


class MandateRequest(BaseModel):
    kind: Literal["budget", "leverage", "provider_condition", "blocked_term"]
    label: str = Field(min_length=2, max_length=80)
    detail: str = Field(min_length=4, max_length=240)
    max_budget: int | None = Field(default=None, gt=0, le=100_000_000)
    max_leverage: float | None = Field(default=None, gt=0, le=100)
    provider: str | None = Field(default=None, max_length=80)
    blocked_term: str | None = Field(default=None, max_length=80)

    @model_validator(mode="after")
    def validate_control(self) -> "MandateRequest":
        required = {
            "budget": self.max_budget,
            "leverage": self.max_leverage,
            "provider_condition": self.provider,
            "blocked_term": self.blocked_term,
        }[self.kind]
        if required is None or (isinstance(required, str) and not required.strip()):
            raise ValueError(f"{self.kind} requires its control value")
        return self


def memory_client() -> MemoryClient:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return MemoryClient.local(DB_PATH, tenant_id=TENANT_ID)


def public_rule(entity: dict[str, Any]) -> dict[str, Any]:
    body = entity["body"]
    kind = "leverage" if body["kind"] == "threshold" else body["kind"]
    return {
        "name": entity["name"],
        "status": entity.get("status") or "active",
        "label": body["label"],
        "detail": body["detail"],
        "source": body.get("source", "Operator mandate"),
        "kind": kind,
        "max_budget": body.get("max_budget"),
        "max_leverage": body.get("max_leverage"),
        "provider": body.get("provider"),
        "blocked_term": body.get("blocked_term"),
        "updated_at": entity.get("updated_at"),
    }


def parse_budget(text: str) -> int:
    for pattern in (r"\$\s*([\d,]+)", r"([\d,]+)\s*(?:usd|dollars?)\b"):
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return int(match.group(1).replace(",", ""))
    return 0


def parse_leverage(text: str) -> float:
    match = re.search(r"(\d+(?:\.\d+)?)\s*[x×]", text, flags=re.IGNORECASE)
    return float(match.group(1)) if match else 1.0


def evaluate_request(text: str, entities: list[dict[str, Any]]) -> dict[str, Any]:
    lowered = text.lower()
    budget = parse_budget(text)
    leverage = parse_leverage(text)
    matched: list[dict[str, Any]] = []
    blocking_labels: list[str] = []
    allowed_budget = budget

    for entity in entities:
        rule = entity["body"]
        kind = rule["kind"]
        is_match = False
        blocks = False

        if kind in {"threshold", "leverage"} and leverage > float(rule["max_leverage"]):
            is_match, blocks = True, True
        elif kind == "budget" and budget > int(rule["max_budget"]):
            is_match = True
            allowed_budget = min(allowed_budget, int(rule["max_budget"]))
        elif kind == "provider_condition" and str(rule["provider"]).lower() in lowered:
            is_match, blocks = True, True
        elif kind == "blocked_term" and str(rule["blocked_term"]).lower() in lowered:
            is_match, blocks = True, True

        if is_match:
            matched.append(public_rule(entity))
            if blocks:
                blocking_labels.append(rule["label"])

    if blocking_labels:
        verdict = "BLOCKED"
        headline = "A remembered boundary stops this request."
        explanation = f"Blocked by {', '.join(blocking_labels)}. Change the request or restore the required authority before funds can move."
        allowed_budget = 0
    elif allowed_budget < budget:
        verdict = "BOUND"
        headline = "The request is allowed only inside the remembered cap."
        explanation = f"The requested ${budget:,} exceeds an active spending boundary. Vowkeeper reduced the authority envelope to ${allowed_budget:,}."
    else:
        verdict = "CLEARED"
        headline = "The request stays inside every active boundary."
        explanation = "No stored mandate conflicts with this request. The agent may continue inside the authority shown here."

    budget_label = f"${budget:,}" if budget else "no stated budget"
    return {
        "verdict": verdict,
        "headline": headline,
        "explanation": explanation,
        "counterfactual": f"A stateless agent sees {budget_label} at {leverage:g}× and has no earlier boundary to apply.",
        "matches": matched,
        "requested_budget": budget,
        "requested_leverage": leverage,
        "allowed_budget": allowed_budget,
    }


def state_payload(client: MemoryClient) -> dict[str, Any]:
    rules = client.list_entities("mandate_rule", limit=100)
    events = []
    for event in client.read_events(limit=30):
        extra = event.get("extra") or {}
        if extra.get("event_type") != "decision":
            continue
        events.append(
            {
                "id": event["id"],
                "ts": event["ts"],
                "decision": extra.get("verdict", "RECORDED"),
                "summary": extra.get("summary", "Decision recorded"),
                "request": extra.get("request", ""),
                "matches": extra.get("matches", []),
                "allowed_budget": extra.get("allowed_budget", 0),
                "session_id": extra.get("session_id", ""),
            }
        )
    public_rules = [public_rule(rule) for rule in rules]
    return {
        "provider": "Sibyl Memory · local SQLite",
        "rules": public_rules,
        "active_count": sum(rule["status"] == "active" for rule in public_rules),
        "revoked_count": sum(rule["status"] == "revoked" for rule in public_rules),
        "events": events,
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    client = memory_client()
    return {"status": "ok", "provider": "sibyl-memory-client", "schema": str(client.schema_version())}


@app.get("/api/state")
def get_state() -> dict[str, Any]:
    return state_payload(memory_client())


@app.post("/api/demo/seed")
def seed_demo() -> dict[str, Any]:
    client = memory_client()
    for rule in DEMO_RULES:
        client.set_entity("mandate_rule", rule["name"], rule, status="active")
    client.write_event(
        acted=["loaded example mandate boundaries"],
        extra={"event_type": "memory_seed", "count": len(DEMO_RULES)},
    )
    return state_payload(client)


@app.post("/api/mandates")
def create_mandate(payload: MandateRequest) -> dict[str, Any]:
    client = memory_client()
    slug = re.sub(r"[^a-z0-9]+", "_", payload.label.lower()).strip("_")[:42] or "mandate"
    name = f"{slug}_{uuid.uuid4().hex[:6]}"
    body = payload.model_dump(exclude_none=True)
    body["source"] = "Operator mandate · live"
    client.set_entity("mandate_rule", name, body, status="active")
    client.write_event(
        acted=[f"bound mandate {name}"],
        extra={"event_type": "mandate_bound", "rule": name},
    )
    return state_payload(client)


def set_mandate_status(rule_name: str, status: Literal["active", "revoked"]) -> dict[str, Any]:
    client = memory_client()
    try:
        entity = client.get_entity("mandate_rule", rule_name)
    except NotFoundError as error:
        raise HTTPException(status_code=404, detail="Mandate not found") from error
    client.set_entity("mandate_rule", rule_name, entity["body"], status=status)
    client.write_event(
        acted=[f"{status} mandate {rule_name}"],
        extra={"event_type": f"mandate_{status}", "rule": rule_name},
    )
    return state_payload(client)


@app.post("/api/mandates/{rule_name}/revoke")
def revoke_mandate(rule_name: str) -> dict[str, Any]:
    return set_mandate_status(rule_name, "revoked")


@app.post("/api/mandates/{rule_name}/restore")
def restore_mandate(rule_name: str) -> dict[str, Any]:
    return set_mandate_status(rule_name, "active")


@app.post("/api/session/evaluate")
def evaluate_session(payload: DecisionRequest) -> dict[str, Any]:
    client = memory_client()
    entities = client.list_entities("mandate_rule", status="active", limit=100)
    if not entities:
        raise HTTPException(status_code=409, detail="Bind at least one active mandate before evaluation.")

    result = evaluate_request(payload.request, entities)
    session_id = str(uuid.uuid4())
    match_names = [item["name"] for item in result["matches"]]
    client.write_event(
        evaluated={"session_id": session_id, "request": payload.request, "memory_matches": match_names},
        acted={"verdict": result["verdict"], "allowed_budget": result["allowed_budget"]},
        extra={
            "event_type": "decision",
            "session_id": session_id,
            "verdict": result["verdict"],
            "summary": f"{result['verdict']}: {payload.request}",
            "request": payload.request,
            "matches": match_names,
            "allowed_budget": result["allowed_budget"],
        },
    )
    return {"session_id": session_id, **result}
