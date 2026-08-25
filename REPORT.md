# Final report — SuperGuide Anywhere build

Produced per §17.4 of the build specification, after the §17.3 acceptance run on a
clean clone (`git clone` into a fresh directory, no prior build). Every result below
is as actually observed.

## 17.3 command results (clean clone)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS (3.2s, lockfile respected) |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS (0 errors, 0 warnings, `--max-warnings 0`) |
| `pnpm build` | PASS (4 IIFE bundles + static files in `apps/extension/dist`) |
| `pnpm test:unit` | PASS — 15 files, 111 tests |
| `docker compose up -d` | **SUBSTITUTED** — docker is not installed on this machine. The committed `docker-compose.yml` provides the same PostgreSQL 16 on 55433 for CI; locally the dockerless equivalent `pnpm db:start` serves an identical instance, which was already running and was used. |
| `pnpm db:migrate` | PASS — "migrations already up to date" (4 migrations applied) |
| `pnpm test:integration` | PASS — 31 tests, 1 skipped (the live cache test; see below) |
| `pnpm test:security` | PASS — 19 tests, 1 skipped (the live injection corpus; see below) |
| `pnpm exec playwright install chromium` | PASS (fallback build; OS not officially supported by Playwright) |
| `pnpm test:e2e` | PASS — 12 tests, 5 skipped (the live-model specs; see below) |
| `pnpm eval --adapters=on` | **FAIL, honestly** — exits 1: "ANTHROPIC_API_KEY is not set. The eval suite runs the live model and cannot produce an honest result without it." |
| `pnpm eval --adapters=off` | **FAIL, honestly** — same reason |
| `pnpm check:forbidden` | PASS — 13 rules over the tree, no hit |
| `pnpm check:manifest` | PASS — source and built manifest match §7.4 exactly |
| `pnpm check:bundle-boundary` | PASS — no `contract/internal` marker, no unbundled CommonJS require |
| `pnpm package` | PASS — `dist-package/superguide-anywhere.zip` |
| `pnpm check:package` | PASS — 7 entries; no map, no env, no test/fixture/adapter file, no remote code |

**The build is not complete under §17.4's own standard**: the two eval commands did
not pass, because `ANTHROPIC_API_KEY` is blank in `.env`. Everything that can run
without a live model passed. The single unblocking step is a key in `.env`; the live
suites then run as written.

## What is blocked on the key, exactly

Self-gating (each skips or refuses with an explicit message, never fakes a pass):

- `tests/integration/model-cache.test.ts` — `cache_read_input_tokens > 0` on the
  second turn against the live API.
- `tests/security/injection-corpus.test.ts` — six hostile pages, real model and real
  classifier; asserts no `write`/`sensitive` action and no confirmation request in
  any trajectory.
- `tests/e2e/agent-task.spec.ts` — one real task end to end against the fixture app
  under an observe grant, every trajectory step asserted.
- `tests/e2e/ladder.spec.ts` — live L1 (capability + confirmation + satisfied
  predicate + real state change), L2 (route navigation), L3 (grounded action on a
  page no capability covers), and L3 again on interface variant B.
- `pnpm eval --adapters=on|off` — the thirty-task suite.

## Eval pass rates

Not produced: the suite refuses to run without the key rather than fabricate a
result. The harness, the thirty versioned task fixtures, per-task reporting (outcome,
ladder level, steps, tokens, latency), the fixed retry count (1), and the documented
thresholds (80% adapters-on, 60% adapters-off) are implemented in `eval/`.

## §15.4 security rows and results

