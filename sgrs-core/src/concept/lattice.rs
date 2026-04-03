use std::collections::HashSet;

fn closure_intent(seed: u32, rows: &[u32], attrs: usize) -> u32 {
    let all_attrs = if attrs >= 32 {
        u32::MAX
    } else {
        (1u32 << attrs) - 1
    };

    let mut extent_mask: u32 = 0;
    for (i, row) in rows.iter().enumerate() {
        if (row & seed) == seed {
            extent_mask |= 1u32 << i;
        }
    }

    let mut intent = all_attrs;
    for (i, row) in rows.iter().enumerate() {
        let in_extent = ((extent_mask >> i) & 1) == 1;
        if in_extent {
            intent &= *row;
        }
    }
    intent
}

pub fn concept_lattice_size(rows: &[u32], attrs: usize, max_concepts: usize) -> (usize, bool) {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut current = closure_intent(0, rows, attrs);
    let mut count = 0usize;

    loop {
        if !seen.insert(current) {
            break;
        }
        count += 1;
        if count > max_concepts {
            return (count, true);
        }

        let mut advanced = false;
        for i in (0..attrs).rev() {
            if ((current >> i) & 1) == 1 {
                continue;
            }

            let prefix_mask = if i == 0 { 0 } else { (1u32 << i) - 1 };
            let candidate_seed = (current & prefix_mask) | (1u32 << i);
            let candidate = closure_intent(candidate_seed, rows, attrs);

            let mut lectic_ok = true;
            for j in 0..i {
                let cj = ((candidate >> j) & 1) == 1;
                let bj = ((current >> j) & 1) == 1;
                if cj && !bj {
                    lectic_ok = false;
                    break;
                }
            }

            if lectic_ok {
                current = candidate;
                advanced = true;
                break;
            }
        }

        if !advanced {
            break;
        }
    }

    (count, false)
}

pub fn concept_provenance(rows: &[u32], attrs: usize, max_concepts: usize) -> Vec<(u32, usize)> {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut current = closure_intent(0, rows, attrs);
    let mut out = Vec::new();

    loop {
        if !seen.insert(current) {
            break;
        }
        if out.len() >= max_concepts {
            break;
        }

        let extent_size = rows.iter().filter(|row| (**row & current) == current).count();
        out.push((current, extent_size));

        let mut advanced = false;
        for i in (0..attrs).rev() {
            if ((current >> i) & 1) == 1 {
                continue;
            }

            let prefix_mask = if i == 0 { 0 } else { (1u32 << i) - 1 };
            let candidate_seed = (current & prefix_mask) | (1u32 << i);
            let candidate = closure_intent(candidate_seed, rows, attrs);

            let mut lectic_ok = true;
            for j in 0..i {
                let cj = ((candidate >> j) & 1) == 1;
                let bj = ((current >> j) & 1) == 1;
                if cj && !bj {
                    lectic_ok = false;
                    break;
                }
            }

            if lectic_ok {
                current = candidate;
                advanced = true;
                break;
            }
        }

        if !advanced {
            break;
        }
    }

    out
}
