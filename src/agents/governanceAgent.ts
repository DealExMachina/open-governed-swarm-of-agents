import "dotenv/config";
import { setMaxListeners } from "events";
import { join } from "path";
import type { S3Client } from "@aws-sdk/client-s3";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Agent } from "@mastra/core/agent";
import { s3GetText } from "../s3.js";
import { loadState } from "../stateGraph.js";
import { loadPolicies, getGovernanceForScope } from "../governance.js";
import { evaluateKernel } from "../sgrsAdapter.js";
import { getGovernancePolicyVersion } from "../policyVersions.js";
import { buildDecisionRecordFromKernel } from "../governanceHelpers.js";
import { persistDecisionRecord } from "../decisionRecorder.js";
import { executeObligations } from "../obligationEnforcer.js";
import { checkPermission } from "../policy.js";
import { appendEvent } from "../contextWal.js";
import { emitContribution } from "../causalEmit.js";
import { addPending } from "../mitlServer.js";
import { isProcessed, markProcessed } from "../messageDedup.js";
import type { EventBus } from "../eventBus.js";
import { logger, setLogContext } from "../logger.js";
import { recordProposal, recordPolicyViolation, recordGovernanceMode, recordGovernancePath, recordGovernanceLoopMs } from "../metrics.js";
import { getChatModelConfig, getOversightModelConfig, DETERMINISTIC_SETTINGS, GovernanceOutputSchema } from "../modelConfig.js";
import type { Proposal, Action } from "../events.js";
import { makeReadGovernanceRulesTool } from "./sharedTools.js";
import { composeInstructions } from "../skills/loader.js";
import { trackAgentTokens } from "../skills/tokenTracker.js";

/** Result of deterministic governance evaluation (no side effects). */
export interface DeterministicResult {
  outcome: "approve" | "reject" | "pending" | "ignore";
  reason: string;
  /** Policy engine record for audit; present when policy was evaluated. Persisted at commit. */
  record?: import("../policyEngine.js").DecisionRecord;
  actionPayload?: {
    expectedEpoch: number;
    runId: string;
    from: string;
    to: string;
    type?: string;
    drift_level?: string;
    drift_types?: string[];
    block_reason?: string;
  };
}

/**
 * Audit path: which governance path produced the decision. Recorded in context_events for E2E and audits.
 * - processProposal: direct deterministic (MASTER/MITL or YOLO with no LLM)
 * - oversight_acceptDeterministic: YOLO + oversight chose to accept deterministic result
 * - oversight_escalateToLLM: YOLO + oversight chose full LLM (decision then comes from processProposalWithAgent)
 * - oversight_escalateToHuman: YOLO + oversight chose MITL
 * - processProposalWithAgent: full governance LLM decided (approve/reject)
 */
export type GovernancePath =
  | "processProposal"
  | "processProposal_yoloOverride"
  | "processProposal_mitlEscalation"
  | "processProposal_masterReject"
  | "oversight_acceptDeterministic"
  | "oversight_escalateToLLM"
  | "oversight_escalateToHuman"
  | "processProposalWithAgent";
import { evaluateFinality } from "../finalityEvaluator.js";
import { submitFinalityReviewForScope } from "../hitlFinalityRequest.js";
import { CircuitBreaker } from "../resilience.js";

/** LLM circuit breaker: opens after 3 consecutive failures, 60s cooldown. */
const llmBreaker = new CircuitBreaker("governance-llm", 3, 60000);

const AGENT_ID = process.env.AGENT_ID ?? "governance-1";
const NATS_STREAM = process.env.NATS_STREAM ?? "SWARM_JOBS";
const SCOPE_ID = process.env.SCOPE_ID ?? "default";
setLogContext({ agent_id: AGENT_ID, role: "governance" });

export interface GovernanceAgentEnv {
  s3: S3Client;
  bucket: string;
  getPublishAction: () => (subject: string, data: Record<string, unknown>) => Promise<void>;
  getPublishRejection: () => (subject: string, data: Record<string, unknown>) => Promise<void>;
}

/**
 * Process one proposal: check transition rules, optionally policy (OpenFGA),
 * then publish Action (approved) or Rejection.
 */
