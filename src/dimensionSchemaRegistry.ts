/**
 * Runtime dimension schema registry (Couche 0).
 *
 * Loaded when equivalence candidates carry a `dimension`. Used by the generic
 * routing policy (equivalenceRoutingPolicy.ts) for canonical equality checks.
 * Override via DIMENSION_SCHEMA_PATH (JSON/YAML).
 */

import { existsSync, readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import {
  S1_DIMENSION_SCHEMA,
  type DimensionSchemaMap,
} from "./baselines/scenario/dimension-schema.js";

/** Covers all dimensions referenced in test/fixtures/nli-gold-set.yaml. */
export const NLI_GOLD_DIMENSION_SCHEMA: DimensionSchemaMap = {
  ...S1_DIMENSION_SCHEMA,
  scr_ratio: {
    type: "percentage",
    description: "Solvency Capital Requirement ratio",
  },
  own_funds: {
    type: "currency_amount",
    tolerance: 0.03,
    description: "Own funds",
  },
  orsa_summary: { type: "free_text", description: "ORSA summary status" },
  guideline_update: {
    type: "free_text",
    description: "Regulatory guideline changes",
  },
  protocol_version: {
    type: "free_text",
    description: "Clinical trial protocol version",
  },
  gcp_status: { type: "free_text", description: "GCP compliance status" },
  enrollment_stats: {
    type: "integer_count",
    description: "Patient enrollment count",
  },
  safety_signal: { type: "free_text", description: "Clinical safety signals" },
  endpoint_metrics: {
    type: "free_text",
    description: "Trial endpoint metrics",
  },
  ae_rate: { type: "free_text", description: "Adverse event rate" },
  cdd_level: { type: "free_text", description: "Customer due diligence level" },
  ownership_chain: { type: "free_text", description: "UBO / ownership chain" },
  sanctions_status: {
    type: "free_text",
    description: "Sanctions screening status",
  },
  risk_rating: { type: "free_text", description: "AML risk rating" },
  edd_trigger: {
    type: "free_text",
    description: "Enhanced due diligence trigger",
  },
  pep_exposure: { type: "free_text", description: "PEP exposure" },
  transaction_profile: {
    type: "free_text",
    description: "Transaction velocity profile",
  },
  sar_decision: { type: "free_text", description: "SAR filing decision" },
  geographic_risk: {
    type: "free_text",
    description: "Geographic risk jurisdiction",
  },
  media_hit: { type: "free_text", description: "Adverse media hit" },
  nerc_cip_ref: {
    type: "free_text",
    description: "NERC CIP compliance reference",
  },
  patch_status: { type: "free_text", description: "Critical patch status" },
  frequency_stability: {
    type: "free_text",
    description: "Grid frequency stability",
  },
  settlement_exposure: {
    type: "free_text",
    description: "Settlement exposure",
  },
  evidence_retention: {
    type: "free_text",
    description: "Evidence retention policy",
  },
  scope: { type: "free_text", description: "Assessment scope" },
  metric: { type: "free_text", description: "Generic metric" },
  status: { type: "free_text", description: "Generic status" },
  finding: { type: "free_text", description: "Audit finding" },
};

const DEFAULT_SCHEMA: DimensionSchemaMap = NLI_GOLD_DIMENSION_SCHEMA;

function parseSchemaFile(path: string): DimensionSchemaMap {
  const raw = readFileSync(path, "utf8");
  const parsed = path.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `DIMENSION_SCHEMA_PATH must be a dimension→schema object: ${path}`,
    );
  }
  return parsed as DimensionSchemaMap;
}

/** Load dimension schema map (env override merged over defaults). */
export function loadDimensionSchemaMap(): DimensionSchemaMap {
  const path = process.env.DIMENSION_SCHEMA_PATH?.trim();
  if (!path || !existsSync(path)) return DEFAULT_SCHEMA;
  try {
    return { ...DEFAULT_SCHEMA, ...parseSchemaFile(path) };
  } catch (e) {
    throw new Error(
      `Failed to load DIMENSION_SCHEMA_PATH=${path}: ${String(e)}`,
    );
  }
}

export interface StudioDimensionRow {
  id: string;
  type: string;
  description?: string;
  tolerance?: number;
  embeddingThreshold?: number;
  plausibility?: DimensionSchemaMap[string]["plausibility"];
  warnings: string[];
}

/** Payload for Studio Configure → Dimensions (read-only until schema editor lands). */
export function describeDimensionSchemaForStudio(): {
  source: "default" | "override";
  path: string | null;
  dimensions: StudioDimensionRow[];
  warnings: string[];
} {
  const path = process.env.DIMENSION_SCHEMA_PATH?.trim() || null;
  const loaded = loadDimensionSchemaMap();
  const warnings: string[] = [];
  if (!path) {
    warnings.push(
      "Using built-in dimension schema. Set DIMENSION_SCHEMA_PATH (JSON/YAML) to override thresholds and plausibility per deployment.",
    );
  }

  const dimensions: StudioDimensionRow[] = Object.entries(loaded)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, def]) => {
      const rowWarnings: string[] = [];
      if (def.type === "currency_range" && !def.plausibility) {
        rowWarnings.push(
          "No plausibility block — retention/valuation confusion gates are disabled for this dimension.",
        );
      }
      return {
        id,
        type: def.type,
        description: def.description,
        tolerance: def.tolerance,
        embeddingThreshold: def.embeddingThreshold,
        plausibility: def.plausibility,
        warnings: rowWarnings,
      };
    });

  const missingPlausibility = dimensions.filter(
    (d) => d.type === "currency_range" && !d.plausibility,
  );
  if (missingPlausibility.length > 0) {
    warnings.push(
      `${missingPlausibility.length} currency_range dimension(s) without plausibility config: ${missingPlausibility.map((d) => d.id).join(", ")}`,
    );
  }

  return {
    source: path ? "override" : "default",
    path,
    dimensions,
    warnings,
  };
}
