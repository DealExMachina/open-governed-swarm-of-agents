import { randomUUID } from "crypto";
import { getPool } from "./db.js";

export interface DemoSession {
  session_id: string;
  scenario_id: string;
  scope_id: string;
  status: string;
  created_at: string;
  closed_at: string | null;
}

export async function startDemoSession(scenarioId: string, scopeId: string): Promise<DemoSession> {
  const pool = getPool();
  const sessionId = `demo-${randomUUID()}`;
  const res = await pool.query<DemoSession>(
    `INSERT INTO demo_sessions (session_id, scenario_id, scope_id, status)
     VALUES ($1, $2, $3, 'active')
     RETURNING session_id, scenario_id, scope_id, status, created_at, closed_at`,
    [sessionId, scenarioId, scopeId],
  );
  return res.rows[0];
}

export async function closeDemoSession(sessionId: string): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query(
    `UPDATE demo_sessions
     SET status = 'closed', closed_at = now()
     WHERE session_id = $1 AND status = 'active'`,
    [sessionId],
  );
  return (res.rowCount ?? 0) > 0;
}

