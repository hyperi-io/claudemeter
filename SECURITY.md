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
via `node esbuild.js --production`.

Claudemeter has **zero runtime dependencies** (`package.json`
`dependencies` is empty). It ships no browser, no Chromium, and no
scraping stack - usage is fetched with the platform `fetch` from the
first-party `api.anthropic.com` OAuth endpoints. The only third-party
packages are dev-only (`esbuild`, `@vscode/vsce`, `eslint`, `vitest`),
which never reach an installed extension.

(For historical context: earlier versions drove a browser to harvest a
`claude.ai` session cookie - first `puppeteer-core` (whose
`@puppeteer/browsers → proxy-agent → pac-proxy-agent → get-uri →
basic-ftp` chain was a recurring advisory source, stripped via a
build-time stub), then `playwright-core`. Both are gone: the switch to
Claude Code's OAuth token removed the browser entirely, and with it the
whole runtime-dependency surface.)

## Known accepted risks

We track every Dependabot / npm-audit advisory and dismiss with a
reason rather than letting alerts pile up. Current accepted risks:

### `uuid <14.0.0` - moderate (GHSA-w5hq-g745-h8pq)

Reaches us via `@vscode/vsce → @azure/identity → @azure/msal-node →
uuid`. Status: **deferred - tolerable risk**.

- Reach: dev-only. `@vscode/vsce` is invoked by `npm run package` and
  the GitHub Actions release pipeline. It never reaches an installed
  extension at runtime.
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
3. If neither (1) nor (2) applies - the chain is genuinely stuck on
   upstream - dismiss the alert with one of the GitHub-provided
   reasons (`tolerable_risk`, `not_used`, `inaccurate`) and a comment
   that links here, so a future maintainer can find the rationale.

## Credentials handling

- Claudemeter reads Claude Code's existing OAuth token from the shared
  store it writes - the macOS Keychain (`Claude Code-credentials`) or
  `~/.claude/.credentials.json` on Linux/Windows (honouring
  `CLAUDE_CONFIG_DIR`). It reads the token fresh per fetch and never
  copies, persists, or writes it back - so it cannot disturb Claude
  Code's own login.
- The token is used only as the `Authorization: Bearer` header to
  `https://api.anthropic.com`. Requests set `redirect: 'error'` so a
  Bearer-bearing request is never followed to another host.
- Claudemeter never refreshes the token. Claude Code owns the token
  lifecycle, and Anthropic rotates refresh tokens. Claudemeter only
  tracks the current value, so it cannot invalidate Claude Code's
  session.
- Debug logs (rotated under the config dir, max 256 KB by default) and
  the **Dump State** report never include the token - only its
  presence, source, scopes, and expiry. If you find a log that leaks a
  token, please report per the section above.

## Logging and bug reports - designed to be shareable

The debug log and the **Dump State** report are built to be pasted into a
public GitHub issue. Redaction is automatic. By design they carry:

- **No token or credentials** - only token presence, source, scopes,
  expiry.
- **No account name and no email** - the state dump reports account
  *presence* plus org type (e.g. `Personal`), nothing identifying.
  (`src/oauthFetcher.js`'s CLI smoke-test also redacts name/email.)
- **No username in paths** - every logged line goes through `scrubHome()`
  (`src/utils.js`), which swaps the home directory for `~`, so absolute
  paths never carry the OS username.

What does appear, deliberately: plan/tier strings, usage percentages,
token counts, timestamps, and your own **project folder names**. The
gauge is project-scoped, so a folder name is often what pins down a
"wrong project" report.

The redaction is automatic, so the output should be safe to post as-is.
We do not warrant every environment though - **read it before you attach
it, and cut anything you would rather not share.** On our side it is a
maintained invariant. A change that adds identifying data to a log or the
state dump is a defect - report it.
