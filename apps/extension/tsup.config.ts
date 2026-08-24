import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "service-worker": "src/service-worker.ts",
    "content-script": "src/content-script.ts",
    popup: "src/popup.tsx",
    options: "src/options.tsx",
  },
  format: "iife",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
  clean: true,
  sourcemap: false,
  minify: false,
  target: "chrome120",
  onSuccess: "node ./copy-static.mjs",
});
