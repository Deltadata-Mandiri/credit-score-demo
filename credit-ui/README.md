# BRI Credit Decisioning — UI + Credentials Proxy

A simple blue-and-white web UI for the `credit_scoring_approval` Conductor workflow,
served by a zero-dependency Node **backend-for-frontend proxy** that keeps your
Orkes Conductor credentials **server-side**. The browser never receives the app
key/secret — it only calls the proxy's `/api/*` routes.

## Architecture

The same proxy exists in two forms — local dev and deployed — with identical routes:

```
LOCAL                                                        (npm run dev)
Browser (public/)  ──►  Node proxy (server.js)  ──►  Orkes Conductor
   form + result         holds key/secret,            /token, /workflow,
   (no secrets)          exchanges token,             /tasks signal
                         forwards whitelisted calls

DEPLOYED                                                (AWS Amplify Gen 2)
Browser (Amplify Hosting)  ──►  Lambda Function URL  ──►  Orkes Conductor
   static public/                 amplify/functions/
   apiBase from config.js         conductor-proxy/handler.ts
                                  secrets from SSM
```

Locally `API_BASE` is empty and `server.js` serves both the UI and `/api/*`.
In Amplify the build rewrites `public/config.js` with the deployed Function URL.

## Setup

1. **Node 18+** required (uses built-in `fetch`). No `npm install` needed.
2. Copy env and fill in credentials:
   ```
   cp .env.example .env
   ```
   Put your **rotated** Orkes Application key/secret in `.env`
   (Access Control → Applications). Never commit `.env`.
3. Start:
   ```
   node server.js
   ```
4. Open http://localhost:4000

## API (proxy)

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/applications` | Start the workflow with the application input; returns `{workflowId}` |
| GET  | `/api/applications/:id` | Status + output; `awaitingReview` true when paused on the manual-review WAIT task |
| POST | `/api/applications/:id/review` | Signal the underwriter decision to resume a borderline case |

## Deploying to AWS Amplify Gen 2

The backend is one Lambda behind a Function URL, defined in `amplify/`.

```
npm install
npx ampx sandbox secret set CONDUCTOR_SERVER_URL     # paste value, no trailing newline
npx ampx sandbox secret set CONDUCTOR_AUTH_KEY
npx ampx sandbox secret set CONDUCTOR_AUTH_SECRET
npx ampx sandbox                                     # deploy a personal sandbox
```

For a branch deploy, connect the repo in the Amplify console. `amplify.yml`
runs `ampx pipeline-deploy` and then regenerates `public/config.js` from
`amplify_outputs.json`, so the static UI picks up that branch's Function URL.
**Set the three secrets again per branch** (Amplify console → Hosting →
Secrets) — sandbox secrets are not shared with branch environments.

### Gotchas worth knowing

- `amplify/package.json` contains `{"type": "module"}`. Without it the Amplify
  CLI's TS loader silently falls back to CommonJS resolution and every backend
  deploy fails with a confusing `Cannot find module './functions/...'`.
- Set secrets with a pipe that emits **no BOM and no trailing newline**. A
  PowerShell `|` into `ampx` adds both, which corrupts the Conductor URL. The
  handler now scrubs values defensively, but clean input is better.

## Notes

- **Prototype / demo** — not a production system, and not affiliated with or an
  official product of Bank BRI. Styled with BRI-like blue/white colors only.
- `.env` is git-ignored. Rotate any credential that has ever been shared in chat/logs.
- The Function URL uses `authType: NONE` — it is publicly reachable, matching how
  `server.js` behaved on port 4000. The Conductor credentials never leave Lambda,
  but anyone with the URL can start a workflow. Put Cognito or WAF in front of it
  before this handles real applicant data.
- The decision letter PDF is generated on the Conductor server (a `file://` URI in
  the workflow output); the UI renders the Markdown letter directly.
