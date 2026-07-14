-- Sheaf Dirichlet energy columns for the dual-condition finality gate.
--
-- f(x) = xᵀL_F x is the true propagation-layer Lyapunov function (the reachable
-- disagreement on shared sheaf edges). It is the correct convergence quantity for
-- the ∧-gate: RESOLVED requires [f(x) < ε_prop] (propagation layer) AND F*(t)
-- (semantic vector finality). These columns are nullable so that pre-existing rows
-- and addons that predate Dirichlet fall back to the Ω proxy (disagreement_after).
ALTER TABLE propagation_history
    ADD COLUMN IF NOT EXISTS dirichlet_before FLOAT,
    ADD COLUMN IF NOT EXISTS dirichlet_after  FLOAT;
