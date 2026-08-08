import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/** Resolve `public/` from repo/image root (cwd) or relative to this module. */
function resolvePublicDir(): string {
  const fromCwd = join(process.cwd(), "public");
  if (existsSync(fromCwd)) return fromCwd;
  // src/feed → ../../public ; dist/src/feed → ../../../public
  const here = dirname(fileURLToPath(import.meta.url));
  const fromSrc = join(here, "..", "..", "public");
  if (existsSync(fromSrc)) return fromSrc;
  return join(here, "..", "..", "..", "public");
}

const publicDir = resolvePublicDir();

export const INDEX_HTML = readFileSync(
  join(publicDir, "observability.html"),
  "utf-8",
);
export const STUDIO_HTML = readFileSync(
  join(publicDir, "studio", "index.html"),
  "utf-8",
);
export const STUDIO_CSS = readFileSync(
  join(publicDir, "studio", "styles.css"),
  "utf-8",
);
/** Graph bootstrap (mocks, Cytoscape init, `studio:ready`) — load after app.js. */
export const STUDIO_GRAPH_JS = readFileSync(
  join(publicDir, "studio", "graph-boot.js"),
  "utf-8",
);
export const STUDIO_APP_JS = readFileSync(
  join(publicDir, "studio", "studio-app.js"),
  "utf-8",
);
