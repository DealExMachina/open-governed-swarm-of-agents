/**
 * Event-driven autonomous agent loop. Pull from swarm.events.> (no push subscription
 * to avoid NATS "duplicate subscription" when durable consumer is still push_bound).
 * Run deterministic filter, self-check OpenFGA, execute agent, publish result, update memory, emit proposal if needed.
 */

import { randomUUID } from "crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import type { EventBus, DrainedMessage } from "./eventBus.js";
import { loadState, transitions } from "./stateGraph.js";
import { getSpec } from "./agentRegistry.js";
import { loadFilterConfig, loadAgentMemory, saveAgentMemory, checkFilter, recordActivation } from "./activationFilters.js";
import { checkPermission } from "./policy.js";
import { loadPolicies, getGovernanceForScope } from "./governance.js";
import { join } from "path";
import { isProcessed, markProcessed } from "./messageDedup.js";
import { createSwarmEvent } from "./events.js";
import { toErrorString } from "./errors.js";
import { logger } from "./logger.js";
import { recordAgentLatency, recordAgentError } from "./metrics.js";
import { runFactsAgent } from "./agents/factsAgent.js";
import { runDriftAgent } from "./agents/driftAgent.js";
import { runResolverAgent } from "./agents/resolverAgent.js";
import { runPlannerAgent } from "./agents/plannerAgent.js";
import { runStatusAgent } from "./agents/statusAgent.js";
import { runPropagationAgent } from "./agents/propagationAgent.js";
import { runDeltasAgent } from "./agents/deltasAgent.js";
import type { AgentSpec } from "./agentRegistry.js";

type AgentRunner = (s3: S3Client, bucket: string, payload: Record<string, unknown>, bus?: EventBus) => Promise<unknown>;

const JOB_RUNNERS: Record<string, AgentRunner> = {
  extract_facts: runFactsAgent,
  check_drift: runDriftAgent,
  resolve_contradictions: runResolverAgent,
  plan_actions: runPlannerAgent,
  propagate_evidence: runPropagationAgent,
  extract_deltas: runDeltasAgent,
  summarize_status: runStatusAgent,
};

function getRunner(spec: AgentSpec): AgentRunner | null {
  return JOB_RUNNERS[spec.jobType] ?? null;
}

function memoryUpdateFromContext(_role: string, context: Record<string, unknown>): Partial<import("./activationFilters.js").AgentMemory> {
  const now = Date.now();
  const update: Partial<import("./activationFilters.js").AgentMemory> = { lastActivatedAt: now };
  if (typeof context.latestSeq === "number") {
    update.lastProcessedSeq = context.latestSeq;
  }
  if (typeof context.currentHash === "string") {
    if (String(context.field ?? "").includes("drift")) {
      update.lastDriftHash = context.currentHash;
    } else {
      update.lastHash = context.currentHash;
    }
  }
  return update;
}

export interface AgentLoopOptions {
  s3: S3Client;
  bucket: string;
  bus: EventBus;
  stream: string;
  agentId: string;
  role: string;
  scopeId?: string;
  /** Abort signal for graceful shutdown — loop exits when aborted. */
  signal?: AbortSignal;
  /** Override NATS consumer name for competing consumers (hatchery mode). */
  consumerName?: string;
  /** Called after every bus.consume batch to prove liveness (hatchery heartbeat). */
  onHeartbeat?: (processed: number) => void;
}

