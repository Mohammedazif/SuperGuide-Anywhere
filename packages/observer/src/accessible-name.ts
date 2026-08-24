const NAME_FROM_CONTENT = new Set([
  "button",
  "link",
  "heading",
  "option",
  "listitem",
  "cell",
  "columnheader",
  "rowheader",
  "text",
  "status",
  "alert",
  "menuitem",
  "tab",
]);

const CONTROL_TAGS = new Set(["input", "select", "textarea"]);

function normalise(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim().slice(0, 300);
}

function labelText(label: Element): string {
  const clone = label.cloneNode(true) as Element;
  for (const control of clone.querySelectorAll("input, select, textarea, button")) {
    control.remove();
  }
  return clone.textContent;
}

export function accessibleName(element: Element, role: string): string {
  const document = element.ownerDocument;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .filter((part) => part.trim().length > 0);
    if (parts.length > 0) return normalise(parts.join(" "));
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return normalise(ariaLabel);

  if (CONTROL_TAGS.has(element.tagName.toLowerCase())) {
    const id = element.getAttribute("id");
    if (id !== null) {
      for (const label of document.querySelectorAll("label[for]")) {
        if (label.getAttribute("for") !== id) continue;
        const text = labelText(label);
        if (text.trim().length > 0) return normalise(text);
        break;
      }
    }
    const wrapping = element.closest("label");
    if (wrapping !== null) {
      const text = labelText(wrapping);
      if (text.trim().length > 0) return normalise(text);
    }
  }

  const title = element.getAttribute("title");
  if (title !== null && title.trim().length > 0) return normalise(title);

  if (element.tagName.toLowerCase() === "input") {
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      const value = element.getAttribute("value");
      if (value !== null && value.trim().length > 0) return normalise(value);
      return type === "submit" ? "Submit" : "";
    }
  }

  if (element.tagName.toLowerCase() === "img") {
    const alt = element.getAttribute("alt");
    if (alt !== null) return normalise(alt);
  }

  if (NAME_FROM_CONTENT.has(role)) {
    return normalise(element.textContent);
  }
  return "";
}
