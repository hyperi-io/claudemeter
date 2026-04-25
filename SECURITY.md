# Security

This document describes Claudemeter's security posture and how to report
issues.

## Reporting a vulnerability

Please email security reports to `security@hyperi.io`. Do not open public
GitHub issues for vulnerabilities. We aim to acknowledge within 72 hours
and to ship a fix or formal mitigation within two weeks for high-severity
issues.

## What's in the published bundle

The marketplace artifact `dist/extension.js` is built from `extension.js`
via `node esbuild.js --production`. The build deliberately strips a
recurring CVE-prone code path from the bundle:

- `esbuild.js` aliases `proxy-agent` to `build/proxy-agent-stub.js`.
- That stub eliminates the entire `puppeteer-core → @puppeteer/browsers
  → proxy-agent → pac-proxy-agent → get-uri → basic-ftp` transitive
  chain from production output.
- Net effect: any advisory targeting that chain (e.g. the recurring
  `basic-ftp` DoS class) is **shipped-out** even when the dev tree
  still resolves the vulnerable version.

If you're auditing the published `.vsix`, search the bundle for the
strings `basic-ftp`, `pac-proxy-agent`, or `get-uri` — they should not
appear.

## Known accepted risks

We track every Dependabot / npm-audit advisory and dismiss with a
reason rather than letting alerts pile up. Current accepted risks:

### `uuid <14.0.0` — moderate (GHSA-w5hq-g745-h8pq)

Reaches us via `@vscode/vsce → @azure/identity → @azure/msal-node →
uuid`. Status: **deferred — tolerable risk**.

- Reach: dev-only. `@vscode/vsce` is invoked by `npm run package` and
  the GitHub Actions release pipeline; it is never required at runtime
  for installed extensions.
- Vulnerable code path: `uuid.v3 / v5 / v6` with a user-controlled
  `buf` argument. `@azure/msal-node` calls `uuid.v4()` (random
  generation, no buffer argument), so the vulnerable branch is never
  reached on our call paths.
- Why we can't fix forward: `@azure/msal-node` declares
  `"uuid": "^8.3.0"` as a hard dependency, so a top-level `overrides`
  to bump uuid past 8.x would break msal-node's own usage.
- Re-evaluation trigger: we re-check whenever `@azure/msal-node`
  publishes a new minor that bumps its uuid pin, or whenever
  `@vscode/vsce` switches its auth backend off `@azure/identity`.

The 4 GitHub Dependabot alerts for this advisory (one per package in
the chain) have been dismissed with reason **`tolerable_risk`** and a
comment pointing to this section.

## Dependabot / advisory hygiene

Policy: **no advisory stays open without a decision.** When Dependabot
fires:

1. If the audit says `npm audit fix` resolves it, ship the lockfile fix
   and let GitHub auto-close the alert on next scan.
2. If the audit says `--force` (semver-major downgrade or breaking
   change), open a draft change and weigh the regression risk against
   the actual reach. Don't accept the downgrade without a written
   justification in the commit body.
3. If neither (1) nor (2) applies — the chain is genuinely stuck on
   upstream — dismiss the alert with one of the GitHub-provided
   reasons (`tolerable_risk`, `not_used`, `inaccurate`) and a comment
   that links here, so a future maintainer can find the rationale.

## Credentials handling

- Session cookies are stored under the OS config dir
  (`%APPDATA%\claudemeter` / `~/Library/Application Support/claudemeter`
  / `~/.config/claudemeter`) — never in the workspace, never in the
  repo, and never logged in plaintext.
- The HTTP fetcher reads Claude Code's existing credentials from
  `~/.claude/.credentials.json`; we don't request, copy, or persist
  the OAuth bearer token ourselves.
- Debug logs (rotated under the config dir, max 256 KB by default) do
  not include cookie values, bearer tokens, or org UUIDs. If you find
  a log that does, please report per the section above.
