import type { IncomingMessage, ServerResponse } from "http";
import { appendEvent } from "../contextWal.js";
import { createSwarmEvent } from "../events.js";
import { toErrorString } from "../errors.js";
import { makeS3 } from "../s3.js";
import { appendResolutionGoal } from "../semanticGraph.js";
import { readJsonBody, sendJson } from "./http.js";
import { readScopeIdFromRequest, validateScopeAccess } from "./scope.js";
import { ensureHatcheryBoundToScope, getFeedBus } from "./runtime.js";
import { RUNTIME_SCOPE_ID, S3_BUCKET } from "./config.js";

/** POST /context/docs: add a document to the WAL (type context_doc). Triggers facts pipeline. */
export async function handleAddDoc(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const scopeId = readScopeIdFromRequest(req, body);
    if (!scopeId) {
      sendJson(res, 400, { error: "scope_required" });
      return;
    }
    const valid = await validateScopeAccess(scopeId);
    if (!valid.ok) {
      sendJson(res, valid.status, {
        error: valid.error,
        runtime_scope_id: RUNTIME_SCOPE_ID,
      });
      return;
    }
    const title = typeof body.title === "string" ? body.title : "doc";
    const text =
      typeof body.body === "string"
        ? body.body
        : typeof body.text === "string"
          ? body.text
          : "";
    if (!text) {
      sendJson(res, 400, { error: "body or text required" });
      return;
    }
    const bound = await ensureHatcheryBoundToScope(scopeId);
    if (!bound.ok) {
      sendJson(res, 503, {
        error: bound.error,
        detail: bound.detail,
        scope_id: scopeId,
      });
      return;
    }
    const event = createSwarmEvent(
      "context_doc",
      { title, text, source: "api", scope_id: scopeId },
      { source: "feed" },
    );
    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    const bus = await getFeedBus();
    await bus.publishEvent(event);
    sendJson(res, 200, {
      seq,
      ok: true,
      message:
        "Document added; facts pipeline will run when agents process it.",
    });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

/** POST /context/resolution: add a manual resolution/decision to the WAL (type resolution). Integrates as new context so facts re-run and drift can clear; graph and fact history record the resolution. Optional node_ids: when provided (e.g. from Choose A/B), marks those contradiction nodes resolved. When absent (freeform), uses semantic matching to find and mark addressed contradictions. */
export async function handleAddResolution(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const scopeId = readScopeIdFromRequest(req, body);
    if (!scopeId) {
      sendJson(res, 400, { error: "scope_required" });
      return;
    }
    const valid = await validateScopeAccess(scopeId);
    if (!valid.ok) {
      sendJson(res, valid.status, {
        error: valid.error,
        runtime_scope_id: RUNTIME_SCOPE_ID,
      });
      return;
    }
    const bound = await ensureHatcheryBoundToScope(scopeId);
    if (!bound.ok) {
      sendJson(res, 503, {
        error: bound.error,
        detail: bound.detail,
        scope_id: scopeId,
      });
      return;
    }

    const decision =
      typeof body.decision === "string"
        ? body.decision
        : typeof body.text === "string"
          ? body.text
          : "";
    if (!decision.trim()) {
      sendJson(res, 400, { error: "decision or text required" });
      return;
    }
    const summary = typeof body.summary === "string" ? body.summary : "";
    const nodeIds = Array.isArray(body.node_ids)
      ? (body.node_ids as unknown[]).map(String).filter((id) => id.length > 0)
      : [];

    const event = createSwarmEvent(
      "resolution",
      {
        decision: decision.trim(),
        summary: summary.trim() || decision.trim().slice(0, 80),
        text: decision.trim(),
        source: "user",
        scope_id: scopeId,
      },
      { source: "feed" },
    );
    const seq = await appendEvent(event as unknown as Record<string, unknown>);
    const bus = await getFeedBus();
    await bus.publishEvent(event);
    try {
      await appendResolutionGoal(scopeId, decision.trim(), summary.trim(), undefined, seq);
    } catch (err) {
      process.stderr.write(
        `[feed] appendResolutionGoal failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    let evaluationResult: Record<string, unknown> = {};
    try {
      const {
        markResolved: markResolvedSvc,
        markResolvedByText: markResolvedByTextSvc,
      } = await import("../resolutionService.js");
      const s3ForResolution = S3_BUCKET ? makeS3() : null;
      if (nodeIds.length > 0) {
        // HITL selected specific contradictions — mark them (and near-duplicates) resolved.
        // Do not require LLM confidence: the human already chose these node_ids.
        const resolvedIds: string[] = [];
        const reason = decision.trim()
          ? `HITL resolution: ${decision.trim().slice(0, 400)}`
          : "HITL resolution (explicit node selection)";
        for (const nodeId of nodeIds) {
          try {
            const r = await markResolvedSvc({
              scope_id: scopeId,
              node_id: nodeId,
              judgment: "resolved",
              reason,
              s3Client: s3ForResolution,
              bucket: S3_BUCKET ?? undefined,
            });
            resolvedIds.push(nodeId, ...(r.cascaded ?? []));
          } catch (err) {
            process.stderr.write(
              `[feed] mark-resolved failed for ${nodeId}: ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
        evaluationResult = {
          method: "explicit_node_ids",
          marked: [...new Set(resolvedIds)],
          evaluations: nodeIds.map((id) => ({
            node_id: id,
            resolved: resolvedIds.includes(id),
            confidence: 1,
            reason,
          })),
        };
      } else {
        const result = await markResolvedByTextSvc({
          scope_id: scopeId,
          resolution_text: decision.trim(),
          s3Client: s3ForResolution,
          bucket: S3_BUCKET ?? undefined,
        });
        evaluationResult = result as unknown as Record<string, unknown>;
      }
    } catch (err) {
      process.stderr.write(
        `[feed] resolution service error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    sendJson(res, 200, {
      seq,
      ok: true,
      message: "Resolution evaluated against active contradictions.",
      evaluation: evaluationResult,
    });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}
