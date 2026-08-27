import { isOrphanedWorld, runOrphanSafe } from "./orphan";

export type ColorScheme = "light" | "dark";

export interface Theme {
  panelBg: string;
  border: string;
  text: string;
  muted: string;
  controlBg: string;
  inputBg: string;
  shadow: string;
  scheme: ColorScheme;
}

export interface ThemeTargets {
  host: HTMLElement;
  panel: HTMLElement;
  input: HTMLInputElement;
  log: HTMLElement;
  quotaText: HTMLElement;
  controls: HTMLButtonElement[];
  confirmBar: HTMLElement | null;
}

const THEMES: Record<ColorScheme, Theme> = {
  light: {
    panelBg: "#fff",
    border: "#c8c8d8",
    text: "#1a1a2e",
    muted: "#666",
    controlBg: "#f2f3f8",
    inputBg: "#fff",
    shadow: "0 4px 16px rgba(0,0,0,0.25)",
    scheme: "light",
  },
  dark: {
    panelBg: "#1c1c22",
    border: "#3f3f4a",
    text: "#ececf1",
    muted: "#9a9aa8",
    controlBg: "#2a2a33",
    inputBg: "#2a2a33",
    shadow: "0 4px 16px rgba(0,0,0,0.55)",
    scheme: "dark",
  },
};

const SCHEME_ATTRS = [
  "class",
  "style",
  "data-theme",
  "data-color-scheme",
  "data-color-mode",
  "data-bs-theme",
  "data-mode",
  "theme",
] as const;

