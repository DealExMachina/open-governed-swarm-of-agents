import { randomUUID } from "crypto";
import { makeEventBus, type EventBus } from "../eventBus.js";
import { initState } from "../stateGraph.js";
import { requestRuntimeControl } from "../runtimeControlRpc.js";
import { toErrorString } from "../errors.js";
import { getHatcheryInstance } from "../hatchery.js";
import { NATS_STREAM } from "./config.js";

/**
 * Bind hatchery (in-process or via NATS RPC) to scope before ingesting docs.
 * Also ensures swarm_state exists for the scope.
 */
export async function ensureHatcheryBoundToScope(
  scopeId: string,
): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  try {
    await initState(scopeId, randomUUID());
  } catch (e) {
    return {
      ok: false,
      error: "swarm_state_init_failed",
      detail: toErrorString(e),
    };
  }
  const hatchery = getHatcheryInstance();
  if (hatchery) {
    try {
      await hatchery.rebindActiveScope(scopeId, null);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: "hatchery_rebind_failed",
        detail: toErrorString(e),
      };
    }
  }
  const rpc = await requestRuntimeControl({
    action: "start",
    scope_id: scopeId,
    tenant_id: null,
  });
  if (!rpc.ok) {
    return {
      ok: false,
      error: "runtime_rpc_unavailable",
      detail: rpc.error ?? "unknown_error",
    };
  }
  return { ok: true };
}

let _feedBus: EventBus | null = null;

export async function getFeedBus(): Promise<EventBus> {
  if (!_feedBus) {
    _feedBus = await makeEventBus();
    await _feedBus.ensureStream(NATS_STREAM, [
      "swarm.events.>",
    ]);
  }
  return _feedBus;
}
