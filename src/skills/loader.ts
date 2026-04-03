import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SKILL_MAP, type SkillRole } from "./registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", "..", "skills");

const cache = new Map<string, string>();

/**
 * Load a single skill file by ID, strip YAML frontmatter, return the body.
 * Returns empty string if the file is missing (graceful degradation).
 */
export function loadSkillFile(id: string): string {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  const path = join(SKILLS_DIR, `${id}.md`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    cache.set(id, "");
    return "";
  }

  const body = stripFrontmatter(raw);
  cache.set(id, body);
  return body;
}

/**
 * Load and concatenate all skills for a given role.
 * Skills are separated by a horizontal rule for clarity.
 * Set SKILLS_DISABLED=1 to bypass skill loading (for A/B experiments).
 */
export function loadSkills(role: SkillRole): string {
  if (process.env.SKILLS_DISABLED === "1") return "";
  const ids = SKILL_MAP[role];
  if (!ids || ids.length === 0) return "";

  const sections = ids
    .map((id) => loadSkillFile(id))
    .filter((s) => s.length > 0);

  return sections.join("\n\n---\n\n");
}

/**
 * Compose role-specific instructions with skills appended.
 * Convenience wrapper: `composeInstructions(base, role)` = base + skills.
 */
export function composeInstructions(baseInstructions: string, role: SkillRole): string {
  const skills = loadSkills(role);
  if (!skills) return baseInstructions;
  return `${baseInstructions}\n\n${skills}`;
}

/** Clear the in-memory cache (for tests). */
export function clearSkillCache(): void {
  cache.clear();
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw.trim();
  const endIdx = raw.indexOf("---", 3);
  if (endIdx < 0) return raw.trim();
  return raw.slice(endIdx + 3).trim();
}
