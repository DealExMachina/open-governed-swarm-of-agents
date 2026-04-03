/**
 * Load propagation config from propagation.yaml (Stage 2 Phase 2).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parse as parseYaml } from "yaml";

const PROPAGATION_PATH = process.env.PROPAGATION_PATH ?? join(process.cwd(), "propagation.yaml");

export interface PropagationRoleConfig {
  name: string;
  stalk_dim: number;
  primary_dims: string[] | "all";
}

export interface SheafEdgeConfig {
  from: string;
  to: string;
  edge_dim: number;
}

export type TopologyPreset = "complete" | "star" | "ring" | "chain" | "random_regular";

export interface TopologyConfig {
  /** Topology preset name. Default: "complete" (backward-compatible). */
  preset: TopologyPreset;
  /** Degree for "random_regular". Ignored for other presets. */
  degree?: number;
  /** RNG seed for "random_regular". Ignored for other presets. */
  seed?: number;
}

export interface PropagationConfig {
  propagation: {
    framework: string;
    roles: PropagationRoleConfig[];
    dimensions: string[];
    evidence_channels: string[];
    sheaf: {
      edges: SheafEdgeConfig[];
    };
    diffusion: {
      alpha: number | "auto";
      max_alpha_ratio: number;
      /** "constant" = identity restriction maps (backward-compat), "projection" = observation-based maps */
      sheaf_mode?: "constant" | "projection";
    };
    admissible_set: {
      type: string;
      support_range: [number, number];
      refutation_range: [number, number];
    };
    noise: {
      epsilon_max_initial: number;
      log_perturbation_norms: boolean;
    };
    iss: {
      max_contradiction_rate: number;
      alert_on_violation: boolean;
    };
    topology_constraints: {
      min_spectral_gap: number;
      max_degree: number;
    };
    /** Topology of the role graph. Default: complete (backward-compatible). */
    topology?: TopologyConfig;
  };
}

const DEFAULT_CONFIG: PropagationConfig = {
  propagation: {
    framework: "sheaf_laplacian",
    roles: [],
    dimensions: ["claim_confidence", "contradiction_resolution", "goal_completion", "risk_score_inverse"],
    evidence_channels: ["support", "refutation"],
    sheaf: { edges: [] },
    diffusion: { alpha: "auto", max_alpha_ratio: 0.95, sheaf_mode: "constant" },
    admissible_set: {
      type: "convex_box",
      support_range: [0, 1],
      refutation_range: [0, 1],
    },
    noise: { epsilon_max_initial: 0.15, log_perturbation_norms: true },
    iss: { max_contradiction_rate: 0.3, alert_on_violation: true },
    topology_constraints: { min_spectral_gap: 0.1, max_degree: 4 },
  },
};

export function loadPropagationConfig(): PropagationConfig {
  try {
    const raw = readFileSync(PROPAGATION_PATH, "utf-8");
    const parsed = parseYaml(raw) as PropagationConfig;
    if (!parsed?.propagation || typeof parsed.propagation !== "object") {
      return DEFAULT_CONFIG;
    }
    return {
      propagation: {
        ...DEFAULT_CONFIG.propagation,
        ...parsed.propagation,
        sheaf: {
          edges: parsed.propagation.sheaf?.edges ?? [],
        },
        diffusion: {
          alpha: parsed.propagation.diffusion?.alpha ?? "auto",
          max_alpha_ratio: parsed.propagation.diffusion?.max_alpha_ratio ?? 0.95,
          sheaf_mode: (parsed.propagation.diffusion as Record<string, unknown>)?.sheaf_mode as "constant" | "projection" | undefined ?? "constant",
        },
        admissible_set: {
          type: parsed.propagation.admissible_set?.type ?? "convex_box",
          support_range: parsed.propagation.admissible_set?.support_range ?? [0, 1],
          refutation_range: parsed.propagation.admissible_set?.refutation_range ?? [0, 1],
        },
        noise: {
          epsilon_max_initial: parsed.propagation.noise?.epsilon_max_initial ?? 0.15,
          log_perturbation_norms: parsed.propagation.noise?.log_perturbation_norms ?? true,
        },
        iss: {
          max_contradiction_rate: parsed.propagation.iss?.max_contradiction_rate ?? 0.3,
          alert_on_violation: parsed.propagation.iss?.alert_on_violation ?? true,
        },
        topology_constraints: {
          min_spectral_gap: parsed.propagation.topology_constraints?.min_spectral_gap ?? 0.1,
          max_degree: parsed.propagation.topology_constraints?.max_degree ?? 4,
        },
        topology: parsed.propagation.topology
          ? {
              preset: (parsed.propagation.topology as TopologyConfig).preset ?? "complete",
              degree: (parsed.propagation.topology as TopologyConfig).degree,
              seed: (parsed.propagation.topology as TopologyConfig).seed,
            }
          : undefined,
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}