function hasWord(value: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${word}(?:[^a-z0-9]|$)`, "i").test(value);
}

function explicitScheme(element: Element): ColorScheme | null {
  const tokens = SCHEME_ATTRS.map((name) => element.getAttribute(name) ?? "").join(" ");
  if (hasWord(tokens, "dark")) return "dark";
  if (hasWord(tokens, "light")) return "light";
  return null;
}

function schemeFromMeta(doc: Document): ColorScheme | null {
  const meta = doc.querySelector('meta[name="color-scheme"]');
  if (meta === null) return null;
  const content = meta.getAttribute("content") ?? "";
  const dark = hasWord(content, "dark");
  const light = hasWord(content, "light");
  if (dark && !light) return "dark";
  if (light && !dark) return "light";
  return null;
}

function isOverlayHost(element: Element): boolean {
  return element instanceof HTMLElement && element.dataset.sgaTheme !== undefined;
}

function pageSurfaces(doc: Document): Element[] {
  const surfaces: Element[] = [doc.documentElement];
  const body = doc.querySelector("body");
  if (body === null) return surfaces;
  surfaces.push(body);
  let node: Element | null = body.firstElementChild;
  let depth = 0;
  while (node !== null && depth < 6) {
    if (!isOverlayHost(node)) surfaces.push(node);
    node = node.firstElementChild;
    depth += 1;
  }
  return surfaces;
}

function parseCssColor(color: string): readonly [number, number, number, number] | null {
  if (color === "transparent") return null;
  const comma = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (comma !== null) {
    const alpha = comma[4] === undefined ? 1 : Number(comma[4]);
    return [Number(comma[1]), Number(comma[2]), Number(comma[3]), alpha];
  }
  const space = /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(color);
  if (space === null) return null;
  const rawAlpha = space[4];
  const alpha =
    rawAlpha === undefined
      ? 1
      : rawAlpha.endsWith("%")
        ? Number(rawAlpha.slice(0, -1)) / 100
        : Number(rawAlpha);
  return [Number(space[1]), Number(space[2]), Number(space[3]), alpha];
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminanceOf(color: string): number | null {
  const parsed = parseCssColor(color);
  if (parsed === null || parsed[3] === 0) return null;
  return 0.2126 * channel(parsed[0]) + 0.7152 * channel(parsed[1]) + 0.0722 * channel(parsed[2]);
}

function schemeFromBackground(element: Element, view: Window): ColorScheme | null {
  const luminance = luminanceOf(view.getComputedStyle(element).backgroundColor);
  if (luminance === null) return null;
  if (luminance < 0.45) return "dark";
  if (luminance > 0.55) return "light";
  return null;
}

function schemeFromForeground(element: Element, view: Window): ColorScheme | null {
  const luminance = luminanceOf(view.getComputedStyle(element).color);
  if (luminance === null) return null;
  if (luminance > 0.62) return "dark";
  if (luminance < 0.32) return "light";
  return null;
}

function schemeFromColorScheme(element: Element, view: Window): ColorScheme | null {
  const value = view.getComputedStyle(element).colorScheme;
  const dark = hasWord(value, "dark");
  const light = hasWord(value, "light");
  if (dark && !light) return "dark";
  if (light && !dark) return "light";
  return null;
}

type MediaView = { matchMedia?: (query: string) => MediaQueryList };

function mediaQuery(view: Window, query: string): MediaQueryList | null {
  try {
    const matchMedia = (view as MediaView).matchMedia;
    if (typeof matchMedia !== "function") return null;
    return matchMedia(query);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function prefersDark(view: Window): boolean {
  try {
    return mediaQuery(view, "(prefers-color-scheme: dark)")?.matches === true;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

function firstScheme(values: ReadonlyArray<ColorScheme | null>): ColorScheme | null {
  for (const value of values) {
    if (value !== null) return value;
  }
  return null;
}

function readColorScheme(doc: Document): ColorScheme {
  const view = doc.defaultView;
  const root = doc.documentElement;
  const body = doc.querySelector("body");
  const surfaces = pageSurfaces(doc);
  const fromAttrs = firstScheme([
    explicitScheme(root),
    body === null ? null : explicitScheme(body),
  ]);
  if (fromAttrs !== null) return fromAttrs;
  const fromMeta = schemeFromMeta(doc);
  if (fromMeta !== null) return fromMeta;
  if (view !== null) {
    const fromCss = firstScheme(surfaces.map((element) => schemeFromColorScheme(element, view)));
    if (fromCss !== null) return fromCss;
    const fromBg = firstScheme(surfaces.map((element) => schemeFromBackground(element, view)));
    if (fromBg !== null) return fromBg;
    const fromFg = firstScheme(surfaces.map((element) => schemeFromForeground(element, view)));
    if (fromFg !== null) return fromFg;
    if (typeof doc.elementFromPoint === "function") {
      const x = Math.max(4, Math.floor(view.innerWidth / 4));
      const y = Math.max(4, Math.floor(view.innerHeight / 4));
      let hit: Element | null = doc.elementFromPoint(x, y);
      while (hit !== null) {
        if (!isOverlayHost(hit)) {
          const painted =
            schemeFromBackground(hit, view) ??
            schemeFromColorScheme(hit, view) ??
            schemeFromForeground(hit, view);
          if (painted !== null) return painted;
        }
        hit = hit.parentElement;
      }
    }
    if (prefersDark(view)) return "dark";
  }
  return "light";
}

export function detectColorScheme(doc: Document): ColorScheme {
  try {
    return readColorScheme(doc);
  } catch (error) {
    if (isOrphanedWorld(error)) return "light";
    throw error;
  }
}

function paintControl(button: HTMLButtonElement, theme: Theme, wide: boolean): void {
  button.style.background = theme.controlBg;
  button.style.borderColor = theme.border;
  button.style.color = theme.text;
  if (wide) {
    button.style.width = "60px";
    button.style.height = "20px";
  }
}

export function paintTheme(doc: Document, targets: ThemeTargets): void {
  const theme = THEMES[detectColorScheme(doc)];
  targets.host.dataset.sgaTheme = theme.scheme;
  targets.host.style.colorScheme = theme.scheme;
  targets.panel.style.background = theme.panelBg;
  targets.panel.style.border = `1px solid ${theme.border}`;
  targets.panel.style.boxShadow = theme.shadow;
  targets.panel.style.color = theme.text;
  targets.input.style.background = theme.inputBg;
  targets.input.style.borderColor = theme.border;
  targets.input.style.color = theme.text;
  targets.log.style.color = theme.text;
  targets.quotaText.style.color = theme.muted;
  for (const button of targets.controls) paintControl(button, theme, true);
  if (targets.confirmBar !== null) {
    targets.confirmBar.style.background = theme.panelBg;
    targets.confirmBar.style.borderTop = `1px solid ${theme.border}`;
    for (const button of targets.confirmBar.querySelectorAll("button")) {
      paintControl(button, theme, false);
    }
  }
}

export function watchTheme(doc: Document, onChange: () => void): () => void {
  let stopped = false;
  const disconnect = (): void => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    media?.removeEventListener("change", onMedia);
  };
  const fire = (): void => {
    if (stopped) return;
    runOrphanSafe(onChange, disconnect);
  };
  const observer = new MutationObserver(fire);
  const watch = (target: Element | null): void => {
    if (target === null) return;
    observer.observe(target, { attributes: true, attributeFilter: [...SCHEME_ATTRS] });
  };
  watch(doc.documentElement);
  watch(doc.querySelector("body"));
  const view = doc.defaultView;
  const media = view === null ? null : mediaQuery(view, "(prefers-color-scheme: dark)");
  const onMedia = (): void => {
    fire();
  };
  media?.addEventListener("change", onMedia);
  return disconnect;
}
