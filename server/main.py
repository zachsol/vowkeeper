from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sibyl_memory_client import MemoryClient


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("VOWKEEPER_MEMORY_DB", ROOT / "data" / "vowkeeper.db"))
TENANT_ID = os.getenv("VOWKEEPER_TENANT", "demo_investor_01")

app = FastAPI(title="Vowkeeper API", version="0.1.0")
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
        "kind": "threshold",
        "max_leverage": 2,
    },
    {
        "name": "job_budget",
        "label": "First-job cap",
        "detail": "New providers may receive at most $2,000.",
        "source": "Budget revision · 20 Aug",
        "kind": "budget",
        "max_budget": 2000,
    },
    {
        "name": "atlas_incident",
        "label": "Atlas Grid incident",
        "detail": "Require a dry run before Atlas Grid can touch funds.",
        "source": "Failed delivery · 22 Aug",
        "kind": "provider_condition",
        "provider": "atlas grid",
        "requires_dry_run": True,
    },
]


class DecisionRequest(BaseModel):
    request: str = Field(min_length=8, max_length=800)


def memory_client() -> MemoryClient:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return MemoryClient.local(DB_PATH, tenant_id=TENANT_ID)


def public_rule(entity: dict[str, Any]) -> dict[str, Any]:
    body = entity["body"]
    return {
        "name": entity["name"],
        "label": body["label"],
        "detail": body["detail"],
        "source": body["source"],
        "updated_at": entity.get("updated_at"),
    }


def parse_budget(text: str) -> int:
    match = re.search(r"\$\s*([\d,]+)", text)
    return int(match.group(1).replace(",", "")) if match else 0


def parse_leverage(text: str) -> float:
    match = re.search(r"(\d+(?:\.\d+)?)\s*[x×]", text, flags=re.IGNORECASE)
    return float(match.group(1)) if match else 1.0


def evaluate_request(text: str, entities: list[dict[str, Any]]) -> dict[str, Any]:
    lowered = text.lower()
    budget = parse_budget(text)
    leverage = parse_leverage(text)
    matched: list[dict[str, Any]] = []
    hard_block = False
    allowed_budget = budget

    for entity in entities:
        rule = entity["body"]
        if rule["kind"] == "threshold" and leverage > float(rule["max_leverage"]):
            matched.append(public_rule(entity))
            hard_block = True
        elif rule["kind"] == "budget" and budget > int(rule["max_budget"]):
            matched.append(public_rule(entity))
            allowed_budget = min(allowed_budget, int(rule["max_budget"]))
        elif rule["kind"] == "provider_condition" and rule["provider"] in lowered:
            matched.append(public_rule(entity))
            hard_block = True

    if hard_block:
        verdict = "BLOCKED"
        headline = "The old boundary overrules the new prompt."
        explanation = "Vowkeeper recalled a leverage ceiling and a provider-specific dry-run condition. No funds can be released until the request is reframed and the dry run succeeds."
        allowed_budget = 0
    elif allowed_budget < budget:
        verdict = "BOUND"
        headline = "The request is allowed only inside the remembered cap."
        explanation = f"The requested ${budget:,} exceeds the durable first-job limit. Vowkeeper reduced the authority envelope to ${allowed_budget:,}."
    else:
        verdict = "CLEARED"
        headline = "No remembered boundary conflicts with this request."
        explanation = "The request stays inside every durable mandate rule currently held for this principal."

    return {
        "verdict": verdict,
        "headline": headline,
        "explanation": explanation,
        "counterfactual": f"A stateless agent would approve ${budget:,} at {leverage:g}×.",
        "matches": matched,
        "requested_budget": budget,
        "allowed_budget": allowed_budget,
    }


def state_payload(client: MemoryClient) -> dict[str, Any]:
    rules = client.list_entities("mandate_rule", limit=20)
    events = []
    for event in client.read_events(limit=12):
        extra = event.get("extra") or {}
        if extra.get("event_type") != "decision":
            continue
        events.append(
            {
                "id": event["id"],
                "ts": event["ts"],
                "decision": extra.get("verdict", "RECORDED"),
                "summary": extra.get("summary", "Decision recorded"),
            }
        )
    return {
        "seeded": len(rules) == len(DEMO_RULES),
        "provider": "Sibyl Memory · local SQLite",
        "rules": [public_rule(rule) for rule in rules],
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
        acted=["bound three mandate rules"],
        extra={"event_type": "memory_seed", "count": len(DEMO_RULES)},
    )
    return state_payload(client)


@app.post("/api/session/evaluate")
def evaluate_session(payload: DecisionRequest) -> dict[str, Any]:
    client = memory_client()
    entities = client.list_entities("mandate_rule", status="active", limit=20)
    if not entities:
        raise HTTPException(status_code=409, detail="Bind at least one durable mandate rule before evaluation.")

    result = evaluate_request(payload.request, entities)
    session_id = str(uuid.uuid4())
    client.write_event(
        evaluated={"session_id": session_id, "request": payload.request, "memory_matches": [item["name"] for item in result["matches"]]},
        acted={"verdict": result["verdict"], "allowed_budget": result["allowed_budget"]},
        extra={
            "event_type": "decision",
            "verdict": result["verdict"],
            "summary": f"{result['verdict']}: {payload.request}",
        },
    )
    return {"session_id": session_id, **result}
