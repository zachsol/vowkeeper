import { FormEvent, useEffect, useMemo, useState } from "react";
import MemoryField from "./MemoryField";

type RuleKind = "budget" | "leverage" | "provider_condition" | "blocked_term";

type MemoryRule = {
  name: string;
  status: "active" | "revoked";
  label: string;
  detail: string;
  source: string;
  kind: RuleKind;
  max_budget?: number;
  max_leverage?: number;
  provider?: string;
  blocked_term?: string;
  updated_at?: string;
};

type AuditEvent = {
  id: string;
  ts: string;
  decision: string;
  summary: string;
  request: string;
  matches: string[];
  allowed_budget: number;
  session_id: string;
};

type AppState = {
  provider: string;
  rules: MemoryRule[];
  active_count: number;
  revoked_count: number;
  events: AuditEvent[];
};

type Decision = {
  session_id: string;
  verdict: "BLOCKED" | "BOUND" | "CLEARED";
  headline: string;
  explanation: string;
  counterfactual: string;
  matches: MemoryRule[];
  requested_budget: number;
  requested_leverage: number;
  allowed_budget: number;
};

type RuleDraft = { kind: RuleKind; label: string; detail: string; value: string };

const EXAMPLES = [
  { label: "Blocked", text: "Hire Atlas Grid with a $5,000 budget and allow up to 5x leverage." },
  { label: "Bound", text: "Pay a new research provider $6,500 with no leverage." },
  { label: "Cleared", text: "Pay a new research provider $1,200 with no leverage." },
];

const EMPTY_STATE: AppState = { provider: "Sibyl Memory", rules: [], active_count: 0, revoked_count: 0, events: [] };
const EMPTY_RULE: RuleDraft = { kind: "budget", label: "", detail: "", value: "" };

const KIND_META: Record<RuleKind, { label: string; valueLabel: string; placeholder: string }> = {
  budget: { label: "Spending cap", valueLabel: "Maximum USD", placeholder: "2000" },
  leverage: { label: "Leverage cap", valueLabel: "Maximum leverage", placeholder: "2" },
  provider_condition: { label: "Blocked provider", valueLabel: "Provider name", placeholder: "Atlas Grid" },
  blocked_term: { label: "Blocked phrase", valueLabel: "Phrase to stop", placeholder: "seed phrase" },
};

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    const raw = await response.text();
    try {
      const parsed = JSON.parse(raw) as { detail?: string | { msg?: string }[] };
      if (typeof parsed.detail === "string") throw new Error(parsed.detail);
      if (Array.isArray(parsed.detail)) throw new Error(parsed.detail[0]?.msg ?? "The request could not be completed.");
    } catch (error) {
      if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
    }
    throw new Error("The request could not be completed.");
  }
  return response.json() as Promise<T>;
}

function ruleControl(rule: MemoryRule) {
  if (rule.kind === "budget") return `$${rule.max_budget?.toLocaleString()} max`;
  if (rule.kind === "leverage") return `${rule.max_leverage}× max`;
  if (rule.kind === "provider_condition") return rule.provider;
  return `“${rule.blocked_term}”`;
}

