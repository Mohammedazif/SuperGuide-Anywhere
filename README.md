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
Fill in the API key for your chosen model provider by hand; no secret value is ever
committed.

## Model providers

`SGA_MODEL_PROVIDER` selects who serves the planner and the injection classifier:

| Provider | Key variable | Planner | Classifier |
|---|---|---|---|
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `claude-opus-5` | `claude-haiku-4-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-5.5` | `gpt-5.4-mini` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-pro` | `gemini-2.5-flash` |

The agent loop, policy engine, and confirmation machinery are provider-neutral: the
loop speaks one internal message shape, and each provider translates requests and
responses at the edge (`apps/control-plane/src/agent/providers/`). Switching is one
`.env` line plus the matching key — no rebuild. The live test suites and `pnpm eval`
gate on the active provider's key and record which provider produced each result.
Reasoning state that must round-trip (encrypted reasoning items, thought signatures)
rides the turn history inside thinking blocks, so a turn is served end to end by the
provider that started it.

## Anonymous identity is weak, on purpose and on the record

The daily allowance is metered per device id, and the device id is an anonymous
`crypto.randomUUID()` generated at first run. Reinstalling the extension resets it, so the
identity is not a security boundary and the code does not pretend it is. Two mitigations
bound the abuse, not eliminate it: a second usage bucket counted per client IP per UTC day
(`SGA_DAILY_IP_QUOTA`), stored as a salted hash and expired daily, and rate-limited device
registration per IP on `/v1/device`. A reinstall loop from one machine therefore hits the
IP ceiling rather than yielding unlimited use, while a patient adversary rotating addresses
still gets more than one device's share.

What would actually fix it is sign-in: an account-backed identity (OAuth or email link)
that quota attaches to, with the anonymous tier kept as a low-limit trial. That is a
product decision with real costs — accounts, support, and the privacy posture of holding
emails — which is why it is recorded here as a known, deliberate weakness rather than
rediscovered later.
