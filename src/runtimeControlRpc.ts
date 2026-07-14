import { connect, StringCodec } from "nats";
import type { AgentHatchery } from "./hatchery.js";
import { toErrorString } from "./errors.js";

const sc = StringCodec();

const RUNTIME_CONTROL_SUBJECT =
  process.env.SWARM_RUNTIME_CONTROL_SUBJECT ?? "swarm.runtime.control";
const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.SWARM_RUNTIME_CONTROL_TIMEOUT_MS ?? "5000",
  10,
);
const REQUEST_RETRIES = Math.max(
  0,
  parseInt(process.env.SWARM_RUNTIME_CONTROL_RETRIES ?? "1", 10),
);

type RuntimeAction =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "restart"
  | "snapshot";

type RuntimeControlRequest = {
  action: RuntimeAction;
  scope_id?: string;
  tenant_id?: string | null;
};

type RuntimeControlResponse = {
  ok: boolean;
  hatchery?: Record<string, unknown> | null;
  error?: string;
};

export async function requestRuntimeControl(
  req: RuntimeControlRequest,
): Promise<RuntimeControlResponse> {
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    let nc: Awaited<ReturnType<typeof connect>> | null = null;
    try {
      nc = await connect({ servers: NATS_URL, timeout: REQUEST_TIMEOUT_MS });
      const msg = await nc.request(
        RUNTIME_CONTROL_SUBJECT,
        sc.encode(JSON.stringify(req)),
        { timeout: REQUEST_TIMEOUT_MS },
      );
      return JSON.parse(sc.decode(msg.data)) as RuntimeControlResponse;
    } catch (err) {
      const isLast = attempt >= REQUEST_RETRIES;
      if (isLast) {
        return {
          ok: false,
          error: classifyRpcError(err),
        };
      }
    } finally {
      if (nc) {
        try {
          await nc.drain();
        } catch {
          // best effort close
        }
      }
    }
  }
  return { ok: false, error: "runtime_rpc_request_failed" };
}

export async function startRuntimeControlResponder(
  hatchery: AgentHatchery,
): Promise<() => Promise<void>> {
  const nc = await connect({ servers: NATS_URL, timeout: REQUEST_TIMEOUT_MS });
  const sub = nc.subscribe(RUNTIME_CONTROL_SUBJECT);

  (async () => {
    for await (const m of sub) {
      let response: RuntimeControlResponse;
      try {
        const req = JSON.parse(sc.decode(m.data)) as RuntimeControlRequest;
        response = await handleRuntimeRequest(hatchery, req);
      } catch (e) {
        response = { ok: false, error: toErrorString(e) };
      }
      m.respond(sc.encode(JSON.stringify(response)));
    }
  })().catch((e) => {
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        msg: "runtime_control_responder_failed",
        error: toErrorString(e),
      }) + "\n",
    );
  });

  return async () => {
    sub.unsubscribe();
    await nc.drain();
  };
}

async function handleRuntimeRequest(
  hatchery: AgentHatchery,
  req: RuntimeControlRequest,
): Promise<RuntimeControlResponse> {
  switch (req.action) {
    case "start": {
      if (!req.scope_id) return { ok: false, error: "scope_required" };
      await hatchery.rebindActiveScope(req.scope_id, req.tenant_id ?? null);
      return {
        ok: true,
        hatchery: hatchery.getSnapshot() as unknown as Record<string, unknown>,
      };
    }
    case "pause":
      await hatchery.pauseAll();
      return {
        ok: true,
        hatchery: hatchery.getSnapshot() as unknown as Record<string, unknown>,
      };
    case "resume":
      await hatchery.resume();
      return {
        ok: true,
        hatchery: hatchery.getSnapshot() as unknown as Record<string, unknown>,
      };
    case "stop":
      await hatchery.shutdown();
      return { ok: true, hatchery: null };
    case "restart": {
      if (!req.scope_id) return { ok: false, error: "scope_required" };
      await hatchery.rebindActiveScope(req.scope_id, req.tenant_id ?? null);
      await hatchery.resume();
      return {
        ok: true,
        hatchery: hatchery.getSnapshot() as unknown as Record<string, unknown>,
      };
    }
    case "snapshot":
      return {
        ok: true,
        hatchery: hatchery.getSnapshot() as unknown as Record<string, unknown>,
      };
    default:
      return { ok: false, error: "unsupported_action" };
  }
}

function classifyRpcError(err: unknown): string {
  const msg = toErrorString(err).toLowerCase();
  if (msg.includes("timeout")) return "runtime_rpc_timeout";
  if (msg.includes("no responders")) return "runtime_rpc_no_responder";
  if (msg.includes("connection") || msg.includes("connect"))
    return "runtime_rpc_connection_failed";
  return "runtime_rpc_request_failed";
}
