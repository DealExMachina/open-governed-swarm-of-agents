import { join } from "path";

export const FEED_PORT = parseInt(process.env.FEED_PORT ?? "3002", 10);
export const NATS_STREAM = process.env.NATS_STREAM ?? "SWARM_JOBS";
export const S3_BUCKET = process.env.S3_BUCKET ?? null;
export const GOVERNANCE_PATH =
  process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");
export const RUNTIME_SCOPE_ID = process.env.SCOPE_ID ?? "default";
export const ACCEPT_ANY_SCOPE = process.env.ACCEPT_ANY_SCOPE === "1";
export const MITL_URL = (
  process.env.MITL_URL ?? "http://localhost:3001"
).replace(/\/$/, "");
