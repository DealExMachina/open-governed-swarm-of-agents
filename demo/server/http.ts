import type { IncomingMessage, ServerResponse } from "http";

const SWARM_API_TOKEN = process.env.SWARM_API_TOKEN ?? "";

export function authHeaders(): Record<string, string> {
  if (SWARM_API_TOKEN) {
    return { Authorization: `Bearer ${SWARM_API_TOKEN}` };
  }
  return {};
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export async function proxyGet(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: authHeaders() });
  return r.json();
}

export async function proxyPost(url: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  return r.json();
}
