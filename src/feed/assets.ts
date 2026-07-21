import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __feed_dirname = dirname(fileURLToPath(import.meta.url));
// assets live next to legacy src/ paths (one level up from src/feed/)
const srcDir = join(__feed_dirname, "..");

export const INDEX_HTML = readFileSync(
  join(srcDir, "observability.html"),
  "utf-8",
);
export const STUDIO_HTML = readFileSync(
  join(srcDir, "..", "prototype", "studio-preview", "index.html"),
  "utf-8",
);
export const STUDIO_APP_JS = readFileSync(
  join(srcDir, "..", "prototype", "studio-preview", "studio-app.js"),
  "utf-8",
);
