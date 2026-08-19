/**
 * Reinit Studio scenario scopes (same behavior as scripts/ops/reinit-scenario-scopes.ts).
 */
import type { Pool } from "pg";
import type { S3Client } from "@aws-sdk/client-s3";
import {
  BASIC_EXAMPLE_SCOPE,
  DEFAULT_CUSTOM_SCOPE_ID,
  EPHEMERAL_SCOPE_IDS,
  SCENARIO_SCOPES,
} from "./scenarioScopes.js";
import { deleteCatalogScope, ensureScenarioCatalogScope } from "./catalog.js";
import { resetScopeAndReinit } from "../scopeReset.js";
import { makeS3 } from "../s3.js";
import { scopeStoragePrefix } from "../scopeStorage.js";

export type ScopeResetOpts = {
  s3?: S3Client;
  bucket?: string;
  storagePrefix?: string;
};

export function scopeResetOpts(scopeId: string): ScopeResetOpts | undefined {
  const bucket = process.env.S3_BUCKET;
  if (!bucket || !process.env.S3_ENDPOINT) return undefined;
  return {
    s3: makeS3(),
    bucket,
    storagePrefix: scopeStoragePrefix(scopeId),
  };
}

export type ReinitAllScenarioScopesResult = {
  removed_ephemeral: string[];
  reset_scopes: string[];
};

/** Wipe ephemeral scopes and reinit all scenario + default catalog scopes. */
export async function reinitAllScenarioScopes(
  pool: Pool,
): Promise<ReinitAllScenarioScopesResult> {
  const removed_ephemeral: string[] = [];
  const reset_scopes: string[] = [];

  for (const id of EPHEMERAL_SCOPE_IDS) {
    await deleteCatalogScope(id);
    removed_ephemeral.push(id);
  }

  for (const def of Object.values(SCENARIO_SCOPES)) {
    await ensureScenarioCatalogScope({
      id: def.scopeId,
      name: def.name,
      tag: def.tag,
    });
    await resetScopeAndReinit(pool, def.scopeId, scopeResetOpts(def.scopeId));
    reset_scopes.push(def.scopeId);
  }

  await ensureScenarioCatalogScope({
    id: BASIC_EXAMPLE_SCOPE.scopeId,
    name: BASIC_EXAMPLE_SCOPE.name,
    tag: BASIC_EXAMPLE_SCOPE.tag,
  });
  await resetScopeAndReinit(
    pool,
    DEFAULT_CUSTOM_SCOPE_ID,
    scopeResetOpts(DEFAULT_CUSTOM_SCOPE_ID),
  );
  reset_scopes.push(DEFAULT_CUSTOM_SCOPE_ID);

  return { removed_ephemeral, reset_scopes };
}
