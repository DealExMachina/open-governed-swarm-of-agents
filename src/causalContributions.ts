/**
 * Causal contribution layer (Stage 2 Phase 1).
 * Content-addressed DAG of contributions; rid = SHA-256(CBOR(parents, payload, kind)).
 */
import type pg from "pg";
import { getPool } from "./db.js";
import { computeContentHash, validateContribution } from "./sgrsAdapter.js";

export const CONTRIBUTION_KINDS = [
  "claim",
  "contradiction",
  "resolution",
  "assessment",
  "goal",
  "evidence",
] as const;

export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];
export type AuthorityTier = 0 | 1 | 2;
export type GovernanceMode = "SYSTEM" | "YOLO" | "MITL" | "MASTER";

export function isContributionKind(s: string): s is ContributionKind {
  return (CONTRIBUTION_KINDS as readonly string[]).includes(s);
}

function isGovernanceMode(mode: string): mode is GovernanceMode {
  return mode === "SYSTEM" || mode === "YOLO" || mode === "MITL" || mode === "MASTER";
}

function toAuthorityTier(input: unknown): AuthorityTier {
  const n = Number(input);
  if (n === 1 || n === 2) return n;
  return 0;
}

function toGovernanceMode(input: unknown): GovernanceMode {
  if (typeof input === "string" && isGovernanceMode(input)) return input;
  return "SYSTEM";
}

export interface CausalContribution {
  rid: string;
  scope_id: string;
  parents: string[];
  payload: Record<string, unknown>;
  kind: ContributionKind;
  role_id: string;
  /** 0 = system/operational, 1 = worker/agent, 2 = governance decision. */
  authority_tier: AuthorityTier;
  governance_mode: GovernanceMode;
  valid_from: Date | null;
  valid_to: Date | null;
  transaction_time: Date;
  created_at: Date;
}

export interface CreateContributionInput {
  scope_id: string;
  parents: string[];
  payload: Record<string, unknown>;
  kind: ContributionKind;
  role_id: string;
  /** 0 = system/operational, 1 = worker/agent, 2 = governance decision. */
  authority_tier?: AuthorityTier;
  governance_mode?: GovernanceMode;
  /** When false, skips expensive parent existence validation. */
  validate_parents?: boolean;
  valid_from?: Date;
  valid_to?: Date;
}

/**
 * Create a contribution: compute content hash, validate parents exist, insert into `causal_contributions`.
 * Does not append context WAL — call `appendEvent` separately when semantic consumers need it.
 * Returns the content-addressed rid.
 */
export async function createContribution(
  input: CreateContributionInput,
  pool?: pg.Pool,
): Promise<string> {
  const p = pool ?? getPool();
  const payloadStr = JSON.stringify(input.payload);
  const hashResult = computeContentHash(input.parents, payloadStr, input.kind);
  if (!hashResult.valid) {
    throw new Error(`Invalid contribution: ${hashResult.error ?? "content hash failed"}`);
  }
  const rid = hashResult.hash;

  const shouldValidateParents = input.validate_parents ?? true;
  if (shouldValidateParents && input.parents.length > 0) {
    const known = await getKnownRids(p, input.scope_id, input.parents);
    const validation = validateContribution(
      rid,
      input.parents,
      payloadStr,
      input.kind,
      known,
    );
    if (!validation.valid) {
      if (validation.missing_parents.length) {
        throw new Error(`Missing parents: ${validation.missing_parents.join(", ")}`);
      }
      throw new Error(validation.error ?? "Validation failed");
    }
  }

  const authorityTier: AuthorityTier = input.authority_tier ?? 0;
  const governanceMode: GovernanceMode = input.governance_mode ?? "SYSTEM";
  const validFrom = input.valid_from ? input.valid_from.toISOString() : null;
  const validTo = input.valid_to ? input.valid_to.toISOString() : null;

  await p.query(
    `INSERT INTO causal_contributions (
      rid, scope_id, parents, payload, kind, role_id, authority_tier, governance_mode,
      valid_from, valid_to
    ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)
    ON CONFLICT (rid) DO NOTHING`,
    [
      rid,
      input.scope_id,
      input.parents,
      JSON.stringify(input.payload),
      input.kind,
      input.role_id,
      authorityTier,
      governanceMode,
      validFrom,
      validTo,
    ],
  );

  return rid;
}

