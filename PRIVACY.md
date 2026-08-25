# Privacy Policy — SuperGuide Anywhere

SuperGuide Anywhere helps you finish a task on a website you choose, by reading the
page's structure and, only with your explicit permission, acting on it. This policy
says exactly what leaves your browser, where it goes, why, and how to delete it.

## What is transmitted, and to where

**Page content leaves your device.** When you ask the agent for help on a site you
activated, the extension builds an accessibility digest of that page — the visible
structure: element roles, labels, headings, and states — and sends it to the
SuperGuide Anywhere server so the model can understand the page and answer you. This
is not buried in fine print because it is the central fact of how the product works:
if you activate a site and ask for help there, the structure of that page is
transmitted.

What is sent, per task, from activated sites only:

- The task you typed.
- The accessibility digest of the current page: roles, accessible names, element
  states, headings, and the page URL and title.
- The results of actions you approved, as digests of the changed page.

What is never sent:

- Anything from a site you did not activate. No content script runs there, no digest
  is built, and no network request mentions it.
- Password field values, ever. Values of other form fields are excluded unless a
  reviewed adapter explicitly allowlists a named field; the default allowlist is
  empty.
- Screenshots. The extension contains no screen or pixel capture of any kind.
- Browsing history, cookies, or anything from your other tabs.

## Identity

The extension generates a random device id at first run. It is anonymous, is not
linked to an account, an email address, or a profile, and exists to meter daily
usage. Reinstalling the extension resets it.

## Retention and deletion

The server keeps a per-task trajectory — the digests, decisions, and outcomes needed
to explain what the agent did — associated with your device id. To delete it, use
"Delete my data" on the options page (or contact us with your device id, shown on
the same page); the trajectory and the device record are removed. Uninstalling the
extension removes everything stored locally.

## What we do not do

- No analytics, no session replay, no advertising, and no sale or sharing of data.
- No telemetry containing page content or URLs. The only permitted metric is a crash
  counter with no page-derived fields.
- No remotely hosted code. Everything the extension runs ships in the reviewed
  package.

## Permissions, each with its reason

- `activeTab` — to let the popup act on the tab you invoked it from when you
  activate a site.
- `scripting` — to inject the helper interface into a site only after you activate
  it there.
- `storage` — to remember your activated sites, their tiers, and the device id, on
  your machine.
- Optional host access (granted per site, by you) — to let the extension see and,
  with a control grant, act on the specific sites you choose. Nothing is requested
  at install time.
