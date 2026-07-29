/**
 * Demo corpus directories for studio "load scenario" presets.
 *
 * The "ma" corpus doubles as the S1 (Project Horizon) benchmark scenario, so it is loaded
 * from that manifest rather than by scanning its directory -- otherwise a stray .txt file
 * dropped in demo/scenario/docs/ would silently be fed into the benchmark's document set.
 * The other corpora have no manifest/ground-truth of their own and are still directory-scanned.
 */
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadAllDocuments } from "./baselines/scenario/ma-scenario.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIO_ROOT = join(__dirname, "..", "demo", "scenario");

export type StudioCorpusId =
  | "ma"
  | "financial"
  | "green-bond"
  | "basic-example";

const CORPUS_DIRS: Record<StudioCorpusId, string> = {
  ma: "docs",
  financial: "docs-financial",
  "green-bond": "docs-green-bond",
  "basic-example": "docs-basic-example",
};

export function listStudioCorpora(): Array<{
  id: StudioCorpusId;
  dir: string;
  doc_count: number;
}> {
  return (Object.keys(CORPUS_DIRS) as StudioCorpusId[]).map((id) => {
    if (id === "ma") {
      return { id, dir: CORPUS_DIRS[id], doc_count: loadAllDocuments().length };
    }
    const dir = join(SCENARIO_ROOT, CORPUS_DIRS[id]);
    let docCount = 0;
    try {
      docCount = readdirSync(dir).filter((f) => f.endsWith(".txt")).length;
    } catch {
      docCount = 0;
    }
    return { id, dir: CORPUS_DIRS[id], doc_count: docCount };
  });
}

export function loadCorpusDocuments(
  corpusId: string,
): Array<{ title: string; body: string }> {
  const id = corpusId as StudioCorpusId;
  const sub = CORPUS_DIRS[id];
  if (!sub) return [];

  if (id === "ma") {
    return loadAllDocuments().map((d) => ({ title: d.title, body: d.text }));
  }

  const dir = join(SCENARIO_ROOT, sub);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort();
  return files.map((f) => ({
    title: f.replace(/\.txt$/, ""),
    body: readFileSync(join(dir, f), "utf-8"),
  }));
}