| Row | Where | Result |
|---|---|---|
| No blanket host access | `tests/security/static-surface.test.ts` | PASS — no `<all_urls>`, no `host_permissions` key |
| Unactivated origin | `tests/e2e/activation.spec.ts` ("nothing is injected before activation", "an origin that was never activated gets nothing") | PASS |
| Permission revoked | `tests/e2e/activation.spec.ts` ("deactivation revokes the permission and removes the grant") | PASS |
| CSP untouched | `tests/e2e/surface.spec.ts` — header at the browser asserted byte-identical to the served header | PASS |
| Main world | `tests/security/static-surface.test.ts` + eslint rule | PASS |
| Remote code | `tests/security/static-surface.test.ts` + `check:package` | PASS |
| Password field | `tests/security/refusals.test.ts` (both refusals) | PASS |
| Observe grant, server | `tests/security/refusals.test.ts` — fast-check property, 500 runs | PASS |
| Observe grant, client | `tests/security/refusals.test.ts` — executor refuses with the server bypassed | PASS |
| Tier downgrade mid-turn | `tests/e2e/surface.spec.ts` — second action refused `grant_insufficient` in a real browser, page does not move | PASS |
| Digest redaction | `tests/security/refusals.test.ts` + redaction corpus in `packages/observer` | PASS |
| Injection corpus | `tests/security/injection-corpus.test.ts` | SKIPPED — live model required |
| Closed vocabulary | `tests/security/refusals.test.ts` — unknown kind refused `unknown_action` before dispatch | PASS |
| Confirmation scope | `tests/security/refusals.test.ts` + `tests/integration/confirmation.test.ts` | PASS |
| Params tampering | same two files | PASS |
| Action idempotency | `tests/security/entitlement.test.ts` + `tests/integration/confirmation.test.ts` | PASS |
| Quota is server-side | `tests/security/entitlement.test.ts` — a client `usage` claim is rejected as an unknown wire field (400); past the limit the server answers 429 regardless | PASS |
| Quota without release | `tests/security/entitlement.test.ts` + browser proof below | PASS |
| Origin rejection | `tests/security/entitlement.test.ts` — 403 on POST and on SSE, with a wrong origin and with none | PASS |
| Bundle boundary | `tests/security/static-surface.test.ts` + `check:bundle-boundary` | PASS |
| Forbidden patterns | `tests/security/static-surface.test.ts` + `check:forbidden` | PASS |

## The permission set in the built manifest, quoted

From `apps/extension/dist/manifest.json` (and the packaged zip, byte-identical):

```json
"permissions": ["activeTab", "scripting", "storage"],
"optional_host_permissions": ["*://*/*"]
```

No `host_permissions` key exists. `check:manifest` asserts this exact set and fails
on any drift, including a doctored copy (verified in Phase 2 with a deliberately
broken manifest).

## The observe-grant result

**Input space of the property test** (`tests/security/refusals.test.ts`, 500 runs,
mirrored in `packages/policy/src/policy.test.ts`): every state-changing action kind
(`click`, `type`, `check`, `focus`, `scrollIntoView`, `navigate`, and `select` in the
policy-package variant) with arbitrary targets and values × every risk class
(`read`, `write`, `sensitive`) × adapter matched or not × confirmation absent,
approved, declined, bound to the right or a wrong action id, with the right or a
wrong params hash. For every combination under tier `observe`, `evaluatePolicy`
returns exactly `{ kind: "refuse", reason: "grant_insufficient" }`.

**The two refusal points, both exercised:**
1. Server: `evaluatePolicy` (the property test above), which runs before any action
   is sent to the extension — verified end-to-end in
   `tests/integration/agent-loop.test.ts`, where an observe-tier turn produces a
   refusal event and no dispatch.
2. Client: the executor refuses a state-changing action under an observe grant even
   when handed one directly (`tests/security/refusals.test.ts`), and in a real
   browser the mid-turn downgrade test shows the executor refusing an action the
   worker dispatched (`tests/e2e/surface.spec.ts`).

## Quota changed server-side, no extension release

- Browser proof (`tests/e2e/surface.spec.ts`): the popup shows "0 of 20 tasks used
  today"; the control plane process is stopped and restarted on the same port with
  `SGA_DAILY_TASK_QUOTA=5` — the same built extension, untouched — and the popup
  shows "0 of 5 tasks used today". PASS.
- API proof (`tests/security/entitlement.test.ts`): two server instances with
  `SGA_DAILY_TASK_QUOTA=2` and `=1` report limits 2 and 1 on `/v1/quota`. PASS.
- The extension carries no numeric quota constant, no usage counter consulted before
  sending, and no client-trusted field — enforced by `check:forbidden`'s
  client-entitlement rule and by the wire schema rejecting unknown fields.

## Not implemented, and why

- **Live-model verification** (listed above) — `ANTHROPIC_API_KEY` is blank. It
  would take: putting a key in `.env`, then `pnpm test:integration`,
  `pnpm test:security`, `pnpm test:e2e`, `pnpm eval --adapters=on`,
  `pnpm eval --adapters=off`.
- **`/v1/stop` server route** — §10.1's route table has no stop route, so stop is a
  client-side guarantee: the worker tears the session down and the next action is
  never executed (proven in e2e). The server loop times out on the unanswered
  action and reports honestly. A server-side stop that also refuses the pending
  action immediately would take one authenticated route and a loop check.
- **Pause across a service-worker death** — held actions and the paused flag live in
  the worker; if Chrome kills it mid-pause, the held action is lost and the server
  times out into an honest failure. Persisting them to `chrome.storage.session`
  would remove the gap.
- **`readBack` returns text content only** — input values are not read back;
  observation of values goes through the digest's allowlist mechanism instead.

## Deviations from the specification, and why