async function getKnownRids(pool: pg.Pool, scopeId: string, parents: string[]): Promise<string[]> {
  if (parents.length === 0) return [];
  const res = await pool.query<{ rid: string }>(
    "SELECT rid FROM causal_contributions WHERE scope_id = $1 AND rid = ANY($2)",
    [scopeId, parents],
  );
  return res.rows.map((r) => r.rid);
}

function rowToContribution(r: Record<string, unknown>): CausalContribution {
  return {
    rid: r.rid as string,
    scope_id: r.scope_id as string,
    parents: (r.parents as string[]) ?? [],
    payload: (r.payload as Record<string, unknown>) ?? {},
    kind: r.kind as ContributionKind,
    role_id: r.role_id as string,
    authority_tier: toAuthorityTier(r.authority_tier),
    governance_mode: toGovernanceMode(r.governance_mode),
    valid_from: r.valid_from ? new Date(r.valid_from as string) : null,
    valid_to: r.valid_to ? new Date(r.valid_to as string) : null,
    transaction_time: new Date(r.transaction_time as string),
    created_at: new Date(r.created_at as string),
  };
}

export async function getContribution(
  rid: string,
  pool?: pg.Pool,
): Promise<CausalContribution | null> {
  const p = pool ?? getPool();
  const res = await p.query(
    "SELECT rid, scope_id, parents, payload, kind, role_id, authority_tier, governance_mode, valid_from, valid_to, transaction_time, created_at FROM causal_contributions WHERE rid = $1",
    [rid],
  );
  if (res.rowCount === 0) return null;
  return rowToContribution(res.rows[0] as Record<string, unknown>);
}

export async function getChildren(rid: string, pool?: pg.Pool): Promise<CausalContribution[]> {
  const p = pool ?? getPool();
  const res = await p.query(
    `SELECT rid, scope_id, parents, payload, kind, role_id, authority_tier, governance_mode, valid_from, valid_to, transaction_time, created_at
     FROM causal_contributions WHERE $1 = ANY(parents) ORDER BY created_at ASC`,
    [rid],
  );
  return res.rows.map((r) => rowToContribution(r as Record<string, unknown>));
}

/**
 * Causal cone: the contribution and all its ancestors, topologically ordered (roots first).
 */
export async function getCausalCone(rid: string, pool?: pg.Pool): Promise<CausalContribution[]> {
  const p = pool ?? getPool();
  const seen = new Set<string>();
  const out: CausalContribution[] = [];

  function collect(id: string): void {
    if (seen.has(id)) return;
    seen.add(id);
    const c = contributions.get(id);
    if (c) {
      for (const parent of c.parents) collect(parent);
      out.push(c);
    }
  }

  const allInScope = await p.query(
    `SELECT rid, scope_id, parents, payload, kind, role_id, authority_tier, governance_mode, valid_from, valid_to, transaction_time, created_at
     FROM causal_contributions WHERE scope_id = (SELECT scope_id FROM causal_contributions WHERE rid = $1 LIMIT 1)`,
    [rid],
  );
  const contributions = new Map<string, CausalContribution>();
  for (const r of allInScope.rows) {
    const c = rowToContribution(r as Record<string, unknown>);
    contributions.set(c.rid, c);
  }

  const start = contributions.get(rid);
  if (!start) return [];

  collect(rid);
  return out;
}

/**
 * Frontier: tips with no children (maximal elements in the DAG for this scope).
 */
export async function getFrontier(scopeId: string, pool?: pg.Pool): Promise<string[]> {
  const p = pool ?? getPool();
  const res = await p.query(
    `SELECT c.rid FROM causal_contributions c
     WHERE c.scope_id = $1 AND NOT EXISTS (
       SELECT 1 FROM causal_contributions c2 WHERE c2.scope_id = c.scope_id AND c.rid = ANY(c2.parents)
     )`,
    [scopeId],
  );
  return (res.rows as { rid: string }[]).map((r) => r.rid);
}
