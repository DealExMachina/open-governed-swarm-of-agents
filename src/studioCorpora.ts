/**
 * Demo corpus directories for studio "load scenario" presets.
 */
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
  const dir = join(SCENARIO_ROOT, sub);
  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith(".txt"))
      .sort();
  } catch {
    // Dist / API-only images may omit demo/scenario; degrade to empty.
    return [];
  }
  return files.map((f) => ({
    title: f.replace(/\.txt$/, ""),
    body: readFileSync(join(dir, f), "utf-8"),
  }));
}
