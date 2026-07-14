# Project Governance

## Overview

This document describes how the Open Governed Swarm of Agents project is governed, including decision-making processes, roles, and responsibilities.

## Project Lead

**Jean-Baptiste Loeuille** (jeanbapt@dealexmachina.com)

The project lead is responsible for:
- Overall project direction and vision
- Release decisions and versioning
- Resolving disputes and escalations
- Maintaining the project roadmap
- Managing maintainer team

## Maintainers

Maintainers have write access to the repository and are responsible for:
- Reviewing and merging pull requests
- Ensuring code quality and testing standards
- Triaging and responding to issues
- Updating documentation
- Guiding contributors

Current maintainers:
- Jean-Baptiste Loeuille (Project Lead)

## Decision Making

### Code Decisions

**Standard PRs (features, fixes, refactoring):**
- Require at least one review approval
- Must pass all CI/CD checks (tests, lint, type checking, security audit)
- Require clear commit messages following conventional commits
- Can be merged by any maintainer after review

**Breaking Changes:**
- Require explicit discussion in GitHub issues first
- Require project lead approval
- Must be documented in CHANGELOG
- Increment major version number

**Architecture Decisions:**
- Documented in `/docs/ARCHITECTURE.md`
- Discussed in issues with `decision` label
- Require consensus from maintainers
- Record rationale and alternatives considered

### Release Decisions

- Releases coordinated by project lead
- Follow semantic versioning (MAJOR.MINOR.PATCH)
- Changelog updated with each release
- GitHub release created with summary

### Policy & Validation Changes

- Documented in `/docs/validation.md`
- Require explicit testing methodology
- Formal proofs (Lean 4, TLA+) updated if applicable
- Changes to governance.yaml require review of impact analysis

## Release Process

### Versioning

- **MAJOR**: Breaking changes (API incompatibilities, major refactors)
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes and small improvements

### Release Steps

1. Update version in `package.json` and `Cargo.toml`
2. Update `CHANGELOG.md` with summary of changes
3. Create Git tag: `v<version>`
4. Create GitHub Release with changelog
5. Announce in project discussions

### Support

- Latest version receives bug fixes
- Previous minor version may receive critical security fixes
- Older versions unsupported

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.

### Contribution Path

1. Fork repository (optional, can branch directly if you have access)
2. Create feature branch (`feat/description`)
3. Implement changes with tests
4. Submit PR with clear description
5. Respond to review feedback
6. PR merged by maintainer

### Pull Request Review Criteria

- Code quality: Follows style guide, no issues from linters
- Testing: New features have tests, existing tests pass
- Documentation: Updated if needed
- Security: No new vulnerabilities introduced
- Performance: No unnecessary regressions

## Community Support

### Getting Help

- **Usage questions**: Open a GitHub Discussion
- **Bug reports**: Open a GitHub Issue with reproduction steps
- **Feature requests**: Open a GitHub Issue tagged `enhancement`
- **Security issues**: Email jeanbapt@dealexmachina.com (private disclosure)

### Issue Triage

Issues are labeled and prioritized:
- `bug`: Defects needing fixes
- `enhancement`: Feature requests
- `documentation`: Docs improvements
- `help wanted`: Good issues for new contributors
- `decision`: Requires maintainer decision
- `p0`/`p1`/`p2`: Priority levels

## Licensing

The project uses dual licensing:
- **AGPL-3.0-only**: Main TypeScript codebase (`src/`)
- **Elastic License 2.0**: Rust kernel (`sgrs-core/`)

All contributions are licensed under the corresponding license for their directory.

## Changes to This Document

Changes to governance policy require:
- Discussion in GitHub Issues
- Project lead approval
- Update to this file
- Announcement to community

## Conflict Resolution

If contributors disagree on approach:
1. Document positions in issue
2. Maintainers review perspectives
3. Project lead makes final decision
4. Decision recorded and communicated

For interpersonal conflicts, see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