/**
 * Run the event-driven agent loop. Subscribes to events and processes them; does not return.
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<void> {
  const { s3, bucket, bus, stream, agentId, role, scopeId: optsScopeId } = opts;
  const scopeId = optsScopeId ?? process.env.SCOPE_ID ?? "default";
  const spec = getSpec(role);
  if (!spec) {
    logger.error("unknown agent role", { role });
    process.exit(1);
  }
  const runner = getRunner(spec);
  if (!runner) {
    logger.error("no runner for role", { role });
    process.exit(1);
  }
  const s = spec;
  const r = runner;

  const subject = "swarm.events.>";
  const consumer = opts.consumerName ?? `${role}-${agentId}-events`;

  await bus.ensureStream(stream, [subject]);

  // ── Helpers for batch-level ACK/NAK ─────────────────────────────────────
  function ackAll(batch: DrainedMessage[]) {
    for (const m of batch) m.ack();
  }
  function nakAll(batch: DrainedMessage[], delayMs?: number) {
    for (const m of batch) m.nak(delayMs);
  }

  logger.info("agent loop started (batch-drain)", { role, subject, consumer });

  const BACKOFF_MS = 500;
  const BACKOFF_MAX_MS = 5000;
  let delayMs = BACKOFF_MS;

  const signal = opts.signal;

  while (!signal?.aborted) {
    // 1. Drain all pending messages at once
    const batch = await bus.drainBatch(stream, subject, consumer, { timeoutMs: 5000, maxMessages: 50 });
    opts.onHeartbeat?.(batch.length);

    if (batch.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, BACKOFF_MAX_MS);
      continue;
    }
    delayMs = BACKOFF_MS;

    // 2. Filter out own-output events + already-processed → ACK and discard
    const relevant: DrainedMessage[] = [];
    for (const m of batch) {
      const eventType = m.data?.type as string | undefined;
      if (eventType && eventType === s.resultEventType) {
        m.ack();
        continue;
      }
      if (await isProcessed(consumer, m.id)) {
        m.ack();
        continue;
      }
      relevant.push(m);
    }
    if (relevant.length === 0) continue;

    const startMs = Date.now();
    try {
      // 3. State-machine gate (checked once for the batch)
      if (s.requiresNode || s.requiresNodeList?.length) {
        const currentState = await loadState(scopeId);
        if (currentState) {
          const allowed = s.requiresNodeList?.length
            ? s.requiresNodeList.includes(currentState.lastNode)
            : currentState.lastNode === s.requiresNode;
          if (!allowed) {
            ackAll(relevant); // State not ready — ACK to avoid redelivery churn
            continue;
          }
        }
      }

      // 4. Single filter check on global state
      const config = await loadFilterConfig(role);
      const memory = await loadAgentMemory(role);
      const filterCtx = { s3, bucket };
      const activation = await checkFilter(config, memory, filterCtx);
      if (!activation.shouldActivate) {
        logger.info("filter rejected (batch)", { role, reason: activation.reason, batchSize: relevant.length });
        // ACK all — filter checks global state, not individual messages.
        // Re-delivering these same messages would produce the same result.
        ackAll(relevant);
        continue;
      }
      logger.info("filter activated (batch)", { role, reason: activation.reason, batchSize: relevant.length });

      const permitted = await checkPermission(agentId, "writer", s.targetNode);
      if (!permitted.allowed) {
        logger.info("permission denied, skipping", { role, targetNode: s.targetNode });
        ackAll(relevant);
        continue;
      }

      // 5. Single agent run
      const result = await r(s3, bucket, activation.context as Record<string, unknown>, bus);
      const latencyMs = Date.now() - startMs;
      recordAgentLatency(role, latencyMs);
      await recordActivation(role, true, latencyMs);

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(JSON.stringify(result ?? {})) as Record<string, unknown>;
      } catch {
        payload = { wrote: [], facts_hash: undefined };
      }
      await bus.publishEvent(
        createSwarmEvent(s.resultEventType, payload, { source: role }),
      );

      const memUpdate = memoryUpdateFromContext(role, activation.context);
      await saveAgentMemory(role, memUpdate);

      if (s.proposesAdvance && s.advancesTo) {
        const stateBefore = await loadState(scopeId);
        const allowedNode =
          s.requiresNodeList?.length
            ? stateBefore && s.requiresNodeList.includes(stateBefore.lastNode)
            : s.requiresNode == null || (stateBefore && stateBefore.lastNode === s.requiresNode);
        if (stateBefore && allowedNode) {
          const to = transitions[stateBefore.lastNode];
          const govPath = process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");
          const govConfig = getGovernanceForScope(scopeId, loadPolicies(govPath));
          const effectiveMode = (govConfig.mode ?? "YOLO") as "YOLO" | "MITL" | "MASTER";
          const proposal = {
            proposal_id: randomUUID(),
            agent: agentId,
            proposed_action: "advance_state",
            target_node: to,
            payload: {
              expectedEpoch: stateBefore.epoch,
              runId: stateBefore.runId,
              from: stateBefore.lastNode,
              to,
            },
            mode: effectiveMode,
          };
          await bus.publish(`swarm.proposals.${s.jobType}`, proposal as unknown as Record<string, string>);
          logger.info("proposal emitted", { proposal_id: proposal.proposal_id, job_type: s.jobType, mode: effectiveMode });
        }
      }

      // 6. ACK all batch messages after success
      for (const m of relevant) {
        await markProcessed(consumer, m.id);
        m.ack();
      }
    } catch (err) {
      recordAgentError(role);
      const errMsg = toErrorString(err);
      const isTimeoutOrConnect =
        /timeout|TIMEOUT|abort|AbortError|The operation was aborted|fetch failed|ECONNREFUSED/i.test(errMsg) ||
        (err instanceof Error && (err as Error & { name?: string }).name === "AbortError");
      const isPermanent =
        /400|401|403|404|422|bad request|validation|unauthorized|forbidden|not found/i.test(errMsg);
      logger.error("agent loop error", {
        role,
        error: errMsg,
        retry: isTimeoutOrConnect && !isPermanent,
        batchSize: relevant.length,
        ...(isTimeoutOrConnect && !isPermanent
          ? { hint: "Worker/LLM timeout or unreachable. Set FACTS_WORKER_TIMEOUT_MS for heavy steps." }
          : {}),
      });
      if (isTimeoutOrConnect && !isPermanent) {
        // Transient: NAK all with delay so worker/LLM can recover
        nakAll(relevant, 15000);
      } else {
        // Permanent: ACK all to prevent redelivery churn
        ackAll(relevant);
      }
    }
  }
  logger.info("agent loop stopped (shutdown signal)", { role });
}