const GOVERNANCE_AGENT_INSTRUCTIONS = `You are the governance agent. You have a proposal to advance the state machine (from, to, expectedEpoch). The proposing agent and target node are in the proposal.
Use readState to see current state and epoch. Use readDrift to see drift level and types. Use readGovernanceRules to see transition rules and policy rules.
Use checkTransition to see if the proposed transition is allowed given drift (e.g. high drift may block). Use checkPolicy to verify the proposing agent is allowed to write to the target node.
You must reject if checkTransition or checkPolicy fails. If all checks pass, call publishApproval with a brief reason; otherwise call publishRejection with the reason.
Call exactly one of: publishApproval(reason) or publishRejection(reason). End with a one-sentence rationale.`;

const OVERSIGHT_AGENT_INSTRUCTIONS = `You are the oversight agent. You review a governance proposal and its deterministic check result.
You must choose exactly one option:
1. acceptDeterministic - Accept the deterministic result as-is (approve, reject, or pending will be applied). Use when the deterministic result is clearly correct and either (a) no obligations were triggered, or (b) obligations were triggered but the proposal is a routine technical operation (e.g., fact extraction, state sync) with no material business stakes.
2. escalateToLLM - Send to the full governance LLM for richer reasoning. Use when obligations were triggered (open_investigation, request_source_refresh) AND the proposal involves genuine business stakes: financial exposure, unresolved contradictions in legal or compliance matters, probabilistic assessments, or contested claims. Use when acceptDeterministic would lose important context.
3. escalateToHuman - Send to human-in-the-loop (MITL). Use only when obligations include halt_and_review, when the proposal explicitly flags material financial discrepancies or IP title disputes requiring human judgment, or when critical risk factors (talent departure, deal-blocking defects) are explicitly described.

DECISION GUIDE: obligations triggered on a routine technical proposal → acceptDeterministic. Obligations triggered on a business governance proposal with financial/legal/compliance context → escalateToLLM. halt_and_review obligation or explicit request for human review → escalateToHuman.
Call exactly one of these three tools.`;

function createOversightTools(
  proposal: Proposal,
  deterministicResult: DeterministicResult,
  env: GovernanceAgentEnv,
): { tools: Record<string, ReturnType<typeof createTool>>; getChosen: () => string | null } {
  const chosen: { value: string | null } = { value: null };
  const acceptDeterministicTool = createTool({
    id: "acceptDeterministic",
    description: "Accept the deterministic result. The pre-computed outcome (approve, reject, or pending) will be published.",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => {
      chosen.value = "acceptDeterministic";
      await commitDeterministicResult(proposal, deterministicResult, env, "oversight_acceptDeterministic");
      return { ok: true };
    },
  });
  const escalateToLLMTool = createTool({
    id: "escalateToLLM",
    description: "Escalate to the full governance LLM for richer reasoning and a final approve/reject decision.",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => {
      chosen.value = "escalateToLLM";
      await processProposalWithAgent(proposal, env);
      return { ok: true };
    },
  });
  const escalateToHumanTool = createTool({
    id: "escalateToHuman",
    description: "Escalate to human-in-the-loop (MITL) for manual approval.",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => {
      chosen.value = "escalateToHuman";
      const actionPayload = deterministicResult.actionPayload;
      if (actionPayload) {
        const { proposal_id, proposed_action } = proposal;
        recordProposal(proposed_action, "pending");
        await addPending(proposal_id, proposal, actionPayload);
        await env.getPublishAction()(`swarm.pending_approval.${proposal_id}`, {
          proposal_id,
          status: "pending",
        } as Record<string, unknown>);
        await appendEvent({
          type: "proposal_pending_approval",
          proposal_id,
          governance_path: "oversight_escalateToHuman",
          scope_id: SCOPE_ID,
        });
        await emitContribution("governance-agent", "assessment", {
          type: "proposal_pending_approval",
          proposal_id,
          governance_path: "oversight_escalateToHuman",
        }, { authorityTier: 2, governanceMode: proposal.mode });
        logger.info("proposal pending MITL approval (oversight)", { proposal_id });
      } else {
        await commitDeterministicResult(proposal, deterministicResult, env);
      }
      return { ok: true };
    },
  });
  return {
    tools: {
      acceptDeterministic: acceptDeterministicTool,
      escalateToLLM: escalateToLLMTool,
      escalateToHuman: escalateToHumanTool,
    },
    getChosen: () => chosen.value,
  };
}

