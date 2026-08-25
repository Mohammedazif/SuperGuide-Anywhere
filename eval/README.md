# Eval harness

Thirty tasks in `tasks/`, versioned as fixtures. Each declares the opening page and
interface variant, the grant tier, the task text, the expected resolution level, the
expected outcome, and the verification predicate. A task passes only when its
predicate is satisfied against real fixture-app state — a page fetched after the run
must contain (or must not contain) the declared needles, the final URL must match
when declared, and the answer must mention the declared fact. A plausible-looking
transcript with unverified state is a failure.

Run:

```
pnpm eval --adapters=on
pnpm eval --adapters=off
```

Each run spawns the control plane with the agent loop live (`ANTHROPIC_API_KEY`
required), a fresh fixture app per task so seed state is deterministic, and the
built extension in a real Chromium. Confirmations are approved automatically. Results
land in `results/adapters-{mode}.json` with per-task outcome, ladder levels used,
step count, token cost, and wall-clock latency.

Determinism: the deterministic layers — policy, predicate evaluation, adapter
matching tie-breaks, the digest differ — are covered by exact unit and
recorded-transcript integration tests (`tests/integration/agent-loop.test.ts`,
`tests/integration/agent-ladder.test.ts`) that are fully reproducible. The
model-dependent layers run live here with a **fixed retry count of 1** per task and
a **documented pass-rate threshold: 80% with adapters on, 60% with adapters off**.
A rate below the threshold fails the suite; flakiness is not retried away beyond the
single fixed retry.
