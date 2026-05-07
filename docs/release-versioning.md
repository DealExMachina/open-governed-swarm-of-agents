# Release and versioning policy

HTTP client libraries in this repo are published as **`@sgrs/sgrs-client`** (npm) and **`sgrs-client`** (PyPI). Their versions stay **aligned** on the same `MAJOR.MINOR.PATCH` unless a release note explicitly documents a divergence.

## SemVer

Follow [Semantic Versioning 2.0.0](https://semver.org/): **PATCH** fixes, backward-compatible **MINOR** additions, **MAJOR** for breaking API or behavioural changes clients must accommodate.

## Branches

- **`main`** is the **stable** integration branch. Releases intended for **`latest`** on npm/PyPI are merged here; tags and changelog entries for stable releases correspond to **`main`**.
- Incremental semver bumps (**PATCH/MINOR**) land via normal commits and PRs that update `version` in `packages/sgrs-client/package.json` and `packages/sgrs-client-py/pyproject.toml` before publish workflows run.
- **MAJOR** releases are deliberate: breaking changes are documented (README / migration snippet / changelog section), coordinated across both packages, and merged to **`main`** when ready—not drive-by bumps.

## Publishers

Publishing is manual via workflows (see [.github/workflows/publish-sgrs-client.yml](../.github/workflows/publish-sgrs-client.yml) and [.github/workflows/pypi-publish.yml](../.github/workflows/pypi-publish.yml)) after versioning is committed.

## Relation to orchestration AGPL stack

Version numbers of the **client libraries are independent** of the monorepo app root `package.json`. Only `packages/sgrs-client*` carry the semver that registries expose.
