import type { IncomingMessage, ServerResponse } from "http";
import { toErrorString } from "../errors.js";
import { getPool } from "../db.js";
import { makeS3 } from "../s3.js";
import { getStudioGraphElements } from "../semanticGraph.js";
import {
  listStudioCatalogScopes,
  createStudioCatalogScope,
} from "../studioCatalog.js";
import { loadCorpusDocuments, listStudioCorpora } from "../studioCorpora.js";
import { resetScopeAndReinit } from "../scopeReset.js";
import { reinitAllScenarioScopes } from "../studioScopeReinit.js";
import { scopeStoragePrefix } from "../scopeStorage.js";
import { resolveUploadDocumentBody } from "../documentExtract.js";
import { listScopeDocumentProgress } from "../studioDocumentProgress.js";
import { getQuery, readJsonBody, sendJson } from "./http.js";
import { readScopeIdFromRequest, validateScopeAccess } from "./scope.js";
import { ensureHatcheryBoundToScope } from "./runtime.js";
import { ingestContextDoc } from "./ingest.js";
import { RUNTIME_SCOPE_ID, S3_BUCKET } from "./config.js";

export async function handleStudioElements(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const scopeId = readScopeIdFromRequest(req);
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
  try {
    const elements = await getStudioGraphElements(scopeId);
    sendJson(res, 200, { scope_id: scopeId, ...elements });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

export async function handleStudioScopesList(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const scopes = await listStudioCatalogScopes();
    sendJson(res, 200, { scopes });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

export async function handleStudioScopeCreate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const tag = typeof body.tag === "string" ? body.tag.trim() : "custom";
    let id =
      typeof body.id === "string"
        ? body.id.trim().replace(/\s+/g, "-").toLowerCase()
        : "";
    if (!name) {
      sendJson(res, 400, { error: "name_required" });
      return;
    }
    if (!id) {
      id = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
    }
    if (!id) {
      sendJson(res, 400, { error: "id_required" });
      return;
    }
    const scope = await createStudioCatalogScope({ id, name, tag });
    try {
      await initState(id, randomUUID());
    } catch {
      // catalog created; state init best-effort
    }
    sendJson(res, 201, { scope });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

export async function handleStudioListDocs(
  _req: IncomingMessage,
  res: ServerResponse,
  scopeId: string,
): Promise<void> {
  const valid = await validateScopeAccess(scopeId);
  if (!valid.ok) {
    sendJson(res, valid.status, {
      error: valid.error,
      runtime_scope_id: RUNTIME_SCOPE_ID,
    });
    return;
  }
  try {
    const { documents, progress } = await listScopeDocumentProgress(scopeId);
    sendJson(res, 200, { scope_id: scopeId, documents, progress });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

export async function handleStudioLoadCorpus(
  req: IncomingMessage,
  res: ServerResponse,
  scopeId: string,
): Promise<void> {
  const valid = await validateScopeAccess(scopeId);
  if (!valid.ok) {
    sendJson(res, valid.status, {
      error: valid.error,
      runtime_scope_id: RUNTIME_SCOPE_ID,
    });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const corpus =
      typeof body.corpus === "string"
        ? body.corpus
        : (getQuery(req.url ?? "").corpus ?? "");
    if (!corpus) {
      sendJson(res, 400, {
        error: "corpus_required",
        corpora: listStudioCorpora(),
      });
      return;
    }
    const docs = loadCorpusDocuments(corpus);
    if (docs.length === 0) {
      sendJson(res, 404, { error: "corpus_not_found", corpus });
      return;
    }
    // Rebind before ingest so events are processed into this scope.
    const bound = await ensureHatcheryBoundToScope(scopeId);
    if (!bound.ok) {
      sendJson(res, 503, {
        error: bound.error,
        detail: bound.detail,
        scope_id: scopeId,
      });
      return;
    }
    const fed: Array<{ title: string; seq: number }> = [];
    for (const doc of docs) {
      const seq = await ingestContextDoc(scopeId, doc.title, doc.body);
      fed.push({ title: doc.title, seq });
    }
    sendJson(res, 200, {
      ok: true,
      scope_id: scopeId,
      corpus,
      fed: fed.length,
      documents: fed,
      hatchery_bound: true,
    });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

export async function handleStudioUploadDocs(
  req: IncomingMessage,
  res: ServerResponse,
  scopeId: string,
): Promise<void> {
  const valid = await validateScopeAccess(scopeId);
  if (!valid.ok) {
    sendJson(res, valid.status, {
      error: valid.error,
      runtime_scope_id: RUNTIME_SCOPE_ID,
    });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const docs = Array.isArray(body.documents) ? body.documents : [];
    if (docs.length === 0) {
      sendJson(res, 400, { error: "documents_required" });
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
    const fed: Array<{ title: string; seq: number; format?: string }> = [];
    const skipped: Array<{ title: string; reason: string }> = [];
    for (const raw of docs) {
      const row = raw as Record<string, unknown>;
      const title = typeof row.title === "string" ? row.title : "doc";
      let text = "";
      try {
        text = await resolveUploadDocumentBody(row, title);
      } catch (e) {
        skipped.push({
          title,
          reason: toErrorString(e),
        });
        continue;
      }
      if (!text.trim()) {
        skipped.push({ title, reason: "empty_document" });
        continue;
      }
      const seq = await ingestContextDoc(scopeId, title, text);
      fed.push({
        title,
        seq,
        format:
          typeof row.filename === "string"
            ? row.filename.split(".").pop()?.toLowerCase()
            : undefined,
      });
    }
    if (fed.length === 0) {
      sendJson(res, 400, {
        error: "no_ingestible_documents",
        skipped,
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      scope_id: scopeId,
      fed: fed.length,
      documents: fed,
      skipped: skipped.length ? skipped : undefined,
      hatchery_bound: true,
    });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

/** POST /studio/scopes/:id/activate — bind hatchery to this scope (no ingest). */
export async function handleStudioActivate(
  _req: IncomingMessage,
  res: ServerResponse,
  scopeId: string,
): Promise<void> {
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
  sendJson(res, 200, { ok: true, scope_id: scopeId, hatchery_bound: true });
}

/** POST /studio/scopes/:id/reset — wipe graph + reinit catalog badge and swarm_state. */
export async function handleStudioReset(
  _req: IncomingMessage,
  res: ServerResponse,
  scopeId: string,
): Promise<void> {
  const valid = await validateScopeAccess(scopeId);
  if (!valid.ok) {
    sendJson(res, valid.status, {
      error: valid.error,
      runtime_scope_id: RUNTIME_SCOPE_ID,
    });
    return;
  }
  try {
    await resetScopeAndReinit(getPool(), scopeId, {
      s3: S3_BUCKET ? makeS3() : undefined,
      bucket: S3_BUCKET ?? undefined,
      storagePrefix: scopeStoragePrefix(scopeId),
    });
    sendJson(res, 200, { ok: true, scope_id: scopeId });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}

/** POST /studio/scopes/reset-all — wipe ephemeral + reinit all scenario catalog scopes. */
export async function handleStudioResetAll(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const result = await reinitAllScenarioScopes(getPool());
    sendJson(res, 200, { ok: true, ...result });
  } catch (e) {
    sendJson(res, 500, { error: toErrorString(e) });
  }
}
