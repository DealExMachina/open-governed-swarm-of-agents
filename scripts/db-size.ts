/**
 * Evaluate size of swarm storage: Postgres, S3, NATS, Prometheus (telemetry).
 * Use before/after reset-e2e to see cleanup impact.
 *
 * Env: DATABASE_URL, S3_ENDPOINT/S3_ACCESS_KEY (optional), NATS_URL (optional)
 *
 * Run: node --loader ts-node/esm scripts/db-size.ts
 */

import "dotenv/config";
import { execSync } from "child_process";
import pg from "pg";
import { connect } from "nats";
import { makeS3 } from "../src/s3.js";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";

const { Pool } = pg;

const BUCKET = process.env.S3_BUCKET ?? "swarm";
const STREAM = process.env.NATS_STREAM ?? "SWARM_JOBS";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface TableSize {
  table: string;
  rows: number;
  totalBytes: number;
}

async function getDbSizes(): Promise<{ total: number; tables: TableSize[] } | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const dbRes = await pool.query(
      "SELECT pg_database_size(current_database()) AS size"
    );
    const total = Number(dbRes.rows[0]?.size ?? 0);

    const tablesRes = await pool.query(`
      SELECT
        c.relname AS table_name,
        c.reltuples::bigint AS approx_rows,
        pg_total_relation_size(c.oid) AS total_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname NOT LIKE 'pg_%'
      ORDER BY pg_total_relation_size(c.oid) DESC
    `);

    const tables: TableSize[] = (tablesRes.rows ?? []).map((r) => ({
      table: String(r.table_name),
      rows: Number(r.approx_rows ?? 0),
      totalBytes: Number(r.total_bytes ?? 0),
    }));

    return { total, tables };
  } catch {
    return null;
  } finally {
    await pool.end();
  }
}

async function getS3Size(): Promise<{ bytes: number; objects: number } | null> {
  if (!process.env.S3_ENDPOINT || !process.env.S3_ACCESS_KEY) return null;
  try {
    const s3 = makeS3();
    let bytes = 0;
    let objects = 0;
    let continuationToken: string | undefined;
    do {
      const list = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        })
      );
      const contents = list.Contents ?? [];
      for (const c of contents) {
        bytes += c.Size ?? 0;
        objects++;
      }
      continuationToken = list.NextContinuationToken;
    } while (continuationToken);
    return { bytes, objects };
  } catch {
    return null;
  }
}

async function getPrometheusSize(): Promise<number | null> {
  try {
    const out = execSync("docker volume ls -q", {
      encoding: "utf-8",
      timeout: 3000,
    });
    const vol = out.trim().split("\n").find((v) => v.endsWith("_prometheus_data"));
    if (!vol) return null;
    const du = execSync(`docker run --rm -v ${vol}:/data alpine du -sb /data 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 15000,
    });
    const bytes = du.match(/^(\d+)/)?.[1];
    return bytes ? Number(bytes) : null;
  } catch {
    return null;
  }
}

async function getNatsStreamSize(): Promise<{ bytes: number; msgs: number } | null> {
  const url = process.env.NATS_URL ?? "nats://localhost:4222";
  try {
    const nc = await connect({ servers: url, timeout: 5000 });
    try {
      const jsm = await nc.jetstreamManager();
      const info = await jsm.streams.info(STREAM);
      const state = (info as { state?: { bytes?: number; messages?: number } }).state ?? {};
      return {
        bytes: Number(state.bytes ?? 0),
        msgs: Number(state.messages ?? 0),
      };
    } finally {
      await nc.close();
    }
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log("Swarm storage evaluation\n");

  const db = await getDbSizes();
  if (db) {
    console.log("Postgres");
    console.log("  Total DB size:", fmtBytes(db.total));
    if (db.tables.length > 0) {
      console.log("  Per-table:");
      for (const t of db.tables) {
        console.log(
          `    ${t.table.padEnd(28)} ${t.rows.toString().padStart(8)} rows  ${fmtBytes(t.totalBytes).padStart(10)}`
        );
      }
    }
    console.log();
  } else {
    console.log("Postgres: DATABASE_URL not set or unavailable\n");
  }

  const s3 = await getS3Size();
  if (s3) {
    console.log("S3 bucket", BUCKET);
    console.log("  Objects:", s3.objects);
    console.log("  Total size:", fmtBytes(s3.bytes));
    console.log();
  } else {
    console.log("S3: env not set or unavailable\n");
  }

  const nats = await getNatsStreamSize();
  if (nats) {
    console.log("NATS JetStream stream", STREAM);
    console.log("  Messages:", nats.msgs);
    console.log("  Size:", fmtBytes(nats.bytes));
    console.log();
  } else {
    console.log("NATS: stream not found or unavailable\n");
  }

  const prometheus = await getPrometheusSize();
  if (prometheus !== null) {
    console.log("Prometheus (telemetry)");
    console.log("  TSDB size:", fmtBytes(prometheus));
    console.log();
  } else {
    console.log("Prometheus: volume not found or Docker unavailable\n");
  }

  if (db || s3 || nats || prometheus !== null) {
    const total =
      (db?.total ?? 0) +
      (s3?.bytes ?? 0) +
      (nats?.bytes ?? 0) +
      (prometheus ?? 0);
    console.log("Combined (DB + S3 + NATS + Prometheus):", fmtBytes(total));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