/**
 * Run the oversight agent: it chooses acceptDeterministic, escalateToLLM, or escalateToHuman.
 * If it does not call any tool (e.g. maxSteps), we fall back to committing the deterministic result.
 */
export async function runOversightAgent(
  proposal: Proposal,
  deterministicResult: DeterministicResult,
  env: GovernanceAgentEnv,
): Promise<void> {
  const modelConfig = getOversightModelConfig();
  if (!modelConfig) {
    await commitDeterministicResult(proposal, deterministicResult, env);
    return;
  }
  const { tools, getChosen } = createOversightTools(proposal, deterministicResult, env);
  const agent = new Agent({
    id: "oversight-agent",
    name: "Oversight Agent",
    instructions: composeInstructions(OVERSIGHT_AGENT_INSTRUCTIONS, "oversight"),
    model: modelConfig,
    tools,
  });
  const summary = `${deterministicResult.outcome}: ${deterministicResult.reason}`;
  const obligations = deterministicResult.record?.obligations ?? [];
  const obligationStr = obligations.length > 0 ? ` Obligations triggered: ${obligations.join(", ")}.` : " No obligations triggered.";
  const jobType = proposal.proposed_action ?? "unknown";
  const prompt = `Proposal: ${proposal.proposal_id} (job_type: ${jobType}), result: ${summary}.${obligationStr} Choose: acceptDeterministic, escalateToLLM, or escalateToHuman.`;
  const LLM_TIMEOUT_MS = 30000;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), LLM_TIMEOUT_MS);
  setMaxListeners(64, abortController.signal);
  try {
    const genResult = await llmBreaker.call(() => agent.generate(prompt, {
      maxSteps: 3,
      abortSignal: abortController.signal,
      modelSettings: DETERMINISTIC_SETTINGS,
    }));
    trackAgentTokens("oversight", genResult);
  } catch (e) {
    if (!getChosen()) {
      logger.warn("oversight LLM failed or circuit open; committing deterministic result", {
        proposal_id: proposal.proposal_id,
        error: String(e),
      });
      await commitDeterministicResult(proposal, deterministicResult, env, "oversight_acceptDeterministic");
      return;
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!getChosen()) {
    logger.info("oversight agent did not call a tool; committing deterministic result", {
      proposal_id: proposal.proposal_id,
    });
    await commitDeterministicResult(proposal, deterministicResult, env, "oversight_acceptDeterministic");
  }
}

