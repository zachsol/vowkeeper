import { FormEvent, useEffect, useMemo, useState } from "react";

type MemoryRule = {
  name: string;
  label: string;
  detail: string;
  source: string;
  updated_at?: string;
};

type AuditEvent = {
  id: string;
  ts: string;
  decision: string;
  summary: string;
};

type AppState = {
  seeded: boolean;
  provider: string;
  rules: MemoryRule[];
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
  allowed_budget: number;
};

const DEMO_REQUEST = "Hire Atlas Grid with a $5,000 budget and allow up to 5x leverage.";

const fallbackRules: MemoryRule[] = [
  { name: "leverage_ceiling", label: "Leverage ceiling", detail: "Never approve more than 2× leverage.", source: "Signed mandate · 18 Aug" },
  { name: "job_budget", label: "First-job cap", detail: "New providers may receive at most $2,000.", source: "Budget revision · 20 Aug" },
  { name: "atlas_incident", label: "Atlas Grid incident", detail: "Require a dry run before Atlas Grid can touch funds.", source: "Failed delivery · 22 Aug" },
];

async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

export default function App() {
  const [state, setState] = useState<AppState>({ seeded: false, provider: "Sibyl Memory", rules: [], events: [] });
  const [request, setRequest] = useState(DEMO_REQUEST);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [session, setSession] = useState(1);

  const visibleRules = state.rules.length ? state.rules : fallbackRules;
  const boundCount = state.seeded ? state.rules.length : 0;

  useEffect(() => {
    callApi<AppState>("/api/state")
      .then((payload) => {
        setState(payload);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, []);

  const decisionTone = useMemo(() => {
    if (!decision) return "idle";
    return decision.verdict.toLowerCase();
  }, [decision]);

  async function seedMemory() {
    setBusy(true);
    setDecision(null);
    try {
      const payload = await callApi<AppState>("/api/demo/seed", { method: "POST" });
      setState(payload);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  }

  async function openFreshSession(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    try {
      const result = await callApi<Decision>("/api/session/evaluate", {
        method: "POST",
        body: JSON.stringify({ request }),
      });
      setDecision(result);
      setSession((value) => value + 1);
      const nextState = await callApi<AppState>("/api/state");
      setState(nextState);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <nav className="topbar" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="Vowkeeper home">
          <span className="brand-seal">V</span>
          <span>Vowkeeper</span>
        </a>
        <div className="nav-meta">
          <span className={offline ? "status offline" : "status"}><i /> {offline ? "API offline" : "Sibyl connected"}</span>
          <a href="#proof">Proof path</a>
          <a href="https://github.com/Sibyl-Labs/Sibyl-Memory" target="_blank" rel="noreferrer">Memory engine ↗</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Persistent mandate agent / session {String(session).padStart(2, "0")}</p>
          <h1>Your agent forgot the conversation.<br /><em>It did not forget the boundary.</em></h1>
          <p className="lede">Vowkeeper recalls the limits you signed, the providers who failed, and the permissions you revoked—then changes the next decision before money moves.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={state.seeded ? () => openFreshSession() : seedMemory} disabled={busy}>
              {busy ? "Reading the record…" : state.seeded ? "Open a fresh session" : "Bind the demo mandate"}
            </button>
            <span>{state.seeded ? `${boundCount} durable memories ready` : "Writes three real Sibyl entities"}</span>
          </div>
        </div>
        <aside className="case-index" aria-label="Case file summary">
          <span className="case-tab">CASE / VK-0826</span>
          <dl>
            <div><dt>Principal</dt><dd>Demo investor 01</dd></div>
            <div><dt>Memory tier</dt><dd>WARM / entities</dd></div>
            <div><dt>Decision log</dt><dd>COLD / journal</dd></div>
            <div><dt>Storage</dt><dd>Local SQLite</dd></div>
          </dl>
          <div className="fingerprint" aria-hidden="true"><span /><span /><span /><span /></div>
          <p>Memory contents stay on the agent's machine. No embeddings. No remote retrieval service.</p>
        </aside>
      </section>

      <section className="decision-lab" id="proof">
        <header className="section-heading">
          <div><span>Fresh-session test</span><h2>Watch the answer change.</h2></div>
          <p>The request below looks acceptable to a stateless agent. Vowkeeper retrieves the signed record before it answers.</p>
        </header>

        <div className="lab-grid">
          <section className="memory-ledger">
            <header><span>Remembered before this session</span><strong>{boundCount || "—"} active</strong></header>
            <div className="thread" aria-hidden="true" />
            {visibleRules.map((rule, index) => (
              <article className={state.seeded ? "memory-card bound" : "memory-card preview"} key={rule.name} style={{ "--order": index } as React.CSSProperties}>
                <span className="pin">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{rule.label}</h3><p>{rule.detail}</p><small>{state.seeded ? rule.source : "Preview · not yet written"}</small></div>
              </article>
            ))}
          </section>

          <form className="request-panel" onSubmit={openFreshSession}>
            <header><span>Incoming request</span><strong>new context</strong></header>
            <label htmlFor="request">What should the agent do?</label>
            <textarea id="request" value={request} onChange={(event) => setRequest(event.target.value)} rows={5} />
            <div className="counterfactual">
              <span>Without recall</span>
              <strong>APPROVE · $5,000 · 5×</strong>
              <small>No prior boundary is present in the prompt.</small>
            </div>
            <button disabled={busy || !state.seeded}>{busy ? "Evaluating…" : "Evaluate in a fresh session"}</button>
            {!state.seeded && <p className="form-note">Bind the demo mandate first. The decision button stays locked until Sibyl confirms the writes.</p>}
          </form>

          <section className={`decision-panel ${decisionTone}`} aria-live="polite">
            <header><span>Decision after recall</span><strong>{decision?.session_id.slice(0, 8) ?? "waiting"}</strong></header>
            {decision ? (
              <>
                <div className="verdict-mark"><span>{decision.verdict}</span><b>{decision.allowed_budget ? `$${decision.allowed_budget.toLocaleString()} max` : "no funds released"}</b></div>
                <h3>{decision.headline}</h3>
                <p>{decision.explanation}</p>
                <div className="match-list">
                  {decision.matches.map((match) => <span key={match.name}>↳ {match.label}</span>)}
                </div>
              </>
            ) : (
              <div className="empty-decision">
                <span>∅</span>
                <p>No decision yet. Start a fresh session to prove that durable memory changes the outcome.</p>
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="proof-strip">
        <span>Eligibility proof</span>
        <div><b>01</b><p>Persist a material boundary</p></div>
        <i>→</i>
        <div><b>02</b><p>Destroy transient context</p></div>
        <i>→</i>
        <div><b>03</b><p>Recall in a fresh session</p></div>
        <i>→</i>
        <div><b>04</b><p>Change the decision</p></div>
      </section>

      <section className="audit-section">
        <header className="section-heading">
          <div><span>Append-only evidence</span><h2>The reason survives the answer.</h2></div>
          <p>Every evaluation records what was requested, which memories were applied, and what Vowkeeper allowed.</p>
        </header>
        <div className="audit-log">
          {state.events.length ? state.events.map((entry) => (
            <article key={entry.id}>
              <time>{new Date(entry.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
              <span className={`audit-verdict ${entry.decision.toLowerCase()}`}>{entry.decision}</span>
              <p>{entry.summary}</p>
              <code>{entry.id.slice(0, 12)}</code>
            </article>
          )) : <p className="audit-empty">The journal is empty. Complete the fresh-session test to create the first evidence entry.</p>}
        </div>
      </section>

      <footer>
        <div><strong>Vowkeeper</strong><span>Memory that holds the line.</span></div>
        <p>Built for the Sibyl Labs Hackathon 2026 · Working prototype</p>
      </footer>
    </main>
  );
}
