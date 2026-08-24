// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { observe } from "./observe";
import { redactedValue } from "./redact";

const SECRET = ["not", "a", "real", "secret", "0123456789abcdef"].join("-");
const PASSWORD = ["not", "a", "real", "password"].join("-");
const CARD = ["not", "a", "real", "card", "number"].join("-");
const EMAIL = "dana@example.com";

function formDocument(): Document {
  return new DOMParser().parseFromString(
    `<html><body><form>
      <label>Email <input type="text" name="email" value="${EMAIL}"></label>
      <label>Password <input type="password" name="pw" value="${PASSWORD}"></label>
      <label>Card number <input type="text" name="card" value="${CARD}"></label>
      <label>API secret <textarea name="secret">${SECRET}</textarea></label>
      <label>Notes <input type="search" name="notes" value="${SECRET}"></label>
    </form></body></html>`,
    "text/html",
  );
}

describe("the redactor", () => {
  it("transmits no field value at all under the default empty allowlist", () => {
    const serialised = JSON.stringify(observe(formDocument()).digest);
    for (const canary of [SECRET, PASSWORD, CARD, EMAIL]) {
      expect({ canary, leaked: serialised.includes(canary) }).toEqual({ canary, leaked: false });
    }
  });

  it("transmits exactly the allowlisted field and nothing else", () => {
    const allowlist = new Set(["email"]);
    const serialised = JSON.stringify(observe(formDocument(), { valueAllowlist: allowlist }).digest);
    expect(serialised.includes(EMAIL)).toBe(true);
    for (const canary of [SECRET, PASSWORD, CARD]) {
      expect({ canary, leaked: serialised.includes(canary) }).toEqual({ canary, leaked: false });
    }
  });

  it("never transmits a password value, even when its field is allowlisted", () => {
    const allowlist = new Set(["password", "pw"]);
    const serialised = JSON.stringify(observe(formDocument(), { valueAllowlist: allowlist }).digest);
    expect(serialised.includes(PASSWORD)).toBe(false);
  });

  it("matches the allowlist on the accessible name, case-insensitively", () => {
    expect(
      redactedValue(
        { role: "textbox", inputType: "text", name: "  Billing City ", value: "Rotterdam" },
        new Set(["billing city"]),
      ),
    ).toBe("Rotterdam");
  });

  it("refuses values for roles that do not carry one", () => {
    expect(
      redactedValue(
        { role: "button", inputType: null, name: "save", value: "clicked" },
        new Set(["save"]),
      ),
    ).toBeUndefined();
  });

  it("refuses a value for a field with no accessible name", () => {
    expect(
      redactedValue({ role: "textbox", inputType: "text", name: "  ", value: "x" }, new Set([""])),
    ).toBeUndefined();
  });
});
