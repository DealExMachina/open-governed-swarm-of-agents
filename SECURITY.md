# Security

## Dependency vulnerabilities

- **Audit:** Run `pnpm audit` to list known vulnerabilities. CI runs `pnpm audit --audit-level=high` so high/critical issues fail the build.
- **Remediation:** Transitive vulnerabilities are addressed via `pnpm.overrides` in `package.json` where possible (e.g. hono, fast-xml-parser for AWS SDK XML, flatted for ESLint’s flat-cache). Direct dependency bumps and overrides are preferred over ignoring advisories.

## esbuild (dev/test)

esbuild is pulled transitively by Vitest → Vite. We pin **esbuild ≥0.25.0** via `pnpm.overrides` so [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) is addressed. Production runtime does not use Vite or esbuild.

## Reporting vulnerabilities

Please report security issues privately (e.g. via maintainer contact or a private security advisory) rather than in public issue trackers.