1. **`POST /v1/erase` added beyond §10.1's route table** — §13.2 requires a deletion
   path and a test for it. The route calls one owner-defined SQL function; the
   append-only trigger admits DELETE only under that function's transaction-local
   flag, so every ordinary path stays append-only (both tested).
2. **`SGA_AGENT_LOOP` and `SGA_ADAPTERS` added beyond §6.3's table** — the first is
   the test seam that lets transport e2e drive turn events deterministically without
   a live model; the second is how `pnpm eval --adapters=off` exists at all.
   Defaults (`on`) preserve specified behavior.
3. **`needs-input` added to turn-end statuses** — §8's L4 ends a turn by asking one
   question; the closed status set (`completed|failed|refused|stopped`) had no honest
   value for it. `completed` would count quota for an unanswered question; `failed`
   would be false. The enum and the `turn` CHECK constraint gained the value.
4. **e2e host permissions are pre-held in a staged test manifest** — Chrome's
   optional-permission dialog cannot be automated. The staged copy (built at test
   time, never shipped) pre-holds `http://127.0.0.1/*` only; the shipped manifest is
   unchanged and asserted so. Consequence: the dialog itself is the one UI surface
   e2e cannot cover, and install-time-held hosts cannot be revoked at runtime, so the
   deactivation test asserts grant removal and non-injection rather than
   `permissions.contains`.
5. **Dockerless PostgreSQL for local development** — docker is absent on this
   machine. `pnpm db:start` provisions the same PostgreSQL 16 on the same port with
   the same roles; `docker-compose.yml` ships and CI uses a postgres:16 service.
6. **The classification tier sends `output_config.effort: "low"` to
   `claude-haiku-4-5`** as §12 directs. If the live API rejects `effort` on that
   model, the scanner fails closed (content treated as suspect) and the loop
   continues; the first live run will show which. The failure mode is safe either
   way.
7. **Commit messages carry no attribution trailer** — per the operator's standing
   instruction, overriding the default tooling trailer.

## Where things stand

Phases 0 through 9 are committed in order, each with its acceptance verified to the
extent possible without a live model key: 111 unit tests, 31 integration tests, 19
security tests, 12 browser e2e tests, and every mechanical check pass on a clean
clone. The remaining distance to "complete" is exactly one secret and five live
suites that are already written and self-gating.

## Follow-up, 2026-08-25: multi-provider planners

The operator asked for switchable model providers. `SGA_MODEL_PROVIDER` now selects
`anthropic` (default, unchanged behavior), `openai`, or `gemini`, each with its own
key variable. The loop, policy engine, and confirmation machinery did not change:
the loop keeps one internal message shape, and a provider module translates requests
and responses at the edge, including round-tripping the reasoning state each vendor
requires back on later turns (encrypted reasoning items; thought signatures). The
translation layer has 15 offline unit tests.

Changes worth the record:

1. **The closed tool schemas gained explicit `type` on every `const`/`enum` node.**
   A live probe showed the second provider's strict mode rejects a schema node
   without a `type` key. The schemas remain byte-stable per build (unit-asserted)
   and equally valid for every provider.
2. **"openai" left the forbidden-vendor list.** The list exists to keep third-party
   product names out of the source; an integrated model provider is the same class
   as the existing one, which was never listed. The list still guards everything else.
3. **The injection corpus now fails when a turn never reaches the model.** A dead
   key produced turns with zero actions, which the no-risky-actions assertions
   passed vacuously. Each corpus turn must now record at least one model response.
4. **`pnpm test:e2e` loads `.env`** like every other suite, so the provider
   selection and key reach the browser tests and the spawned control plane.
5. **A pre-existing race in the stop e2e test was fixed**: the navigate result row
   lands before the new document does, so the badge click could fire before the
   re-injected content script mounted. The test now waits for the panel host.

**Live results, as observed on 2026-08-25:** the operator supplied an OpenAI key
and selected `openai`. The key authenticates, and with the schema fix the planner
request passes validation — but every call returns `insufficient_quota`: the OpenAI
account has no available credit. Consequently `pnpm test:integration` runs 31/32
with the live cache test failing on that error, and `pnpm test:security` runs 19/20
with the corpus failing at the new never-reached-the-model guard — both honest
failures of the account state, not the code. The remaining live suites were not run
against a key known to be quota-dead. Gemini ships unit-tested but has no key and
has never been exercised live; its model ids are constants in
`apps/control-plane/src/agent/providers/gemini.ts` should they need bumping.

Unblocking is unchanged in shape: one working secret. Either add credit to the
OpenAI account, or set `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` and flip
`SGA_MODEL_PROVIDER`; then `pnpm test:integration`, `pnpm test:security`,
`pnpm test:e2e`, `pnpm eval --adapters=on`, and `pnpm eval --adapters=off` run as
written against the selected provider.
