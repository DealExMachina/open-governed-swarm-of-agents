use sha2::{Digest, Sha256};

use crate::error::KernelError;

use super::contribution::{Contribution, ContributionId, ContributionKind, ContributionPayload};

/// Hash input: the triple (sorted_parents, payload, kind) serialized to CBOR.
///
/// Parents are sorted lexicographically by their byte representation before hashing,
/// ensuring that the hash is independent of the order in which parents are listed.
/// This is critical for DCS policy-independence (Proposition 1 in the paper).
#[derive(serde::Serialize)]
struct HashInput<'a> {
    parents: Vec<&'a [u8; 32]>,
    payload: &'a serde_json::Value,
    kind: &'a str,
}

fn canonicalize_json(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_by(|(ka, _), (kb, _)| ka.cmp(kb));
            let normalized = entries
                .into_iter()
                .map(|(k, v)| (k.clone(), canonicalize_json(v)))
                .collect();
            serde_json::Value::Object(normalized)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(canonicalize_json).collect())
        }
        _ => value.clone(),
    }
}

/// Compute the content-addressed identifier for a contribution.
///
/// Algorithm:
/// 1. Sort parent IDs lexicographically by byte representation
/// 2. Serialize (sorted_parents, canonical_payload, kind) to CBOR using ciborium
/// 3. Compute SHA-256 of the CBOR bytes
///
/// This ensures deterministic, content-addressed identity: same logical content
/// always produces the same identifier regardless of metadata or insertion context.
pub fn compute_content_hash(
    parents: &[ContributionId],
    payload: &ContributionPayload,
    kind: &ContributionKind,
) -> Result<ContributionId, KernelError> {
    // Sort parents lexicographically for determinism
    let mut sorted_parents: Vec<&[u8; 32]> = parents.iter().map(|p| &p.0).collect();
    sorted_parents.sort();

    let canonical_payload = canonicalize_json(&payload.content);
    let input = HashInput {
        parents: sorted_parents,
        payload: &canonical_payload,
        kind: kind.as_str(),
    };

    // Serialize to CBOR (deterministic encoding per RFC 8949)
    let mut cbor_bytes = Vec::new();
    ciborium::ser::into_writer(&input, &mut cbor_bytes)
        .map_err(|e| KernelError::SerializationError(format!("CBOR serialization failed: {}", e)))?;

    // SHA-256 hash
    let mut hasher = Sha256::new();
    hasher.update(&cbor_bytes);
    let result = hasher.finalize();

    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&result);
    Ok(ContributionId(bytes))
}

/// Validate that a contribution's rid matches the hash of its content.
///
/// Returns Ok(()) if the rid is correct, or HashMismatch error if not.
pub fn validate_content_hash(contribution: &Contribution) -> Result<(), KernelError> {
    let computed = compute_content_hash(
        &contribution.parents,
        &contribution.payload,
        &contribution.kind,
    )?;
    if computed != contribution.rid {
        return Err(KernelError::HashMismatch {
            expected: computed.to_hex(),
            actual: contribution.rid.to_hex(),
        });
    }
    Ok(())
}