function createGovernanceTools(proposal: Proposal, env: GovernanceAgentEnv) {
  const { expectedEpoch, from, to } = (proposal.payload ?? {}) as {
    expectedEpoch?: number;
    from?: string;
    to?: string;
  };
  let decided = false;
  const readStateTool = createTool({
    id: "readState",
    description: "Read the current state graph state (runId, lastNode, epoch).",
    inputSchema: z.object({}),
    outputSchema: z.object({
      state: z.object({
        runId: z.string(),
        lastNode: z.string(),
        epoch: z.number(),
        updatedAt: z.string(),
      }).nullable(),
    }),
    execute: async () => {
      const state = await loadState(SCOPE_ID);
      return { state };
    },
  });
  const readDriftTool = createTool({
    id: "readDrift",
    description: "Read the current drift analysis (level, types).",
    inputSchema: z.object({}),
    outputSchema: z.object({
      drift: z.object({
        level: z.string(),
        types: z.array(z.string()),
      }),
    }),
    execute: async () => {
      const raw = await s3GetText(env.s3, env.bucket, "drift/latest.json");
      const drift = raw
        ? (JSON.parse(raw) as { level: string; types: string[] })
        : { level: "none", types: [] as string[] };
      return { drift };
    },
  });
  const readGovernanceRules = makeReadGovernanceRulesTool();
  const checkTransitionTool = createTool({
    id: "checkTransition",
    description: "Check if the proposed transition (from -> to) is allowed given current drift and governance rules.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      allowed: z.boolean(),
      reason: z.string(),
    }),
    execute: async () => {
      const raw = await s3GetText(env.s3, env.bucket, "drift/latest.json");
      const drift = raw
        ? (JSON.parse(raw) as { level: string; types: string[] })
        : { level: "none", types: [] as string[] };
      const govPath = process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");
      const governance = getGovernanceForScope(SCOPE_ID, loadPolicies(govPath));
      if (from === undefined || to === undefined) {
        return { allowed: false, reason: "missing_from_or_to" };
      }
      const policyVersion = getGovernancePolicyVersion(govPath);
      const kernelResult = evaluateKernel(
        { from_state: from, to_state: to, drift_level: drift.level, drift_types: drift.types, mode: governance.mode ?? "YOLO" },
        governance,
      );
      const record = buildDecisionRecordFromKernel(kernelResult, policyVersion);
      const allowed = kernelResult.verdict !== "reject";
      const scopeMode = governance.mode ?? "YOLO";
      try {
        await persistDecisionRecord(record, {
          governance_path: "processProposalWithAgent",
          scope_id: SCOPE_ID,
          scope_mode: scopeMode,
        });
      } catch (err) {
        logger.warn("persistDecisionRecord failed (checkTransition)", { error: String(err) });
      }
      await executeObligations(record.obligations ?? []);
      return { allowed, reason: record.reason };
    },
  });
  const checkPolicyTool = createTool({
    id: "checkPolicy",
    description: "Check if the proposing agent has permission to write to the target node.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      allowed: z.boolean(),
      error: z.string().optional(),
    }),
    execute: async () => {
      const result = await checkPermission(proposal.agent, "writer", proposal.target_node);
      return { allowed: result.allowed, error: result.error };
    },
  });
  const publishApprovalTool = createTool({
    id: "publishApproval",
    description: "Approve the proposal and publish the action. Only succeeds if state epoch matches and transition and policy checks pass.",
    inputSchema: z.object({
      reason: z.string().describe("Brief reason for approval"),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      error: z.string().optional(),
    }),
    execute: async (input) => {
      if (decided) return { ok: false, error: "already_decided" };
      const reason = (input as { reason?: string })?.reason ?? "policy_passed";
      const state = await loadState(SCOPE_ID);
      if (!state || state.epoch !== expectedEpoch) {
        return { ok: false, error: "state_epoch_mismatch" };
      }
      const driftRaw = await s3GetText(env.s3, env.bucket, "drift/latest.json");
      const drift = driftRaw
        ? (JSON.parse(driftRaw) as { level: string; types: string[] })
        : { level: "none", types: [] as string[] };
      const govPath = process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");
      const governance = getGovernanceForScope(SCOPE_ID, loadPolicies(govPath));
      if (from === undefined || to === undefined) {
        return { ok: false, error: "missing_from_or_to" };
      }
      const policyVersion = getGovernancePolicyVersion(govPath);
      const kernelResult = evaluateKernel(
        { from_state: from, to_state: to, drift_level: drift.level, drift_types: drift.types, mode: governance.mode ?? "YOLO" },
        governance,
      );
      const transitionRecord = buildDecisionRecordFromKernel(kernelResult, policyVersion);
      const transitionAllowed = kernelResult.verdict !== "reject";
      const scopeModeForPublish = governance.mode ?? "YOLO";
      try {
        await persistDecisionRecord(transitionRecord, {
          governance_path: "processProposalWithAgent",
          scope_id: SCOPE_ID,
          scope_mode: scopeModeForPublish,
        });
      } catch (err) {
        logger.warn("persistDecisionRecord failed (publishApproval)", { error: String(err) });
      }
      await executeObligations(transitionRecord.obligations ?? []);
      if (!transitionAllowed) {
        return { ok: false, error: transitionRecord.reason };
      }
      const policyResult = await checkPermission(proposal.agent, "writer", proposal.target_node);
      if (!policyResult.allowed) {
        recordPolicyViolation();
        return { ok: false, error: policyResult.error ?? "policy_denied" };
      }
      decided = true;
      recordProposal(proposal.proposed_action, "approved");
      const action: Action = {
        proposal_id: proposal.proposal_id,
        approved_by: AGENT_ID,
        result: "approved",
        reason,
        action_type: "advance_state",
        payload: { expectedEpoch, runId: state.runId, from, to, scope_id: SCOPE_ID },
      };
      await env.getPublishAction()("swarm.actions.advance_state", action as unknown as Record<string, unknown>);
      await appendEvent({
        type: "proposal_approved",
        proposal_id: proposal.proposal_id,
        reason,
        governance_path: "processProposalWithAgent",
        scope_id: SCOPE_ID,
      });
      await emitContribution("governance-agent", "assessment", {
        type: "proposal_approved",
        proposal_id: proposal.proposal_id,
        reason,
        governance_path: "processProposalWithAgent",
      }, { authorityTier: 2, governanceMode: proposal.mode });
      logger.info("proposal approved (agent)", { proposal_id: proposal.proposal_id, reason });
      return { ok: true };
    },
  });
  const publishRejectionTool = createTool({
    id: "publishRejection",
    description: "Reject the proposal and publish the rejection with a reason.",
    inputSchema: z.object({
      reason: z.string().describe("Reason for rejection"),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
    }),
    execute: async (input) => {
      if (decided) return { ok: true };
      const reason = (input as { reason?: string })?.reason ?? "rejected";
      decided = true;
      recordProposal(proposal.proposed_action, "rejected");
      await env.getPublishRejection()(`swarm.rejections.${proposal.proposed_action}`, {
        proposal_id: proposal.proposal_id,
        reason,
        result: "rejected",
      });
      await appendEvent({
        type: "proposal_rejected",
        proposal_id: proposal.proposal_id,
        reason,
        governance_path: "processProposalWithAgent",
        scope_id: SCOPE_ID,
      });
      await emitContribution("governance-agent", "assessment", {
        type: "proposal_rejected",
        proposal_id: proposal.proposal_id,
        reason,
        governance_path: "processProposalWithAgent",
      }, { authorityTier: 2, governanceMode: proposal.mode });
      logger.info("proposal rejected (agent)", { proposal_id: proposal.proposal_id, reason });
      return { ok: true };
    },
  });
  return {
    readState: readStateTool,
    readDrift: readDriftTool,
    readGovernanceRules,
    checkTransition: checkTransitionTool,
    checkPolicy: checkPolicyTool,
    publishApproval: publishApprovalTool,
    publishRejection: publishRejectionTool,
    isDecided: () => decided,
  };
}

