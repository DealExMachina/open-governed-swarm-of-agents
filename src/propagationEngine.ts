/**
 * Sheaf-based evidence propagation engine.
 * Runs one step Π_A[(I − αL_F)x_t + ε_t], spectral analysis, disagreement, and ISS analysis.
 *
 * Supports configurable topology: complete (default), star, ring, chain, random_regular.
 * When topology is unset or "complete", the engine uses the original complete-graph
 * bridge for full backward compatibility.
 */
import type {
  PropagationConfig,
  PropagationRoleConfig,
  SheafEdgeConfig,
  TopologyConfig,
} from "./config/propagation.js";
import { loadPropagationConfig } from "./config/propagation.js";
import {
  analyzeSpectrum,
  analyzeSpectrumTopology,
  analyzeSpectrumSheaf,
  propagationStep,
  propagationStepTopology,
  propagationStepSheaf,
  computeDisagreement,
  perDimensionDisagreement,
  analyzeISS,
  extractContradictions as rawExtractContradictions,
  type SpectralAnalysis,
  type PropagationStepResult,
  type ISSAnalysis,
  type DetectedContradiction,
} from "./sgrsAdapter.js";

export type { SpectralAnalysis, PropagationStepResult, ISSAnalysis, DetectedContradiction };

/** Evidence state as flat vector: length = num_roles * 2 * num_dims (support then refutation per role). */
export type EvidenceStateFlat = number[];

export interface PropagationEngineConfig {
  config: PropagationConfig;
  /** Override num_roles (default from config.propagation.roles.length). */
  num_roles?: number;
  /** Override num_dims (default from config.propagation.dimensions.length). */
  num_dims?: number;
}

export class PropagationEngine {
  private readonly numRoles: number;
  private readonly numDims: number;
  private readonly stalkDim: number;
  private readonly supportRange: [number, number];
  private readonly refutationRange: [number, number];
  private readonly maxAlphaRatio: number;
  private readonly topology: TopologyConfig | undefined;
  private readonly sheafMode: "constant" | "projection";
  private readonly roles: PropagationRoleConfig[];
  private readonly dimensions: string[];
  private readonly sheafEdges: SheafEdgeConfig[];
  private cachedSpectrum: SpectralAnalysis | null = null;
  private cachedObservedDims: number[][] | null = null;
  private cachedEdges: number[] | null = null;

  constructor(options: PropagationEngineConfig) {
    const config = options.config;
    const prop = config.propagation;
    this.numRoles = options.num_roles ?? (prop.roles.length || 7);
    this.numDims = options.num_dims ?? (prop.dimensions.length || 4);
    this.stalkDim = (prop.roles[0] as PropagationRoleConfig | undefined)?.stalk_dim ?? 2 * this.numDims;
    this.supportRange = prop.admissible_set.support_range;
    this.refutationRange = prop.admissible_set.refutation_range;
    this.maxAlphaRatio = prop.diffusion.max_alpha_ratio;
    this.topology = prop.topology;
    this.sheafMode = prop.diffusion.sheaf_mode ?? "constant";
    this.roles = prop.roles;
    this.dimensions = prop.dimensions;
    this.sheafEdges = prop.sheaf?.edges ?? [];
  }

  /** Whether this engine uses a non-complete topology. */
  private get usesTopologyBridge(): boolean {
    return this.topology != null && this.topology.preset !== "complete";
  }

  /** Whether this engine uses projection restriction maps (non-identity sheaf). */
  private get usesProjectionSheaf(): boolean {
    return this.sheafMode === "projection";
  }

  /**
   * Derive per-role observation masks from primary_dims config.
   * Maps dimension names to indices in the dimensions array.
   */
  private buildObservedDims(): number[][] {
    if (this.cachedObservedDims) return this.cachedObservedDims;

    const allDimIndices = this.dimensions.map((_, i) => i);

    this.cachedObservedDims = this.roles.map((role) => {
      if (role.primary_dims === "all") return allDimIndices;
      return role.primary_dims
        .map((name) => this.dimensions.indexOf(name))
        .filter((idx) => idx >= 0);
    });

    return this.cachedObservedDims;
  }

  /**
   * Build flat edge list from sheaf.edges config (for projection sheaf bridge).
   * Returns [u0, v0, u1, v1, ...] with role indices.
   */
  private buildEdgeList(): number[] {
    if (this.cachedEdges) return this.cachedEdges;

    const roleIndex = new Map(this.roles.map((r, i) => [r.name, i]));

    const edges: number[] = [];
    for (const e of this.sheafEdges) {
      const src = roleIndex.get(e.from);
      const tgt = roleIndex.get(e.to);
      if (src !== undefined && tgt !== undefined) {
        edges.push(src, tgt);
      }
    }

    // If no explicit edges configured, use complete graph
    if (edges.length === 0) {
      for (let i = 0; i < this.numRoles; i++) {
        for (let j = i + 1; j < this.numRoles; j++) {
          edges.push(i, j);
        }
      }
    } else {
      // Validate connectivity: warn about disconnected roles
      const connected = new Set<number>();
      for (let k = 0; k < edges.length; k += 2) {
        connected.add(edges[k]);
        connected.add(edges[k + 1]);
      }
      for (let i = 0; i < this.numRoles; i++) {
        if (!connected.has(i)) {
          const roleName = this.roles[i]?.name ?? `role-${i}`;
          console.warn(
            `[PropagationEngine] Role "${roleName}" (idx=${i}) has no edges ` +
            `in sheaf.edges — it will be disconnected in the sheaf Laplacian.`,
          );
        }
      }
    }

    this.cachedEdges = edges;
    return this.cachedEdges;
  }

