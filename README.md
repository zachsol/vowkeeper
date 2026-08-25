# Vowkeeper — memory that holds the line

Vowkeeper is a persistent mandate agent. It remembers the authority boundaries a user signed, provider failures, and revoked permissions, then applies them in a genuinely fresh session before funds can move.

The hackathon proof is deliberately simple:

1. Persist three material mandate rules with Sibyl Memory.
2. Start a new session with no copied conversation context.
3. Ask for a risky agent hire.
4. Retrieve the durable rules and change the decision from approval to blocked.
5. Write the decision and its memory evidence to the append-only journal.

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

## Prior work declaration

Vowkeeper is a new project created for the Sibyl Labs Hackathon. Product code in this repository begins with the hackathon build. The mandate and execution-safety problem was informed by earlier experimentation on Pactrail, but no Pactrail UI or source code was copied into this repository.

## License

MIT
