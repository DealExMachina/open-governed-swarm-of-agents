/**
 * Demo / benchmark corpus loaders for studio "load scenario" presets.
 * Product demos use directory scans; S1–S5 use benchmark manifests.
 */
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadBenchmarkPackageForScenario } from "./baselines/manifest/index.js";
import { loadDocumentTextForPackage } from "./baselines/scenario/ma-scenario.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SCENARIO_ROOT = join(REPO_ROOT, "demo", "scenario");

export type StudioDirCorpusId =
  | "ma"
  | "financial"
  | "green-bond"
  | "basic-example";

export type StudioManifestCorpusId = "s1" | "s2" | "s3" | "s4" | "s5";

export type StudioCorpusId = StudioDirCorpusId | StudioManifestCorpusId;

const CORPUS_DIRS: Record<StudioDirCorpusId, string> = {
  ma: "docs",
  financial: "docs-financial",
  "green-bond": "docs-green-bond",
  "basic-example": "docs-basic-example",
};

const MANIFEST_CORPORA: StudioManifestCorpusId[] = [
  "s1",
  "s2",
  "s3",
  "s4",
  "s5",
];

function isManifestCorpus(id: string): id is StudioManifestCorpusId {
  return (MANIFEST_CORPORA as string[]).includes(id);
}

function isDirCorpus(id: string): id is StudioDirCorpusId {
  return Object.prototype.hasOwnProperty.call(CORPUS_DIRS, id);
}

export function listStudioCorpora(): Array<{
  id: StudioCorpusId;
  dir: string;
  doc_count: number;
}> {
  const dirEntries = (Object.keys(CORPUS_DIRS) as StudioDirCorpusId[]).map(
    (id) => {
      const dir = join(SCENARIO_ROOT, CORPUS_DIRS[id]);
      let docCount = 0;
      try {
        docCount = readdirSync(dir).filter((f) => f.endsWith(".txt")).length;
      } catch {
        docCount = 0;
      }
      return { id, dir: CORPUS_DIRS[id], doc_count: docCount };
    },
  );

  const manifestEntries = MANIFEST_CORPORA.map((id) => {
    try {
      const pkg = loadBenchmarkPackageForScenario(REPO_ROOT, id);
      return {
        id,
        dir: pkg.docsRootRelative,
        doc_count: pkg.documents.length,
      };
    } catch {
      return { id, dir: `manifest:${id}`, doc_count: 0 };
    }
  });

  return [...dirEntries, ...manifestEntries];
}

export function loadCorpusDocuments(
  corpusId: string,
): Array<{ title: string; body: string }> {
  if (isManifestCorpus(corpusId)) {
    const pkg = loadBenchmarkPackageForScenario(REPO_ROOT, corpusId);
    return pkg.documents.map((d) => ({
      title: d.title,
      body: loadDocumentTextForPackage(pkg, d),
    }));
  }
  if (!isDirCorpus(corpusId)) return [];
  const sub = CORPUS_DIRS[corpusId];
  const dir = join(SCENARIO_ROOT, sub);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .sort();
  return files.map((f) => ({
    title: f.replace(/\.txt$/, ""),
    body: readFileSync(join(dir, f), "utf-8"),
  }));
}
