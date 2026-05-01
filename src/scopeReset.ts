/**
 * Delete all persisted data for one scope (Postgres + optional S3 prefix).
 * Does not truncate other scopes or global tables like processed_messages.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { Pool, PoolClient } from "pg";

const DELETE_SQL: string[] = [
  `DELETE FROM edges WHERE scope_id = $1`,
  `DELETE FROM nodes WHERE scope_id = $1`,
  `DELETE FROM swarm_state WHERE scope_id = $1`,
  `DELETE FROM convergence_history WHERE scope_id = $1`,
  `DELETE FROM decision_records WHERE scope_id = $1`,
  `DELETE FROM finality_certificates WHERE scope_id = $1`,
  `DELETE FROM scope_finality_decisions WHERE scope_id = $1`,
  `DELETE FROM causal_contributions WHERE scope_id = $1`,
  `DELETE FROM evidence_states WHERE scope_id = $1`,
  `DELETE FROM propagation_history WHERE scope_id = $1`,
  `DELETE FROM e17_perturbation_profiles WHERE scope_id = $1`,
  `DELETE FROM usage_events WHERE scope_id = $1`,
  `DELETE FROM usage_rollups WHERE scope_id = $1`,
  `DELETE FROM context_events WHERE COALESCE(data->>'scope_id', data->'payload'->>'scope_id') = $1`,
  `DELETE FROM demo_sessions WHERE scope_id = $1`,
  `DELETE FROM mitl_pending WHERE proposal->>'scope_id' = $1 OR action_payload->>'scope_id' = $1`,
];

async function tryExec(c: PoolClient, sql: string, scopeId: string): Promise<void> {
  try {
    await c.query(sql, [scopeId]);
  } catch {
    // table missing in older installs
  }
}

export async function resetScopeData(
  pool: Pool,
  scopeId: string,
  opts?: { s3?: S3Client; bucket?: string; storagePrefix?: string },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const sql of DELETE_SQL) {
      await tryExec(client, sql, scopeId);
    }
    await tryExec(client, "DELETE FROM scope_documents WHERE scope_id = $1", scopeId);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  if (opts?.s3 && opts.bucket && opts.storagePrefix) {
    let token: string | undefined;
    do {
      const list = await opts.s3.send(
        new ListObjectsV2Command({
          Bucket: opts.bucket,
          Prefix: opts.storagePrefix.replace(/\/$/, "") + "/",
          ContinuationToken: token,
        }),
      );
      const keys = (list.Contents ?? []).map((o) => o.Key).filter(Boolean) as string[];
      if (keys.length) {
        await opts.s3.send(
          new DeleteObjectsCommand({
            Bucket: opts.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
}
