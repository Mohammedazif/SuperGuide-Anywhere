// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPage, type PageName } from "../../../apps/fixture-app/src/pages";
import { seedState } from "../../../apps/fixture-app/src/store";
import { observe } from "./observe";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

const PAGES: PageName[] = ["dashboard", "billing", "team", "profile", "plan"];

describe("digest equivalence across interface variants", () => {
  for (const page of PAGES) {
    for (const saved of [false, true]) {
      it(`${page}${saved ? " (after save)" : ""} digests identically under variant A and B`, () => {
        const state = seedState();
        const variantA = observe(parse(renderPage(page, state, "a", saved)));
        const variantB = observe(parse(renderPage(page, state, "b", saved)));
        expect(variantB.digest.nodes).toEqual(variantA.digest.nodes);
        expect(variantA.digest.nodes.length).toBeGreaterThan(5);
      });
    }
  }

  it("derives stable synthetic ids that resolve back to live elements", () => {
    const observation = observe(parse(renderPage("team", seedState(), "a", false)));
    const invite = observation.digest.nodes.find(
      (node) => node.role === "button" && node.name === "Invite member",
    );
    expect(invite).toBeDefined();
    const element = observation.resolve(invite!.id);
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe("button");
    const again = observe(parse(renderPage("team", seedState(), "a", false)));
    expect(again.digest.nodes.find((node) => node.name === "Invite member")?.id).toBe(invite!.id);
  });
});

describe("digest structure", () => {
  it("records landmark membership, heading levels, and checked state", () => {
    const observation = observe(parse(renderPage("profile", seedState(), "a", false)));
    const nodes = observation.digest.nodes;
    const heading = nodes.find((node) => node.role === "heading");
    expect(heading?.headingLevel).toBe(1);
    expect(heading?.landmark).toBe("main");
    const checkbox = nodes.find((node) => node.role === "checkbox");
    expect(checkbox?.state.checked).toBe(true);
    const links = nodes.filter((node) => node.role === "link");
    expect(links.every((link) => link.landmark === "navigation")).toBe(true);
  });

  it("skips aria-hidden subtrees", () => {
    const document = parse(
      `<html><body><div aria-hidden="true"><button>Ghost</button></div><button>Real</button></body></html>`,
    );
    const names = observe(document).digest.nodes.map((node) => node.name);
    expect(names).toContain("Real");
    expect(names).not.toContain("Ghost");
  });

  it("is pure with respect to the page", () => {
    const document = parse(renderPage("billing", seedState(), "a", false));
    const before = document.body.outerHTML;
    observe(document);
    expect(document.body.outerHTML).toBe(before);
  });
});

describe("frames", () => {
  it("traverses a same-origin iframe under an iframe node", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const inner = iframe.contentDocument;
    expect(inner).not.toBeNull();
    inner!.body.innerHTML = "<button>Inner action</button>";
    const observation = observe(document);
    const frameNode = observation.digest.nodes.find((node) => node.role === "iframe");
    expect(frameNode).toBeDefined();
    expect(frameNode?.crossOriginFrame).toBeUndefined();
    const innerButton = observation.digest.nodes.find((node) => node.name === "Inner action");
    expect(innerButton?.parentId).toBe(frameNode?.id);
    iframe.remove();
  });

  it("reports a cross-origin frame as an opaque boundary and never enters it", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    Object.defineProperty(iframe, "contentDocument", { get: () => null });
    const observation = observe(document);
    const frameNode = observation.digest.nodes.find((node) => node.role === "iframe");
    expect(frameNode?.crossOriginFrame).toBe(true);
    expect(
      observation.digest.nodes.filter((node) => node.parentId === frameNode?.id),
    ).toEqual([]);
    iframe.remove();
  });
});
