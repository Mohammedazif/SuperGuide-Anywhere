import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import sga from "eslint-plugin-sga";

const NODE_BUILTINS = [
  "node:*",
  "fs",
  "path",
  "crypto",
  "http",
  "https",
  "net",
  "os",
  "child_process",
  "worker_threads",
  "timers",
  "url",
  "util",
  "stream",
  "zlib",
  "dns",
];

const NETWORK_GLOBALS = [
  { name: "fetch", message: "This package must never perform network I/O." },
  { name: "XMLHttpRequest", message: "This package must never perform network I/O." },
  { name: "WebSocket", message: "This package must never perform network I/O." },
  { name: "EventSource", message: "This package must never perform network I/O." },
];

const CHROME_GLOBAL = {
  name: "chrome",
  message: "chrome.* is reachable only from @sga/transport and apps/extension.",
};

const INTERNAL_PACKAGES = {
  contractPublic: "@sga/contract/public",
  contractInternal: "@sga/contract/internal",
  policy: "@sga/policy",
  adapters: "@sga/adapters",
  observer: "@sga/observer",
  executor: "@sga/executor",
  transport: "@sga/transport",
  ui: "@sga/ui",
};

function forbidden(allowed) {
  const permitted = new Set(allowed);
  return Object.values(INTERNAL_PACKAGES).filter((name) => !permitted.has(name));
}

function boundary(files, allowed, message) {
  return {
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: forbidden(allowed).map((name) => ({ name, message })), patterns: [] },
      ],
    },
  };
}

function pureBrowserPackage(name, allowed, message) {
  return {
    files: [`packages/${name}/**/*.ts`, `packages/${name}/**/*.tsx`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: forbidden(allowed).map((packageName) => ({ name: packageName, message })),
          patterns: NODE_BUILTINS.map((group) => ({
            group: [group],
            message: `${name} runs in the browser: no node builtins.`,
          })),
        },
      ],
      "no-restricted-globals": ["error", CHROME_GLOBAL, ...NETWORK_GLOBALS],
    },
  };
}

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/dist-tsc/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "eval/results/**",
      "test-results/**",
      "playwright-report/**",
      "store-package/**",
    ],
  },

  js.configs.recommended,
  prettier,

  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          defaultProject: "tsconfig.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { sga },
    rules: {
      "sga/no-vendor-names": "error",
      "sga/no-forbidden-browser-apis": "error",

      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-console": "error",

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "all" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read the environment only in the environment module, which validates it with Zod at process start.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='document'][property.name=/^(write|writeln)$/]",
          message: "Never write into the host document.",
        },
        {
          selector: "CallExpression[callee.name='setTimeout'][arguments.0.type='Literal']",
          message: "setTimeout with a string body constructs code dynamically.",
        },
      ],
    },
  },

  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    rules: { "sga/no-module-level-mutable-state": "error" },
  },

  {
    files: ["packages/contract/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["@sga/**"], message: "contract is the root of the dependency graph." }],
        },
      ],
      "no-restricted-globals": ["error", CHROME_GLOBAL, ...NETWORK_GLOBALS],
    },
  },

  pureBrowserPackage(
    "observer",
    [INTERNAL_PACKAGES.contractPublic],
    "observer may import only @sga/contract/public.",
  ),
  pureBrowserPackage(
    "executor",
    [INTERNAL_PACKAGES.contractPublic],
    "executor may import only @sga/contract/public.",
  ),
  pureBrowserPackage(
    "adapters",
    [INTERNAL_PACKAGES.contractPublic],
    "adapters may import only @sga/contract/public.",
  ),

  {
    files: ["packages/policy/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: forbidden([INTERNAL_PACKAGES.contractPublic]).map((name) => ({
            name,
            message: "policy may import only @sga/contract/public.",
          })),
          patterns: NODE_BUILTINS.map((group) => ({
            group: [group],
            message: "policy is pure: no node builtins.",
          })),
        },
      ],
      "no-restricted-globals": [
        "error",
        CHROME_GLOBAL,
        { name: "Date", message: "policy is pure: it may not read a clock." },
        { name: "performance", message: "policy is pure: it may not read a clock." },
        ...NETWORK_GLOBALS,
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "policy is pure: no randomness." },
        { object: "Date", property: "now", message: "policy is pure: it may not read a clock." },
        { object: "process", property: "env", message: "policy is pure: no environment access." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date']", message: "policy is pure: no clock." },
      ],
    },
  },

  {
    files: ["packages/transport/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: forbidden([INTERNAL_PACKAGES.contractPublic]).map((name) => ({
            name,
            message: "transport may import only @sga/contract/public.",
          })),
          patterns: NODE_BUILTINS.map((group) => ({
            group: [group],
            message: "transport runs in the browser: no node builtins.",
          })),
        },
      ],
    },
  },

  boundary(
    ["packages/ui/**/*.ts", "packages/ui/**/*.tsx"],
    [INTERNAL_PACKAGES.contractPublic, INTERNAL_PACKAGES.transport],
    "ui may import only @sga/contract/public and @sga/transport.",
  ),

  boundary(
    ["apps/extension/**/*.ts", "apps/extension/**/*.tsx"],
    [
      INTERNAL_PACKAGES.contractPublic,
      INTERNAL_PACKAGES.policy,
      INTERNAL_PACKAGES.adapters,
      INTERNAL_PACKAGES.observer,
      INTERNAL_PACKAGES.executor,
      INTERNAL_PACKAGES.transport,
      INTERNAL_PACKAGES.ui,
    ],
    "the extension bundle must never reach @sga/contract/internal.",
  ),

  {
    files: ["apps/fixture-app/src/env.ts", "apps/*/tsup.config.ts"],
    rules: { "no-restricted-properties": "off" },
  },

  {
    files: ["tools/**/*.mjs", "tools/**/*.js", "*.config.js"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly" },
    },
    plugins: { sga },
    rules: { "no-console": "off", "sga/no-vendor-names": "error" },
  },

  {
    files: ["tools/eslint-plugin-sga/rules/vendor-list.js", "tools/scripts/check-forbidden.mjs"],
    rules: { "sga/no-vendor-names": "off" },
  },

  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/tests/**/*.ts", "eval/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "no-restricted-properties": "off",
    },
  },
);