export default function App() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [request, setRequest] = useState(EXAMPLES[0].text);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_RULE);
  const [showComposer, setShowComposer] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState("");

  const activeRules = state.rules.filter((rule) => rule.status === "active");
  const revokedRules = state.rules.filter((rule) => rule.status === "revoked");
  const matchedNames = useMemo(() => new Set(decision?.matches.map((rule) => rule.name) ?? []), [decision]);
  const requestSignals = useMemo(() => {
    const budget = request.match(/\$\s*([\d,]+)/)?.[1];
    const leverage = request.match(/(\d+(?:\.\d+)?)\s*[x×]/i)?.[1];
    return { budget: budget ? `$${Number(budget.replaceAll(",", "")).toLocaleString()}` : "not stated", leverage: leverage ? `${leverage}×` : "1× default" };
  }, [request]);

  useEffect(() => {
    callApi<AppState>("/api/state")
      .then((payload) => { setState(payload); setOffline(false); })
      .catch(() => setOffline(true));
  }, []);

  function showMessage(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2600);
  }

  async function seedMemory() {
    setBusy("seed");
    try {
      setState(await callApi<AppState>("/api/demo/seed", { method: "POST" }));
      setOffline(false);
      setDecision(null);
      showMessage("Example boundaries loaded into Sibyl Memory.");
    } catch (error) {
      setOffline(true);
      showMessage(error instanceof Error ? error.message : "Could not load examples.");
    } finally {
      setBusy(null);
    }
  }

  async function createRule(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    const body: Record<string, string | number> = { kind: draft.kind, label: draft.label, detail: draft.detail };
    if (draft.kind === "budget") body.max_budget = Number(draft.value);
    if (draft.kind === "leverage") body.max_leverage = Number(draft.value);
    if (draft.kind === "provider_condition") body.provider = draft.value;
    if (draft.kind === "blocked_term") body.blocked_term = draft.value;

    try {
      setState(await callApi<AppState>("/api/mandates", { method: "POST", body: JSON.stringify(body) }));
      setDraft(EMPTY_RULE);
      setShowComposer(false);
      setDecision(null);
      setOffline(false);
      showMessage("Boundary bound. It will apply to the next fresh session.");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Could not bind this boundary.");
    } finally {
      setBusy(null);
    }
  }

  async function changeRuleStatus(rule: MemoryRule) {
    const action = rule.status === "active" ? "revoke" : "restore";
    setBusy(rule.name);
    try {
      setState(await callApi<AppState>(`/api/mandates/${encodeURIComponent(rule.name)}/${action}`, { method: "POST" }));
      setDecision(null);
      showMessage(action === "revoke" ? "Boundary revoked. It no longer affects decisions." : "Boundary restored and active again.");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Could not update this boundary.");
    } finally {
      setBusy(null);
    }
  }

  async function evaluate(event: FormEvent) {
    event.preventDefault();
    setBusy("evaluate");
    setMessage("");
    try {
      const result = await callApi<Decision>("/api/session/evaluate", { method: "POST", body: JSON.stringify({ request }) });
      setDecision(result);
      setState(await callApi<AppState>("/api/state"));
      setOffline(false);
    } catch (error) {
      if (offline) setOffline(true);
      showMessage(error instanceof Error ? error.message : "The session could not be evaluated.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={`app-frame mode-${decision?.verdict.toLowerCase() ?? "idle"}`}>
      <MemoryField mode={decision?.verdict ?? "IDLE"} pulseKey={decision?.session_id} ruleCount={state.active_count} />
      <div className="scanlines" aria-hidden="true" />
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#workspace" aria-label="Vowkeeper home"><span className="brand-seal">V</span><span>Vowkeeper</span></a>
        <div className="nav-meta">
          <span className={offline ? "status offline" : "status"}><i />{offline ? "API offline" : "Sibyl connected"}</span>
          <a href="#audit">Audit log</a>
          <a href="https://github.com/zachsol/vowkeeper" target="_blank" rel="noreferrer">Source ↗</a>
        </div>
      </nav>

      <header className="workspace-header" id="workspace">
        <div>
          <p className="eyebrow">Persistent authority console</p>
          <h1>Give the agent a task.<br /><em>Keep your boundaries.</em></h1>
        </div>
        <p>Define what the agent may never exceed. Vowkeeper recalls those rules in every fresh session and records the reason behind each decision.</p>
        <dl className="system-readout">
          <div><dt>Active</dt><dd>{state.active_count}</dd></div>
          <div><dt>Revoked</dt><dd>{state.revoked_count}</dd></div>
          <div><dt>Decisions</dt><dd>{state.events.length}</dd></div>
        </dl>
        <div className="live-field-label" aria-hidden="true"><i /><span>Memory field / live</span><b>{String(state.active_count).padStart(2, "0")} nodes bound</b></div>
      </header>

      <section className="console-grid">
        <aside className="vault-panel">
          <header className="panel-heading">
            <div><span>01 / Authority</span><h2>Mandate vault</h2></div>
            <button className="icon-action" onClick={() => setShowComposer((value) => !value)} aria-expanded={showComposer}>{showComposer ? "Close" : "+ Add"}</button>
          </header>

          {showComposer && (
            <form className="rule-composer" onSubmit={createRule}>
              <label>Boundary type<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as RuleKind, value: "" })}>{Object.entries(KIND_META).map(([kind, meta]) => <option key={kind} value={kind}>{meta.label}</option>)}</select></label>
              <label>Name<input required minLength={2} placeholder="e.g. Research budget" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
              <label>{KIND_META[draft.kind].valueLabel}<input required type={draft.kind === "budget" || draft.kind === "leverage" ? "number" : "text"} min={draft.kind === "budget" || draft.kind === "leverage" ? "0.1" : undefined} step={draft.kind === "budget" ? "1" : "any"} placeholder={KIND_META[draft.kind].placeholder} value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>
              <label>Instruction<textarea required minLength={4} rows={3} placeholder="Write the boundary in plain language." value={draft.detail} onChange={(event) => setDraft({ ...draft, detail: event.target.value })} /></label>
              <button className="primary-action" disabled={busy === "create"}>{busy === "create" ? "Binding…" : "Bind boundary"}</button>
            </form>
          )}

          {!activeRules.length && !showComposer && (
            <div className="vault-empty"><span>∅</span><h3>No active boundaries</h3><p>Create one from scratch or load three examples to try the full flow.</p><button onClick={seedMemory} disabled={busy === "seed"}>{busy === "seed" ? "Loading…" : "Load examples"}</button></div>
          )}

          <div className="rule-stack">
            {activeRules.map((rule, index) => (
              <article className={`rule-card ${matchedNames.has(rule.name) ? "matched" : ""}`} key={rule.name}>
                <span className="rule-index">{String(index + 1).padStart(2, "0")}</span>
                <div><div className="rule-title"><h3>{rule.label}</h3><b>{ruleControl(rule)}</b></div><p>{rule.detail}</p><small>{rule.source}</small></div>
                <button onClick={() => changeRuleStatus(rule)} disabled={busy === rule.name}>Revoke</button>
              </article>
            ))}
          </div>

          {!!revokedRules.length && <button className="revoked-toggle" onClick={() => setShowRevoked((value) => !value)}>{showRevoked ? "Hide" : "Show"} {revokedRules.length} revoked</button>}
          {showRevoked && <div className="revoked-list">{revokedRules.map((rule) => <article key={rule.name}><div><strong>{rule.label}</strong><span>{ruleControl(rule)}</span></div><button onClick={() => changeRuleStatus(rule)} disabled={busy === rule.name}>Restore</button></article>)}</div>}
        </aside>

        <form className="session-panel" onSubmit={evaluate}>
          <header className="panel-heading"><div><span>02 / New context</span><h2>Decision session</h2></div><b>fresh / isolated</b></header>
          <label htmlFor="request">What should the agent do?</label>
          <textarea id="request" rows={7} minLength={8} required value={request} onChange={(event) => { setRequest(event.target.value); setDecision(null); }} />
          <div className="example-row" aria-label="Example requests">{EXAMPLES.map((example) => <button type="button" key={example.label} onClick={() => { setRequest(example.text); setDecision(null); }}>{example.label}</button>)}</div>
          <div className="signal-readout"><div><span>Budget detected</span><strong>{requestSignals.budget}</strong></div><div><span>Leverage detected</span><strong>{requestSignals.leverage}</strong></div><div><span>Rules available</span><strong>{state.active_count}</strong></div></div>
          <button className="evaluate-action" disabled={busy === "evaluate" || !state.active_count}>{busy === "evaluate" ? "Recalling memory…" : "Run memory check"}<span>↗</span></button>
          {!state.active_count && <p className="inline-help">Bind at least one boundary before starting a session.</p>}
        </form>

        <section className={`result-panel ${decision?.verdict.toLowerCase() ?? "idle"}`} aria-live="polite">
          <header className="panel-heading"><div><span>03 / Enforced answer</span><h2>Decision receipt</h2></div><b>{decision ? decision.session_id.slice(0, 8) : "waiting"}</b></header>
          {decision ? (
            <div className="decision-content">
              <div className="verdict"><span>{decision.verdict}</span><b>{decision.verdict === "BLOCKED" ? "No authority released" : decision.allowed_budget ? `$${decision.allowed_budget.toLocaleString()} authority` : "No stated budget"}</b></div>
              <h3>{decision.headline}</h3><p>{decision.explanation}</p>
              <div className="memory-path"><span>Memory path</span>{decision.matches.length ? decision.matches.map((rule) => <div key={rule.name}><i /> <strong>{rule.label}</strong><small>{ruleControl(rule)}</small></div>) : <p>No boundary was triggered.</p>}</div>
              <div className="counterfactual"><span>Without memory</span><p>{decision.counterfactual}</p></div>
            </div>
          ) : (
            <div className="receipt-empty"><div className="empty-seal"><i /><i /><i /></div><h3>No decision yet</h3><p>Run the request against your active mandate. The result and the exact memory path will appear here.</p></div>
          )}
        </section>
      </section>

      <section className="audit-section" id="audit">
        <header className="audit-heading"><div><p className="eyebrow">Append-only evidence</p><h2>Every answer leaves a receipt.</h2></div><p>Stored in Sibyl's COLD journal. Newest decision first.</p></header>
        <div className="audit-table">
          <div className="audit-header"><span>Time</span><span>Verdict</span><span>Request</span><span>Authority</span><span>Receipt</span></div>
          {state.events.length ? state.events.map((entry) => <article key={entry.id}><time>{new Date(entry.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time><b className={entry.decision.toLowerCase()}>{entry.decision}</b><p>{entry.request || entry.summary.replace(/^\w+: /, "")}</p><span>{entry.allowed_budget ? `$${entry.allowed_budget.toLocaleString()}` : "—"}</span><code>{entry.id.slice(0, 10)}</code></article>) : <div className="audit-empty">No receipts yet. Run your first memory check above.</div>}
        </div>
      </section>

      {message && <div className="toast" role="status">{message}</div>}
      <footer><div><strong>Vowkeeper</strong><span>Memory that holds the line.</span></div><p>{state.provider} · Built for Sibyl Labs Hackathon 2026</p></footer>
    </main>
  );
}
