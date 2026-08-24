import type { FixtureState } from "./store";

export type Variant = "a" | "b";
export type PageName = "dashboard" | "billing" | "team" | "profile" | "plan";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function heading(variant: Variant, text: string): string {
  return variant === "a"
    ? `<h1>${escapeHtml(text)}</h1>`
    : `<div role="heading" aria-level="1" class="hd-major">${escapeHtml(text)}</div>`;
}

function textField(variant: Variant, name: string, fieldId: string, value: string): string {
  const escaped = escapeHtml(value);
  return variant === "a"
    ? `<label>${escapeHtml(name)} <input type="text" name="${fieldId}" value="${escaped}"></label>`
    : `<div class="fld"><input type="text" name="${fieldId}" aria-label="${escapeHtml(name)}" value="${escaped}"></div>`;
}

function submitButton(variant: Variant, label: string): string {
  return variant === "a"
    ? `<button type="submit">${escapeHtml(label)}</button>`
    : `<span class="btnwrap"><input type="submit" value="${escapeHtml(label)}"></span>`;
}

function statusRegion(variant: Variant, text: string | null): string {
  if (text === null) return "";
  return variant === "a"
    ? `<p role="status">${escapeHtml(text)}</p>`
    : `<div class="note" role="status"><span>${escapeHtml(text)}</span></div>`;
}

function navigation(variant: Variant): string {
  const links: [string, string][] = [
    ["/", "Dashboard"],
    ["/settings/billing", "Billing"],
    ["/settings/team", "Team"],
    ["/settings/profile", "Profile"],
    ["/settings/plan", "Plan"],
  ];
  const items = links
    .map(([href, label]) =>
      variant === "a"
        ? `<li><a href="${href}">${label}</a></li>`
        : `<span class="navitem"><a href="${href}">${label}</a></span>`,
    )
    .join("");
  return variant === "a"
    ? `<nav aria-label="Main"><ul>${items}</ul></nav>`
    : `<div role="navigation" aria-label="Main"><div role="list" class="navrow">${items
        .replaceAll('<span class="navitem">', '<span class="navitem" role="listitem">')}</div></div>`;
}

function seatList(variant: Variant, state: FixtureState): string {
  const rows = state.seats
    .map((seat) => {
      const text = `${seat.email} — ${seat.role} — ${seat.status}`;
      return variant === "a"
        ? `<li>${escapeHtml(text)}</li>`
        : `<div role="listitem" class="seat-card">${escapeHtml(text)}</div>`;
    })
    .join("");
  return variant === "a"
    ? `<ul aria-label="Current seats">${rows}</ul>`
    : `<div role="list" aria-label="Current seats" class="seat-grid">${rows}</div>`;
}

function page(variant: Variant, title: string, body: string): string {
  const wrapper =
    variant === "a"
      ? `<main>${body}</main>`
      : `<div role="main" class="content-shell"><div class="inner">${body}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title><link rel="stylesheet" href="/app.css"></head><body>${navigation(
    variant,
  )}${wrapper}</body></html>`;
}

export function renderPage(
  name: PageName,
  state: FixtureState,
  variant: Variant,
  saved: boolean,
): string {
  switch (name) {
    case "dashboard": {
      const body =
        heading(variant, "Dashboard") +
        (variant === "a"
          ? `<p>Signed in as ${escapeHtml(state.profile.fullName)}. ${state.seats.length} seats on the ${state.plan} plan.</p>`
          : `<div class="lede"><p>Signed in as ${escapeHtml(state.profile.fullName)}. ${state.seats.length} seats on the ${state.plan} plan.</p></div>`);
      return page(variant, "Dashboard — Acme Workspace", body);
    }
    case "billing": {
      const body =
        heading(variant, "Billing address") +
        `<form method="post" action="/settings/billing">` +
        textField(variant, "Address line 1", "line1", state.billing.line1) +
        textField(variant, "City", "city", state.billing.city) +
        textField(variant, "Postal code", "postal", state.billing.postal) +
        submitButton(variant, "Save address") +
        `</form>` +
        statusRegion(variant, saved ? "Address saved" : null);
      return page(variant, "Billing — Acme Workspace", body);
    }
    case "team": {
      const body =
        heading(variant, "Team members") +
        seatList(variant, state) +
        `<form method="post" action="/settings/team/invite">` +
        textField(variant, "Email", "email", "") +
        submitButton(variant, "Invite member") +
        `</form>` +
        statusRegion(variant, saved ? "Invitation sent" : null);
      return page(variant, "Team — Acme Workspace", body);
    }
    case "profile": {
      const checkbox =
        variant === "a"
          ? `<label>Product updates <input type="checkbox" name="updates"${state.profile.productUpdates ? " checked" : ""}></label>`
          : `<div class="fld"><input type="checkbox" name="updates" aria-label="Product updates"${state.profile.productUpdates ? " checked" : ""}></div>`;
      const body =
        heading(variant, "Profile") +
        `<form method="post" action="/settings/profile">` +
        textField(variant, "Full name", "fullName", state.profile.fullName) +
        textField(variant, "Email", "email", state.profile.email) +
        checkbox +
        submitButton(variant, "Save profile") +
        `</form>` +
        statusRegion(variant, saved ? "Profile saved" : null);
      return page(variant, "Profile — Acme Workspace", body);
    }
    case "plan": {
      const target = state.plan === "growth" ? "Scale" : "Growth";
      const body =
        heading(variant, "Plan") +
        (variant === "a"
          ? `<p>Current plan: ${state.plan}</p>`
          : `<div class="lede"><p>Current plan: ${state.plan}</p></div>`) +
        `<form method="post" action="/settings/plan">` +
        submitButton(variant, `Switch to ${target}`) +
        `</form>` +
        statusRegion(variant, saved ? "Plan changed" : null);
      return page(variant, "Plan — Acme Workspace", body);
    }
    default: {
      const exhausted: never = name;
      throw new Error(`unreachable page ${JSON.stringify(exhausted)}`);
    }
  }
}