  /**
   * Run one propagation step: Π_A[(I − αL_F)x_t + ε_t].
   *
   * Routing:
   * - sheaf_mode "projection": projection restriction maps via sheaf bridge
   * - non-complete topology: topology-aware bridge with identity maps
   * - otherwise: complete-graph bridge (full backward compatibility)
   */
  step(
    currentState: EvidenceStateFlat,
    perturbation: EvidenceStateFlat,
    alpha?: number,
  ): PropagationStepResult {
    const a = alpha ?? this.getAlpha();

    if (this.usesProjectionSheaf) {
      return propagationStepSheaf(
        currentState,
        perturbation,
        this.numRoles,
        this.numDims,
        a,
        {
          roleObservedDims: this.buildObservedDims(),
          edges: this.buildEdgeList(),
        },
      );
    }

    if (this.usesTopologyBridge) {
      return propagationStepTopology(
        currentState,
        perturbation,
        this.numRoles,
        this.numDims,
        a,
        {
          topology: this.topology!.preset,
          degree: this.topology!.degree,
          seed: this.topology!.seed,
        },
      );
    }

    return propagationStep(
      currentState,
      perturbation,
      this.numRoles,
      this.numDims,
      a,
      this.supportRange[0],
      this.supportRange[1],
      this.refutationRange[0],
      this.refutationRange[1],
    );
  }

  /** Get diffusion rate α. If config says "auto", use optimal_alpha from spectral analysis. */
  getAlpha(): number {
    const spec = this.analyzeTopology();
    const alpha = spec.optimal_alpha * this.maxAlphaRatio;
    return alpha;
  }

  /** Spectral analysis of the current sheaf (projection or constant). */
  analyzeTopology(): SpectralAnalysis {
    if (this.cachedSpectrum) return this.cachedSpectrum;

    if (this.usesProjectionSheaf) {
      this.cachedSpectrum = analyzeSpectrumSheaf(
        this.numRoles,
        this.numDims,
        this.buildObservedDims(),
        this.buildEdgeList(),
      );
    } else if (this.usesTopologyBridge) {
      this.cachedSpectrum = analyzeSpectrumTopology(
        this.topology!.preset,
        this.numRoles,
        this.stalkDim,
        this.topology!.degree,
        this.topology!.seed,
      );
    } else {
      this.cachedSpectrum = analyzeSpectrum(this.numRoles, this.stalkDim);
    }

    return this.cachedSpectrum;
  }

  /** Current total disagreement Ω(x) = Σᵢ ‖xᵢ - x̄‖². */
  getDisagreement(state: EvidenceStateFlat): number {
    return computeDisagreement(state, this.numRoles, this.numDims);
  }

  /** Per-dimension disagreement: Ω_d for each base dimension d. */
  getPerDimensionDisagreement(state: EvidenceStateFlat): number[] {
    return perDimensionDisagreement(state, this.numRoles, this.numDims);
  }

  /**
   * Shared-dimension disagreement for projection sheaf mode.
   * Sums Ω_d only over dimensions observed by ≥ 2 roles. In constant mode,
   * all dimensions are shared (returns total disagreement).
   */
  getSharedDisagreement(state: EvidenceStateFlat): number {
    const perDim = this.getPerDimensionDisagreement(state);
    if (!this.usesProjectionSheaf) {
      return perDim.reduce((a, b) => a + b, 0);
    }
    const observedDims = this.buildObservedDims();
    const dimObserverCount = new Array(this.numDims).fill(0);
    for (const roleObs of observedDims) {
      for (const d of roleObs) {
        dimObserverCount[d]++;
      }
    }
    let shared = 0;
    for (let d = 0; d < this.numDims; d++) {
      if (dimObserverCount[d] >= 2) {
        shared += perDim[d];
      }
    }
    return shared;
  }

  /**
   * Mode-aware disagreement: returns shared disagreement in projection mode,
   * total disagreement in constant mode. Use this for ISS cascade / finality
   * evaluation so that non-shared dimensions don't inflate Ω.
   */
  getModeAwareDisagreement(state: EvidenceStateFlat): number {
    if (this.usesProjectionSheaf) {
      return this.getSharedDisagreement(state);
    }
    return this.getDisagreement(state);
  }

  /**
   * ISS cascade analysis from empirical noise and contradiction history.
   * noiseHistory: perturbation norms ‖ε_t‖ per step.
   * contradictionHistory: contradiction counts or rates per step.
   */
  analyzeISS(
    noiseHistory: number[],
    contradictionHistory: number[],
    initialDisagreement: number,
  ): ISSAnalysis {
    const spec = this.analyzeTopology();
    const noiseBound = noiseHistory.length > 0 ? Math.max(...noiseHistory) : 0;
    const contradictionRate =
      contradictionHistory.length > 0
        ? contradictionHistory.reduce((a, b) => a + b, 0) / contradictionHistory.length
        : 0;
    return analyzeISS(
      spec.spectral_gap,
      this.getAlpha(),
      noiseBound,
      contradictionRate,
      initialDisagreement,
    );
  }

  /** Extract contradictions from an evidence state (pairs exceeding threshold). */
  extractContradictions(state: EvidenceStateFlat, threshold: number): DetectedContradiction[] {
    return rawExtractContradictions(state, this.numRoles, this.numDims, threshold);
  }

  /** Create engine with config loaded from propagation.yaml. */
  static create(): PropagationEngine {
    const config = loadPropagationConfig();
    return new PropagationEngine({ config });
  }
}
