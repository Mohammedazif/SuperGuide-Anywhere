const LANDMARK_ROLES = new Set([
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "region",
  "form",
  "search",
]);

export function isLandmarkRole(role: string): boolean {
  return LANDMARK_ROLES.has(role);
}

const TEXT_TAGS = new Set(["p", "td", "th", "dt", "dd", "figcaption", "blockquote", "pre"]);

const INPUT_ROLES: Record<string, string | null> = {
  button: "button",
  submit: "button",
  reset: "button",
  checkbox: "checkbox",
  radio: "radio",
  range: "slider",
  number: "spinbutton",
  search: "searchbox",
  hidden: null,
  image: "button",
  file: "button",
};

export function computeRole(element: Element): string | null {
  const explicit = element.getAttribute("role");
  if (explicit !== null) {
    const first = explicit.trim().split(/\s+/)[0];
    if (first !== undefined && first.length > 0) return first;
  }
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case "a":
      return element.hasAttribute("href") ? "link" : null;
    case "button":
      return "button";
    case "input": {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type in INPUT_ROLES) return INPUT_ROLES[type] ?? null;
      return "textbox";
    }
    case "select":
      return element.hasAttribute("multiple") ? "listbox" : "combobox";
    case "textarea":
      return "textbox";
    case "option":
      return "option";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "header":
      return "banner";
    case "footer":
      return "contentinfo";
    case "aside":
      return "complementary";
    case "section":
      return element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby")
        ? "region"
        : null;
    case "form":
      return element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby")
        ? "form"
        : null;
    case "output":
      return "status";
    case "dialog":
      return "dialog";
    case "img": {
      const alt = element.getAttribute("alt");
      return alt !== null && alt.length > 0 ? "img" : null;
    }
    case "table":
      return "table";
    case "ul":
    case "ol":
      return "list";
    case "li":
      return "listitem";
    case "iframe":
      return "iframe";
    case "progress":
      return "progressbar";
    default:
      return TEXT_TAGS.has(tag) ? "text" : null;
  }
}

export function headingLevelOf(element: Element, role: string): number | undefined {
  if (role !== "heading") return undefined;
  const ariaLevel = element.getAttribute("aria-level");
  if (ariaLevel !== null && /^[1-6]$/.test(ariaLevel)) return Number(ariaLevel);
  const match = /^h([1-6])$/.exec(element.tagName.toLowerCase());
  return match === null ? 2 : Number(match[1]);
}