/**
 * Process one proposal using an LLM-backed agent: tools enforce rules; the agent provides reasoning and calls publishApproval or publishRejection.
 * If the agent does not call either tool (e.g. maxSteps reached), we fall back to deterministic processProposal so the proposal is always decided.
 */
export async function processProposalWithAgent(
  proposal: Proposal,
  env: GovernanceAgentEnv,
): Promise<void> {
  const modelConfig = getChatModelConfig();
  if (!modelConfig) {
    await processProposal(proposal, env);
    return;
  }
  const tools = createGovernanceTools(proposal, env);
  const agent = new Agent({
    id: "governance-agent",
    name: "Governance Agent",
    instructions: composeInstructions(GOVERNANCE_AGENT_INSTRUCTIONS, "governance"),
    model: modelConfig,
    tools: {
      readState: tools.readState,
      readDrift: tools.readDrift,
      readGovernanceRules: tools.readGovernanceRules,
      checkTransition: tools.checkTransition,
      checkPolicy: tools.checkPolicy,
      publishApproval: tools.publishApproval,
      publishRejection: tools.publishRejection,
    },
  });
  const prompt = `Proposal: ${proposal.proposal_id}, target: ${proposal.target_node}, payload: ${JSON.stringify(proposal.payload)}. Approve or reject.`;
  const LLM_TIMEOUT_MS = 30000;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), LLM_TIMEOUT_MS);
  setMaxListeners(64, abortController.signal);
  try {
    const genResult = await llmBreaker.call(() => agent.generate(prompt, {
      maxSteps: 8,
      abortSignal: abortController.signal,
      modelSettings: DETERMINISTIC_SETTINGS,
      structuredOutput: { schema: GovernanceOutputSchema, jsonPromptInjection: true },
    }));
    trackAgentTokens("governance", genResult);
  } catch (e) {
    if (!tools.isDecided()) {
      logger.warn("governance LLM failed or circuit open; falling back to rule-based", {
        proposal_id: proposal.proposal_id,
        error: String(e),
      });
      await processProposal(proposal, env);
      return;
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!tools.isDecided()) {
    logger.info("governance agent did not decide; falling back to rule-based", { proposal_id: proposal.proposal_id });
    await processProposal(proposal, env);
  }
}

/**
 * Evaluate a proposal with the same logic as processProposal but without publishing.
 * Returns the outcome and reason (and actionPayload when approve/pending) for use by oversight or commit.
 */
