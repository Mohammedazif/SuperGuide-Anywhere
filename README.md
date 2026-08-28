# SuperGuide Anywhere

An in-page resolution agent that ships as a browser extension. When a person is stuck on a
task in a web application they already use, the agent finishes the task — navigating the
product, operating its interface, asking the one question it genuinely needs, and reporting
honestly when it cannot.

Access is granted one site at a time, in two tiers: `observe` (the agent can read the page
and explain) and `control` (the agent can act, under confirmation rules). Entitlement is
decided by the server and only by the server.

This repository is the **Chrome extension**. The backend is SuperGuide's control plane
(`/v1/anywhere`). See `LOCAL_TESTING.md`.

## Quickstart

```
pnpm install
pnpm typecheck && pnpm lint && pnpm build
```

Load `apps/extension/dist` unpacked in Chrome. Point `sga.apiBase` at a running
SuperGuide control plane (`http://127.0.0.1:8080`). Model keys, Postgres, and
quota live in SuperGuide.

## Anonymous identity is weak, on purpose and on the record

The daily allowance is metered per device id, and the device id is an anonymous
`crypto.randomUUID()` generated at first run. Reinstalling the extension resets it, so the
identity is not a security boundary and the code does not pretend it is. Two mitigations
bound the abuse, not eliminate it: a second usage bucket counted per client IP per UTC day
(`SGA_DAILY_IP_QUOTA`), stored as a salted hash and expired daily, and rate-limited device
registration per IP on `/v1/anywhere/device`. A reinstall loop from one machine therefore hits the
IP ceiling rather than yielding unlimited use, while a patient adversary rotating addresses
still gets more than one device's share.

What would actually fix it is sign-in: an account-backed identity (OAuth or email link)
that quota attaches to, with the anonymous tier kept as a low-limit trial. That is a
product decision with real costs — accounts, support, and the privacy posture of holding
emails — which is why it is recorded here as a known, deliberate weakness rather than
rediscovered later.
