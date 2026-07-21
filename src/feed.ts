/**
 * Swarm API + Observability dashboard (port 3002).
 * Thin entrypoint — implementation lives under src/feed/.
 */
import { pathToFileURL } from "url";
import { toErrorString } from "./errors.js";

export { buildScopeSummaryForScope } from "./feed/summary.js";
export { validateScopedRequest } from "./feed/scope.js";

import { main } from "./feed/main.js";

const isDirectRun = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return pathToFileURL(argv1).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((e) => {
    process.stderr.write(JSON.stringify({ error: toErrorString(e) }) + "\n");
    process.exit(1);
  });
}