export async function evaluateProposalDeterministic(
  proposal: Proposal,
  env: GovernanceAgentEnv,
): Promise<DeterministicResult> {
  const { agent, proposed_action, target_node, payload, mode } = proposal;
  if (proposed_action !== "advance_state") {
    return { outcome: "ignore", reason: "non advance_state proposal" };
  }

  const { expectedEpoch, from, to } = payload as { expectedEpoch: number; from: string; to: string };
  const state = await loadState(SCOPE_ID);
  if (!state || state.epoch !== expectedEpoch) {
    return { outcome: "reject", reason: "state_epoch_mismatch" };
  }

  const driftRaw = await s3GetText(env.s3, env.bucket, "drift/latest.json");
  const drift = driftRaw
    ? (JSON.parse(driftRaw) as { level: string; types: string[] })
    : { level: "none", types: [] as string[] };
  const govPath = process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");
  const governance = getGovernanceForScope(SCOPE_ID, loadPolicies(govPath));

  // All modes (YOLO, MITL, MASTER) flow through the sgrs reduction kernel.
  const policyVersion = getGovernancePolicyVersion(govPath);
  const kernelOutput = evaluateKernel(
    {
      from_state: from,
      to_state: to,
      drift_level: drift.level,
      drift_types: drift.types,
      mode: mode ?? "YOLO",
    },
    governance,
  );

  const record = buildDecisionRecordFromKernel(kernelOutput, policyVersion, {
    promoteSuggestedToObligations: true,
  });

  if (kernelOutput.verdict === "reject") {
    return {
      outcome: "reject",
      reason: kernelOutput.reason,
      record,
      actionPayload: { expectedEpoch, runId: state.runId, from, to },
    };
  }

  if (kernelOutput.verdict === "escalate") {
    if (kernelOutput.reason === "mitl_required") {
      return {
        outcome: "pending",
        reason: "mitl_required",
        record,
        actionPayload: { expectedEpoch, runId: state.runId, from, to },
      };
    }
    return {
      outcome: "pending",
      reason: kernelOutput.reason,
      record,
      actionPayload: {
        expectedEpoch,
        runId: state.runId,
        from,
        to,
        type: "governance_review",
        drift_level: drift.level,
        drift_types: drift.types,
        block_reason: kernelOutput.reason,
      },
    };
  }

  // Kernel accepted — still need ACL check
  const permissionResult = await checkPermission(agent, "writer", target_node);
  if (!permissionResult.allowed) {
    return {
      outcome: "reject",
      reason: permissionResult.error ?? "policy_denied",
      record,
      actionPayload: { expectedEpoch, runId: state.runId, from, to },
    };
  }

  return {
    outcome: "approve",
    reason: kernelOutput.reason,
    record,
    actionPayload: { expectedEpoch, runId: state.runId, from, to },
  };
}

/**
 * Commit a pre-computed deterministic result: publish action/rejection/pending and record metrics/events.
 * Used by processProposal and by the oversight agent when it chooses acceptDeterministic.
 * @param path - Governance path for audit (context_events); default "processProposal"
 */
