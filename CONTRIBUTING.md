# Contributing to Claudemeter

Thanks for helping out. Please read the "Node version" and "Commits and
releases" sections before opening a PR - they carry the two rules that trip
people up most.

## Development setup

Prerequisites: the Node.js version pinned in `.nvmrc` (see "Node version"
below), and a VS Code new enough to satisfy `engines.vscode`.

```
npm install          # dev deps only - the extension ships zero runtime deps
npm run build        # bundle src/ + extension.js -> dist/extension.js (esbuild)
npm run watch        # rebuild on change, pair with F5 (Run Extension) in VS Code
npm test             # vitest
npm run lint         # eslint
npm run package      # build a .vsix locally
```

`dist/extension.js` is the actual shipped bundle. Editing `src/*.js` or
`extension.js` has no effect until you rebuild `dist/`. The logo and the
tooltip/marketplace images are generated - edit the sources in
[assets/src/](assets/src/) and re-run their generators, never hand-edit the
output PNGs/SVGs.

## Node version - keep CI in step with the VS Code extension host

VS Code runs extensions inside Electron's bundled Node. **CI must build and
test on the same Node major that the *oldest* VS Code we support runs** - the
`engines.vscode` floor - not the newest Node available. Otherwise a
newer-Node-only feature can pass CI yet break users on the minimum VS Code.

`engines.vscode` is the single source of truth. The same Node major is
mirrored into the workflows' `node-version`, `engines.node`, `.nvmrc`, and the
Renovate Node cap. Run the guard to print the current target and confirm they
all agree:

```
uv run assets/src/deps_node_guard.py
```

**Do not bump Node** - not in the workflows, `engines.node`, or `.nvmrc`, and
do not merge a Renovate PR that raises `node-version` - until `engines.vscode`
is raised to a floor whose extension host runs the newer Node. The Renovate
Node cap is a backstop, not the guarantee.

To lift the Node line (when dropping support for the older VS Code range):
raise `engines.vscode`, run the guard to read the new target, then update the
workflow `node-version`, `engines.node`, `.nvmrc` and the Renovate cap
together, and add the new VS Code -> Node row to the guard's `VSCODE_NODE`
table.

## Commits and releases

- **Conventional Commits.** `fix:` for changes to the shipped code (triggers a
  patch release), `feat:` for user-facing features (minor). **CI-only changes
  - GitHub Actions, workflows, dependency pins that don't reach the bundle -
  are `chore:` and MUST NOT bump the version.** Keep subjects <= 50 chars.
- **Semantic-release owns the version.** Never hand-edit the `version` in
  `package.json`, never edit `CHANGELOG.md`, never create tags. Pushing to
  `main` triggers `.github/workflows/release.yml`, which computes the version
  from the commits, tags, and publishes to the VS Code Marketplace.
- Because a push to `main` publishes, land your work via a PR and let a
  maintainer merge.

## Dependencies

- **Renovate** manages updates as PRs (`renovate.json` extends
  `github>hyperi-io/renovate-config`). Nothing auto-merges - a human reviews
  every update.
- External deps observe a **7-day release-age cooldown**. Security fixes may
  bypass it. GitHub Actions are **pinned to a commit SHA** (`@<sha> # vN`) -
  keep them that way.
- The extension has **zero runtime dependencies**. Everything in
  `package.json` is dev-only (esbuild, vsce, eslint, vitest). Keep it that way.

## For agentic coders

Common ways an AI gets this repo wrong:

| Don't | Do | Why |
|---|---|---|
| Bump Node (or merge a Renovate Node PR) | Keep Node at the guard's target, run `deps_node_guard.py` | CI must match the extension-host Node for the `engines.vscode` floor |
| Edit `package.json` `version` or `CHANGELOG.md` | Land `fix:`/`feat:` commits, let semantic-release version | Semantic-release owns versioning |
| `chore:`-tag a code change, or `fix:`-tag a CI-only change | Match the type to what's affected | Wrong type = wrong (or missing) release |
| Edit `dist/` or the generated `assets/*.png` | Edit `src/`/`assets/src/` and rebuild/regenerate | `dist` and image outputs are build artefacts |
| Push to `main` to "just ship it" | Open a PR | A push to `main` publishes to the Marketplace |

Verify before claiming done: `npm test`, `npm run lint`, `npm run build`, and
for dependency work `uv run assets/src/deps_node_guard.py`.
