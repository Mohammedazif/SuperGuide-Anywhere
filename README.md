# SuperGuide Anywhere

An in-page resolution agent that ships as a browser extension. When a person is stuck on a
task in a web application they already use, the agent finishes the task — navigating the
product, operating its interface, asking the one question it genuinely needs, and reporting
honestly when it cannot.

Access is granted one site at a time, in two tiers: `observe` (the agent can read the page
and explain) and `control` (the agent can act, under confirmation rules). Entitlement is
decided by the server and only by the server.

## Quickstart

```
pnpm install
pnpm env:init
docker compose up -d        # or: pnpm db:start (local PostgreSQL 16 without docker)
pnpm typecheck && pnpm lint
```

`pnpm env:init` writes `.env` from `.env.example` and generates the random signing key.
Fill in `ANTHROPIC_API_KEY` by hand; no secret value is ever committed.