export async function commitDeterministicResult(
  proposal: Proposal,
  result: DeterministicResult,
  env: GovernanceAgentEnv,
  path: GovernancePath = "processProposal",
): Promise<void> {
  const { proposal_id, proposed_action } = proposal;
  if (result.outcome === "ignore") {
    logger.debug("ignoring non advance_state proposal", { proposal_id });
    return;
  }

  const govPath = process.env.GOVERNANCE_PATH ?? join(process.cwd(), "governance.yaml");
  const scopeMode = getGovernanceForScope(SCOPE_ID, loadPolicies(govPath)).mode ?? "YOLO";
  recordGovernanceMode(SCOPE_ID, scopeMode);
  recordGovernancePath(path);
  if (result.record) {
    try {
      await persistDecisionRecord(result.record, {
        governance_path: path,
        scope_id: SCOPE_ID,
        scope_mode: scopeMode,
      });
    } catch (err) {
      logger.warn("persistDecisionRecord failed (commitDeterministicResult)", { error: String(err), governance_path: path });
    }
  }

  if (result.outcome === "reject") {
    if (result.reason === "policy_denied") {
      recordPolicyViolation();
    }
    recordProposal(proposed_action, "rejected");
    await env.getPublishRejection()(`swarm.rejections.${proposed_action}`, {
      proposal_id,
      reason: result.reason,
      result: "rejected",
    });
    await appendEvent({
      type: "proposal_rejected",
      proposal_id,
      reason: result.reason,
      governance_path: path,
      scope_id: SCOPE_ID,
    });
    await emitContribution("governance-agent", "assessment", {
      type: "proposal_rejected",
      proposal_id,
      reason: result.reason,
      governance_path: path,
    }, { authorityTier: 2, governanceMode: proposal.mode });
    logger.info("proposal rejected", { proposal_id, reason: result.reason, governance_path: path });
    return;
  }

  if (result.outcome === "pending" && result.actionPayload) {
    recordProposal(proposed_action, "pending");
    await addPending(proposal_id, proposal, result.actionPayload);
    await env.getPublishAction()(`swarm.pending_approval.${proposal_id}`, {
      proposal_id,
      status: "pending",
    } as Record<string, unknown>);
    await appendEvent({
      type: "proposal_pending_approval",
      proposal_id,
      governance_path: path,
      scope_id: SCOPE_ID,
    });
    await emitContribution("governance-agent", "assessment", {
      type: "proposal_pending_approval",
      proposal_id,
      governance_path: path,
    }, { authorityTier: 2, governanceMode: proposal.mode });
    logger.info("proposal pending MITL approval", { proposal_id, governance_path: path });
    return;
  }

  if (result.outcome === "approve" && result.actionPayload) {
    const isMaster = proposal.mode === "MASTER";
    recordProposal(proposed_action, "approved");
    const action: Action = {
      proposal_id,
      approved_by: isMaster ? AGENT_ID : "auto",
      result: "approved",
      reason: result.reason,
      action_type: "advance_state",
      payload: { ...result.actionPayload, scope_id: SCOPE_ID },
    };
    await env.getPublishAction()("swarm.actions.advance_state", action as unknown as Record<string, unknown>);
    await appendEvent({
      type: "proposal_approved",
      proposal_id,
      reason: result.reason,
      governance_path: path,
      scope_id: SCOPE_ID,
    });
    await emitContribution("governance-agent", "assessment", {
      type: "proposal_approved",
      proposal_id,
      reason: result.reason,
      governance_path: path,
    }, { authorityTier: 2, governanceMode: proposal.mode });
    logger.info("proposal approved", { proposal_id, reason: result.reason, governance_path: path });
  }
}

export async function processProposal(
  proposal: Proposal,
  env: GovernanceAgentEnv,
): Promise<void> {
  const result = await evaluateProposalDeterministic(proposal, env);
  // Derive governance path from the kernel's verdict for accurate tier tracking.
  let path: GovernancePath = "processProposal";
  if (result.reason?.startsWith("yolo_override:")) {
    path = "processProposal_yoloOverride";
  } else if (result.outcome === "pending" && result.reason === "mitl_required") {
    path = "processProposal_mitlEscalation";
  } else if (result.outcome === "reject" && proposal.mode === "MASTER") {
    path = "processProposal_masterReject";
  }
  await commitDeterministicResult(proposal, result, env, path);
}

/**
 * Run finality evaluation for the scope; if in near-finality band, submit HITL review.
 * Fire-and-forget: callers should .catch() to log errors without failing the message ack.
 */
export async function runFinalityCheck(scopeId: string): Promise<void> {
  const result = await evaluateFinality(scopeId);
  if (result?.kind === "status") {
    logger.info("finality outcome", { scope_id: scopeId, outcome: result.status });
  } else if (result?.kind === "review") {
    logger.info("finality outcome", {
      scope_id: scopeId,
      outcome: "review_requested",
      goal_score: result.request.goal_score,
    });
    await submitFinalityReviewForScope(scopeId, result);
  } else {
    logger.info("finality outcome", { scope_id: scopeId, outcome: "ACTIVE" });
  }
}

