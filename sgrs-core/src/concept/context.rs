#[derive(Debug, Clone, Copy)]
pub enum GovernanceAttr {
    Master,
    Mitl,
    Yolo,
}

#[derive(Debug, Clone)]
pub struct ThresholdConfig {
    pub plus: [f64; 4],
    pub minus: [f64; 4],
    pub epsilon: [f64; 4],
}

impl Default for ThresholdConfig {
    fn default() -> Self {
        Self {
            plus: [0.85, 0.95, 0.9, 0.8],
            minus: [0.15, 0.1, 0.15, 0.2],
            epsilon: [0.02, 0.01, 0.02, 0.03],
        }
    }
}

fn row_mask(
    support: &[f64],
    refutation: &[f64],
    governance: GovernanceAttr,
    cfg: &ThresholdConfig,
) -> u32 {
    let mut bits: u32 = 0;
    for d in 0..4 {
        let s = *support.get(d).unwrap_or(&0.0);
        let r = *refutation.get(d).unwrap_or(&0.0);
        let hs = s > cfg.plus[d];
        let ls = s <= cfg.minus[d];
        let hr = r > cfg.plus[d];
        let lr = r <= cfg.minus[d];
        let cd = hs && hr;
        let ig = ls && lr;
        let cv = (s - r).abs() < cfg.epsilon[d];

        let base = d * 7;
        if hs {
            bits |= 1 << (base + 0);
        }
        if ls {
            bits |= 1 << (base + 1);
        }
        if hr {
            bits |= 1 << (base + 2);
        }
        if lr {
            bits |= 1 << (base + 3);
        }
        if cd {
            bits |= 1 << (base + 4);
        }
        if ig {
            bits |= 1 << (base + 5);
        }
        if cv {
            bits |= 1 << (base + 6);
        }
    }

    let g_base = 28;
    match governance {
        GovernanceAttr::Master => bits |= 1 << g_base,
        GovernanceAttr::Mitl => bits |= 1 << (g_base + 1),
        GovernanceAttr::Yolo => bits |= 1 << (g_base + 2),
    }
    bits
}

/// Build full 31-attribute rows from flattened bilattice state.
pub fn build_context_rows(
    flat_support: &[f64],
    flat_refutation: &[f64],
    governance: &[GovernanceAttr],
    num_roles: usize,
    num_dims: usize,
    cfg: &ThresholdConfig,
) -> Vec<u32> {
    let mut rows = Vec::with_capacity(num_roles);
    for i in 0..num_roles {
        let start = i * num_dims;
        let end = start + num_dims;
        let s = &flat_support[start..end.min(flat_support.len())];
        let r = &flat_refutation[start..end.min(flat_refutation.len())];
        let g = governance.get(i).copied().unwrap_or(GovernanceAttr::Yolo);
        rows.push(row_mask(s, r, g, cfg));
    }
    rows
}
