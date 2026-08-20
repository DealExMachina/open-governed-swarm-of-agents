# Security

## Dependency vulnerabilities

- **Audit:** Run `pnpm audit` to list known vulnerabilities. CI runs `pnpm audit --audit-level=high` so high/critical issues fail the build.
- **Remediation:** Transitive vulnerabilities are addressed via `overrides` in `pnpm-workspace.yaml` (pnpm 10+ ignores `package.json` → `pnpm.overrides`). Direct dependency bumps and overrides are preferred over ignoring advisories.

Key floors currently enforced (see `pnpm-workspace.yaml` for the full list):

| Package | Floor | Reason |
| --- | --- | --- |
| `js-yaml` | ≥4.3.1 | YAML parse DoS (`!!omap` / merge keys) |
| `fast-uri` | ≥3.1.5 | Host confusion via backslash authority |
| `ip-address` | ≥10.3.1 | Leading-zero octet SSRF / trust bypass |
| `fast-xml-parser` | ≥5.10.1 | DOCTYPE entity-expansion DoS (AWS SDK) |
| `hono` | ≥4.12.34 | CORS ReDoS / memo leak / lang middleware |
| `@hono/node-server` | ≥1.19.15 | Windows path traversal in serve-static |
| `@opentelemetry/propagator-jaeger` | ≥2.9.0 | DoS on malformed Jaeger header |
| `brace-expansion` (1 / 2 / 5) | 1.1.18 / 2.1.4 / 5.0.9 | Brace-expansion DoS (mostly dev) |
| `postcss` | ≥8.5.23 | Incomplete sourceMappingURL fix (dev) |
| `nanoid@3` | ≥3.3.18 | Zero-size generator hang (dev via Vite) |
| `esbuild` | ≥0.28.1 | GHSA-67mh-4wv8-2f99 (dev via Vitest → Vite) |
| `body-parser` | ≥2.3.0 | Invalid `limit` disables size enforcement |

**Accepted residual (low, unpatched upstream):** `@ai-sdk/provider-utils` (GHSA-866g-f22w-33x8) — no patched release yet (`Patched versions: <0.0.0`). Revisit when Vercel AI SDK ships a fix.

If `sgrs-core` has a separate lockfile install, it uses `sgrs-core/pnpm-workspace.yaml` for its own `js-yaml` override.

## esbuild (dev/test)

esbuild is pulled transitively by Vitest → Vite. We pin **esbuild ≥0.28.1** via workspace overrides so [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) is addressed. Production runtime does not use Vite or esbuild.

## Reporting vulnerabilities

Please report security issues privately (e.g. via maintainer contact or a private security advisory) rather than in public issue trackers.