/** Dedicated consumer for swarm.finality.evaluate; acks only after runFinalityCheck succeeds (retry on failure). */
async function runFinalityConsumerLoop(bus: EventBus, signal?: AbortSignal): Promise<void> {
  const stream = process.env.NATS_STREAM ?? "SWARM_JOBS";
  const subject = "swarm.finality.evaluate";
  const consumer = "finality-evaluator";
  logger.info("finality consumer started", { subject, consumer });
  while (!signal?.aborted) {
    const processed = await bus.consume(
      stream,
      subject,
      consumer,
      async (msg) => {
        const scopeId = String((msg.data as Record<string, unknown>).scope_id ?? "default");
        await runFinalityCheck(scopeId);
      },
      { timeoutMs: 5000, maxMessages: 10 },
    );
    if (processed === 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  logger.info("finality consumer stopped (shutdown signal)");
}

export interface GovernanceLoopOpts {
  signal?: AbortSignal;
  consumerName?: string;
  agentId?: string;
  onHeartbeat?: (processed: number) => void;
  /** When false, skip starting the MITL HTTP server (avoid port conflicts in multi-instance). */
  startMitl?: boolean;
}

export async function runGovernanceAgentLoop(bus: EventBus, s3: S3Client, bucket: string, signalOrOpts?: AbortSignal | GovernanceLoopOpts): Promise<void> {
  const opts: GovernanceLoopOpts = signalOrOpts instanceof AbortSignal
    ? { signal: signalOrOpts }
    : (signalOrOpts ?? {});
  const signal = opts.signal;
  const effectiveAgentId = opts.agentId ?? AGENT_ID;
  const shouldStartMitl = opts.startMitl !== false;

  const { setMitlPublishFns, startMitlServer } = await import("../mitlServer.js");
  const { startResolutionMcpServer } = await import("../resolutionMcp.js");
  const { startWatchdog } = await import("../watchdog.js");
  if (shouldStartMitl) {
    const mitlPort = parseInt(process.env.MITL_PORT ?? "3001", 10);
    setMitlPublishFns(
      (subj, data) => bus.publish(subj, data as Record<string, string>).then(() => {}),
      (subj, data) => bus.publish(subj, data as Record<string, string>).then(() => {}),
    );
    startMitlServer(mitlPort);
    const mcpPort = parseInt(process.env.RESOLUTION_MCP_PORT ?? "3005", 10);
    startResolutionMcpServer(mcpPort, s3, bucket);
  }

  void runFinalityConsumerLoop(bus, signal);

  const { state: watchdogState } = startWatchdog(bus, signal);

  const subject = "swarm.proposals.>";
  const consumer = opts.consumerName ?? `governance-${effectiveAgentId}`;
  logger.info("governance agent started", { subject, consumer, agentId: effectiveAgentId });

  const BACKOFF_MS = 500;
  const BACKOFF_MAX_MS = 5000;
  let delayMs = BACKOFF_MS;

  const env: GovernanceAgentEnv = {
    s3,
    bucket,
    getPublishAction: () => (subj: string, data: Record<string, unknown>) =>
      bus.publish(subj, data as Record<string, string>).then(() => {}),
    getPublishRejection: () => (subj: string, data: Record<string, unknown>) =>
      bus.publish(subj, data as Record<string, string>).then(() => {}),
  };

  while (!signal?.aborted) {
    const processed = await bus.consume(
      NATS_STREAM,
      subject,
      consumer,
      async (msg: { id: string; data: Record<string, unknown> }) => {
        if (await isProcessed(consumer, msg.id)) return;
        const data = msg.data as unknown as Record<string, unknown>;
        const proposal: Proposal = {
          proposal_id: String(data.proposal_id ?? ""),
          agent: String(data.agent ?? ""),
          proposed_action: String(data.proposed_action ?? ""),
          target_node: String(data.target_node ?? ""),
          payload: (data.payload as Record<string, unknown>) ?? {},
          mode: (data.mode as "YOLO" | "MITL" | "MASTER") ?? "YOLO",
        };
        const govLoopStart = Date.now();
        if (proposal.mode === "MASTER" || proposal.mode === "MITL") {
          await processProposal(proposal, env);
        } else {
          const deterministicResult = await evaluateProposalDeterministic(proposal, env);
          if (!getChatModelConfig()) {
            await commitDeterministicResult(proposal, deterministicResult, env);
          } else {
            await runOversightAgent(proposal, deterministicResult, env);
          }
        }
        recordGovernanceLoopMs(Date.now() - govLoopStart);
        await bus.publish("swarm.finality.evaluate", { scope_id: SCOPE_ID } as Record<string, string>);
        watchdogState.lastProposalAt = Date.now();
        await markProcessed(consumer, msg.id);
      },
      { timeoutMs: 5000, maxMessages: 10 },
    );
    opts.onHeartbeat?.(processed);
    if (processed === 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, BACKOFF_MAX_MS);
    } else {
      delayMs = BACKOFF_MS;
    }
  }
  logger.info("governance agent stopped (shutdown signal)");
}
