/**
 * Studio scope catalog (`studio_catalog_scopes` table) and scope-id resolution for feed/studio routes.
 */
import { getPool } from "./db.js";

export type StudioCatalogScope = {
  id: string;
  name: string;
  tag: string;
  state: string;
  score: number;
  cycles: number;
  section: "active" | "archived";
};

const ARCHIVED_STATES = new Set(["archived"]);

export async function listStudioCatalogScopes(): Promise<StudioCatalogScope[]> {
  const r = await getPool().query(
    `SELECT id, name, tag, state, score, cycles
     FROM studio_catalog_scopes
     ORDER BY
       CASE WHEN state = 'archived' THEN 1 ELSE 0 END,
       name ASC`,
  );
  return r.rows.map(
    (row: {
      id: string;
      name: string;
      tag: string;
      state: string;
      score: number;
      cycles: number;
    }) => ({
      id: String(row.id),
      name: String(row.name),
      tag: String(row.tag),
      state: String(row.state),
      score: Number(row.score ?? 0),
      cycles: Number(row.cycles ?? 0),
      section: ARCHIVED_STATES.has(String(row.state)) ? "archived" : "active",
    }),
  );
}

export async function getStudioCatalogScope(
  scopeId: string,
): Promise<StudioCatalogScope | null> {
  const r = await getPool().query(
    `SELECT id, name, tag, state, score, cycles FROM studio_catalog_scopes WHERE id = $1`,
    [scopeId],
  );
  const row = r.rows[0] as
    | {
        id: string;
        name: string;
        tag: string;
        state: string;
        score: number;
        cycles: number;
      }
    | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    tag: String(row.tag),
    state: String(row.state),
    score: Number(row.score ?? 0),
    cycles: Number(row.cycles ?? 0),
    section: ARCHIVED_STATES.has(String(row.state)) ? "archived" : "active",
  };
}

export async function createStudioCatalogScope(input: {
  id: string;
  name: string;
  tag?: string;
}): Promise<StudioCatalogScope> {
  const id = input.id.trim();
  const name = input.name.trim();
  const tag = (input.tag ?? "custom").trim() || "custom";
  if (!id || !name) {
    throw new Error("id_and_name_required");
  }
  await getPool().query(
    `INSERT INTO studio_catalog_scopes (id, name, tag, state, score, cycles)
     VALUES ($1, $2, $3, 'active', 0, 0)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       tag = EXCLUDED.tag,
       updated_at = now()`,
    [id, name, tag],
  );
  const created = await getStudioCatalogScope(id);
  if (!created) throw new Error("catalog_insert_failed");
  return created;
}

export async function scopeExistsInCpScopes(scopeId: string): Promise<boolean> {
  try {
    const r = await getPool().query(
      `SELECT 1 FROM cp_scopes WHERE id = $1 LIMIT 1`,
      [scopeId],
    );
    return r.rowCount !== null && r.rowCount > 0;
  } catch {
    return false;
  }
}

export async function scopeIsKnown(scopeId: string): Promise<boolean> {
  if (!scopeId) return false;
  const catalog = await getStudioCatalogScope(scopeId);
  if (catalog) return true;
  return scopeExistsInCpScopes(scopeId);
}
