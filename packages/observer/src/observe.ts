import type { DigestNode, PageDigest } from "@sga/contract/public";
import { accessibleName } from "./accessible-name";
import { computeRole, headingLevelOf, isLandmarkRole } from "./roles";
import { redactedValue } from "./redact";
import { syntheticId } from "./synthetic-id";

export interface ObserveOptions {
  valueAllowlist?: ReadonlySet<string>;
}

export interface Observation {
  digest: PageDigest;
  resolve(id: string): Element | null;
}

interface RawNode {
  element: Element;
  role: string;
  name: string;
  crossOriginFrame: boolean;
  children: RawNode[];
}

const MAX_NODES = 5000;

function isHidden(element: Element): boolean {
  if (element.getAttribute("aria-hidden") === "true") return true;
  if (element.hasAttribute("hidden")) return true;
  if (element.tagName.toLowerCase() === "template") return true;
  return false;
}

function frameChildren(frame: HTMLIFrameElement): { children: RawNode[]; cross: boolean } {
  let inner: Document | null;
  try {
    inner = frame.contentDocument;
  } catch {
    inner = null;
  }
  const body = inner === null ? null : (inner.body as HTMLElement | null);
  if (body === null) {
    return { children: [], cross: true };
  }
  return { children: collect(body), cross: false };
}

function collect(element: Element): RawNode[] {
  if (isHidden(element)) return [];
  const role = computeRole(element);

  if (role === "iframe") {
    const { children, cross } = frameChildren(element as HTMLIFrameElement);
    return [
      {
        element,
        role: "iframe",
        name: accessibleName(element, "iframe"),
        crossOriginFrame: cross,
        children,
      },
    ];
  }

  const childNodes: RawNode[] = [];
  for (const child of element.children) {
    childNodes.push(...collect(child));
  }

  if (role === null) return childNodes;

  if (role === "text" && childNodes.length === 0) {
    const text = accessibleName(element, "text");
    if (text.length === 0) return [];
  }

  return [
    {
      element,
      role,
      name: accessibleName(element, role),
      crossOriginFrame: false,
      children: childNodes,
    },
  ];
}

function viewportOf(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  if (view === null) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return rect.bottom > 0 && rect.top < view.innerHeight && rect.right > 0 && rect.left < view.innerWidth;
}

export function observe(document: Document, options: ObserveOptions = {}): Observation {
  const allowlist = options.valueAllowlist ?? new Set<string>();
  const nodes: DigestNode[] = [];
  const elements = new Map<string, Element>();
  const usedIds = new Set<string>();

  function emit(raw: RawNode, parentId: string | null, treePath: string, landmark?: string): void {
    if (nodes.length >= MAX_NODES) return;

    let salt = 0;
    let id = syntheticId(raw.role, raw.name, treePath, salt);
    while (usedIds.has(id)) {
      salt += 1;
      id = syntheticId(raw.role, raw.name, treePath, salt);
    }
    usedIds.add(id);
    elements.set(id, raw.element);

    const element = raw.element;
    const tag = element.tagName.toLowerCase();
    const inputType =
      tag === "input" ? (element.getAttribute("type") ?? "text").toLowerCase() : null;

    const disabled =
      element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";
    const checkedAttr =
      raw.role === "checkbox" || raw.role === "radio" || raw.role === "switch"
        ? tag === "input"
          ? (element as HTMLInputElement).checked
          : element.getAttribute("aria-checked") === "true"
        : undefined;
    const expandedAttr = element.getAttribute("aria-expanded");
    const requiredAttr =
      element.hasAttribute("required") || element.getAttribute("aria-required") === "true";
    const invalidAttr = element.getAttribute("aria-invalid") === "true";

    const rawValue =
      tag === "input" || tag === "textarea" || tag === "select"
        ? (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
        : "";
    const value = redactedValue(
      { role: raw.role, inputType, name: raw.name, value: rawValue },
      allowlist,
    );

    const level = headingLevelOf(element, raw.role);
    const node: DigestNode = {
      id,
      parentId,
      role: raw.role,
      name: raw.name,
      state: {
        disabled,
        ...(checkedAttr === undefined ? {} : { checked: checkedAttr }),
        ...(expandedAttr === null ? {} : { expanded: expandedAttr === "true" }),
        ...(requiredAttr ? { required: true } : {}),
        ...(invalidAttr ? { invalid: true } : {}),
      },
      ...(value === undefined ? {} : { value }),
      ...(level === undefined ? {} : { headingLevel: level }),
      ...(landmark === undefined ? {} : { landmark }),
      inViewport: viewportOf(element),
      ...(raw.crossOriginFrame ? { crossOriginFrame: true } : {}),
    };
    nodes.push(node);

    const childLandmark = isLandmarkRole(raw.role) ? raw.role : landmark;
    raw.children.forEach((child, index) => {
      emit(child, id, `${treePath}.${index}`, childLandmark);
    });
  }

  const body = document.body as HTMLElement | null;
  const roots = body === null ? [] : collect(body);
  roots.forEach((root, index) => {
    emit(root, null, String(index));
  });

  return {
    digest: {
      url: document.defaultView?.location.href ?? "about:blank",
      title: document.title,
      nodes,
    },
    resolve: (id) => elements.get(id) ?? null,
  };
}
