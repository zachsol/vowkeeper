# Vowkeeper — memory that holds the line

Vowkeeper is a persistent mandate agent. It remembers the authority boundaries a user signed, provider failures, and revoked permissions, then applies them in a genuinely fresh session before funds can move.

The working product loop is deliberately inspectable:

1. Create spending, leverage, provider, or phrase boundaries in the Mandate Vault.
2. Revoke or restore boundaries without erasing their history.
3. Start a new session with any natural-language task.
4. Retrieve active rules and return `CLEARED`, `BOUND`, or `BLOCKED`.
5. Show the exact memory path that changed the answer.
6. Write the decision and evidence to Sibyl's append-only COLD journal.

The included examples demonstrate all three verdicts, but the interface and API accept user-created mandates and requests rather than relying on a fixed demo outcome.

The interface includes a real-time canvas memory field: durable rules appear as flowing trajectories, and each verdict changes the field color and emits a decision shockwave. Reduced-motion preferences are respected.

## Stack

- React, TypeScript and Vite
- FastAPI
- `sibyl-memory-client`
- Local SQLite using Sibyl's WARM entity and COLD journal tiers

## Run locally

Requires Node.js 20+ and Python 3.10+.

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
```

Run the API and frontend in separate terminals:

```bash
source .venv/bin/activate
npm run api
```

```bash
npm run dev
```

Open `http://localhost:4173`.

## API

- `GET /api/state` — current mandates and decision receipts
- `POST /api/mandates` — bind a new persistent boundary
- `POST /api/mandates/{name}/revoke` — stop enforcing a boundary
- `POST /api/mandates/{name}/restore` — enforce it again
- `POST /api/session/evaluate` — evaluate a fresh-session request

## Prior work declaration

Vowkeeper is a new project created for the Sibyl Labs Hackathon. Product code in this repository begins with the hackathon build. The mandate and execution-safety problem was informed by earlier experimentation on Pactrail, but no Pactrail UI or source code was copied into this repository.

## License

MIT
