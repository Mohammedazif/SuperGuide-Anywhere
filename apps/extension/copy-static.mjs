import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const file of ["manifest.json", "popup.html", "options.html"]) {
  copyFileSync(join(here, file), join(here, "dist", file));
}
