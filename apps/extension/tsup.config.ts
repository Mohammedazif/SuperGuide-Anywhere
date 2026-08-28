import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "service-worker": "src/service-worker.ts",
    "content-script": "src/content-script.ts",
    popup: "src/popup.tsx",
    options: "src/options.tsx",
  },
  format: ["iife"],
  platform: "browser",
  outDir: "dist",
  outExtension() {
    return { js: ".js" };
  },
  clean: true,
  sourcemap: false,
  minify: false,
  splitting: false,
  dts: false,
  target: "chrome120",
  define: {
    __SGA_API_BASE__: JSON.stringify(process.env["SGA_API_BASE"] ?? ""),
  },
  onSuccess: "node ./copy-static.mjs",
});
