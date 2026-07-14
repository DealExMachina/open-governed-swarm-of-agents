-- Add gate state and experiment metrics to convergence_history (Exp 1, Exp 3).
-- Enables per-cycle recording of gate satisfaction, finality state, and trajectory quality.

ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS gate_a_monotonic BOOLEAN;
ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS gate_b_evidence BOOLEAN;
ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS gate_c_trajectory_ok BOOLEAN;
ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS gate_d_quiescent BOOLEAN;
ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS gate_e_has_content BOOLEAN;
ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS finality_state TEXT;
ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS unresolved_contradictions INT;
ALTER TABLE convergence_history ADD COLUMN IF NOT EXISTS trajectory_quality FLOAT;
