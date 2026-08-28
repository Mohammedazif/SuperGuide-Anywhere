import { globSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UNAMBIGUOUS_VENDOR_NAMES } from "../eslint-plugin-sga/rules/vendor-list.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SELF_EXCLUDED = new Set([
  "tools/scripts/check-forbidden.mjs",
  "tools/eslint-plugin-sga/rules/vendor-list.js",
  "tools/eslint-plugin-sga/rules/no-forbidden-browser-apis.js",
  "pnpm-lock.yaml",
]);

const SCAN_GLOBS = [
  "packages/*/src/**/*.{ts,tsx}",
  "apps/*/src/**/*.{ts,tsx}",
  "apps/extension/manifest.json",
  "adapters/**/*.{yaml,yml}",
  "tools/**/*.{js,mjs,sql}",
  "*.{js,ts,json,yml,yaml}",
  "packages/*/package.json",
  "apps/*/package.json",
];

const TEST_FILE = /(\.test\.tsx?|\/tests\/|\/fixtures\/)/;
const EXTENSION_BUNDLE = /^(apps\/extension\/|packages\/(contract|observer|executor|policy|adapters|transport|ui)\/)/;

const escaped = UNAMBIGUOUS_VENDOR_NAMES.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

const RULES = [
  {
    id: "csp-manipulation",
    description: "Any read or write of a Content-Security-Policy header",
    pattern: /content-security-policy|modifyHeaders/i,
    // fixture-app serves a CSP so the extension can be proved under one; product never touches it.
    exclude: [/^apps\/fixture-app\//],
  },
  {
    id: "blanket-host-access",
    description: "<all_urls> anywhere",
    pattern: /<all_urls>/,
  },
  {
    id: "main-world",
    description: "Script execution in the page's main world",
    pattern: /world\s*[:=]\s*["']MAIN["']/,
  },
  {
    id: "dynamic-code",
    description: "eval, new Function, or any dynamic code construction",
    pattern: /(^|[^.\w])eval\s*\(|new\s+Function\s*\(|Function\s*\(\s*["'`][^"'`]*["'`]\s*\)/,
  },
  {
    id: "remote-code",
    description: "A script fetched or imported from a URL",
    pattern: /import\(\s*["'`]https?:|executeScript\s*\(\s*\{[^}]*func\s*:/,
  },
  {
    id: "screenshot",
    description: "Screenshot or screen capture of any kind",
    pattern: /captureVisibleTab|getDisplayMedia|\.toDataURL\s*\(|\.toBlob\s*\(/,
  },
  {
    id: "client-entitlement",
    description: "A quota constant or entitlement decision in code the extension bundles",
    pattern: /SGA_DAILY|\b(used|remaining|taskCount)\s*(>=|>|<=|<)\s*(limit|quota)\b|\bquota\s*[:=]\s*\d/i,
    include: [EXTENSION_BUNDLE],
    skipTests: true,
  },
  {
    id: "session-recorder",
    description: "A session replay or analytics recorder",
    pattern: /session[_-]?replay|record[_-]?session|session[_-]?record(er|ing)|dom[_-]?recorder/i,
  },
  {
    id: "persisted-selector",
    description: "A raw selector string chosen by the model and persisted",
    pattern: /\b(cssSelector|css_selector|selectorPath|selector_path|xpath|xPath)\b/i,
  },
  {
    id: "module-level-approval-flag",
    description: "A module-level mutable approval, confirmation, or bypass flag",
    pattern: /^\s*(export\s+)?(let|var)\s+\w*(approv|confirm|bypass|allowAll|skipPolicy)\w*/i,
  },
  {
    id: "privileged-app-role",
    description: "A database role used by the application that owns tables or has BYPASSRLS",
    pattern: /(?<!NO)BYPASSRLS|OWNER\s+TO\s+sga_app|ALTER\s+TABLE\s+\w+\s+OWNER\s+TO\s+sga_app/i,
  },
  {
    id: "empty-catch",
    description: "An empty catch block",
    pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
  },
  {
    id: "vendor-name",
    description: "Any third-party vendor name outside adapter data files",
    pattern: new RegExp(`(?<![a-z0-9])(${escaped.join("|")})(?![a-z0-9])`, "i"),
    allowLine: /^\s*(import|export)\s.*from\s+["']|["']\s*:\s*["']\^?\d/,
    // Site adapters must name the host they match; adapters/ is data, not code.
    exclude: [/^adapters\//],
  },
];

function collectFiles() {
  const files = new Set();
  for (const pattern of SCAN_GLOBS) {
    for (const match of globSync(pattern, {
      cwd: REPO_ROOT,
      exclude: ["**/node_modules/**", "**/dist/**"],
    })) {
      const rel = match.split("\\").join("/");
      if (!SELF_EXCLUDED.has(rel)) files.add(rel);
    }
  }
  return [...files].sort();
}

function main() {
  const files = collectFiles();
  const hits = [];
  const scoped = new Set();

  for (const file of files) {
    const isTest = TEST_FILE.test(file);
    const lines = readFileSync(join(REPO_ROOT, file), "utf8").split("\n");
    for (const rule of RULES) {
      if (rule.skipTests === true && isTest) continue;
      if (rule.include !== undefined && !rule.include.some((pattern) => pattern.test(file))) {
        continue;
      }
      if (rule.exclude !== undefined && rule.exclude.some((pattern) => pattern.test(file))) {
        scoped.add(`${rule.id} <- ${String(rule.exclude)}`);
        continue;
      }
      lines.forEach((line, index) => {
        if (!rule.pattern.test(line)) return;
        if (rule.allowLine !== undefined && rule.allowLine.test(line)) return;
        hits.push({ file, line: index + 1, rule: rule.id, text: line.trim().slice(0, 140) });
      });
    }
  }

  console.log(`check:forbidden scanned ${files.length} files against ${RULES.length} rules`);
  for (const note of [...scoped].sort()) {
    console.log(`  scoped: ${note}`);
  }
  if (hits.length === 0) {
    console.log("no forbidden patterns found");
    return;
  }
  for (const hit of hits) {
    console.error(`${hit.file}:${hit.line}  [${hit.rule}]  ${hit.text}`);
  }
  console.error(`\n${hits.length} forbidden pattern hit(s)`);
  process.exit(1);
}

main();
