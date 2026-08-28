import { describe, expect, it } from "vitest";
import { originFromPattern, originPattern } from "./registration";

describe("origin patterns", () => {
  it("round-trips an https origin", () => {
    expect(originPattern("https://app.notion.com")).toBe("https://app.notion.com/*");
    expect(originFromPattern("https://app.notion.com/*")).toBe("https://app.notion.com");
  });

  it("rejects wildcard host patterns", () => {
    expect(originFromPattern("*://*/*")).toBeNull();
    expect(originFromPattern("https://*/*")).toBeNull();
  });
});
