# Chrome Web Store listing — SuperGuide Anywhere

## Single purpose

SuperGuide Anywhere helps you finish a task on the website you are currently viewing:
it reads the page you activated it on, explains what to do, and — only on sites where
you separately enable control — performs the steps for you, asking before anything
that changes state.

That is the whole purpose. The extension does nothing on sites you have not
activated, requests no host access at install time, and captures no screenshots.

## Description

Stuck on a form, a settings page, or a checkout flow? Activate SuperGuide Anywhere on
that site and ask. The assistant reads the page's structure — never your other tabs —
and walks you through it. If you choose to enable control for a site, it can click
and type for you: every state-changing step is shown to you and waits for your
approval, and you can pause, stop, downgrade, or deactivate at any moment from the
panel, the toolbar popup, or the options page.

Honest by design:

- **You activate each site yourself.** Nothing runs anywhere else.
- **Observing and acting are separate permissions.** Activation grants read-only
  observing; acting is a second, explicit choice per site.
- **Risky actions always ask first.** Approval covers exactly one action — never a
  blanket "yes".
- **Page content is sent to our server** to be understood by the model when you ask
  for help on an activated site. Password values are never read, and no analytics or
  tracking of any kind exists. See the privacy policy for the full account,
  including how to delete your data.

## Permission justifications

- **activeTab** — lets the popup act on the tab you invoked it from, so activation
  applies to the site you are looking at.
- **scripting** — injects the helper panel into a site only after you activate that
  site.
- **storage** — remembers which sites you activated, each site's tier, and the
  anonymous device id, on your machine.
- **Optional host permission (`*://*/*`, granted per site by you)** — gives the
  extension access to a specific site only when you activate it there; nothing is
  requested at install.

## Data disclosure

The extension transmits user content: when you ask for help on an activated site,
the accessibility structure of that page (labels, headings, element states, URL,
title) and your typed task are sent to the SuperGuide Anywhere server to produce the
answer. This is disclosed as "website content" in the store's data-use form. No
personally identifying information is collected; the device identifier is random and
anonymous. Data is not sold, not shared, and not used for any purpose other than
answering your request; deletion is available from the options page.
