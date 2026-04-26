## [2.3.8](https://github.com/hyperi-io/claudemeter/compare/v2.3.7...v2.3.8) (2026-04-26)


### Bug Fixes

* **perf:** debounce JSONL watcher to coalesce per-message bursts ([c11a01e](https://github.com/hyperi-io/claudemeter/commit/c11a01e30e193f9d8d8169bd39ae0a5eef53b601)), closes [#32](https://github.com/hyperi-io/claudemeter/issues/32)

## [2.3.7](https://github.com/hyperi-io/claudemeter/compare/v2.3.6...v2.3.7) (2026-04-25)


### Bug Fixes

* **security:** wire up real submodule guard in CI gates and gitignore ([2e72bde](https://github.com/hyperi-io/claudemeter/commit/2e72bde5f42cb7cceb9267659c5679e9e9d19e72))

## [2.3.6](https://github.com/hyperi-io/claudemeter/compare/v2.3.5...v2.3.6) (2026-04-25)


### Bug Fixes

* **windows:** convert drive-letter colon to dash in Claude project dir lookup ([c4e8d53](https://github.com/hyperi-io/claudemeter/commit/c4e8d538ed601e900dfe106cba09a3373af09ef1))
* **windows:** default usageFormat to barLight where Geometric Shapes don't render ([b6655d7](https://github.com/hyperi-io/claudemeter/commit/b6655d7d9b59b087c64cf776d299806156864e58))

## [2.3.5](https://github.com/hyperi-io/claudemeter/compare/v2.3.4...v2.3.5) (2026-04-20)


### Bug Fixes

* correct peak-window end to 23:00 LA (was 11:00) ([2bbfdb6](https://github.com/hyperi-io/claudemeter/commit/2bbfdb619bbd221db46ed8436e5aea786f1eb569))
* move happy hour to dedicated status-bar panel ([afd0576](https://github.com/hyperi-io/claudemeter/commit/afd05765d8e7b2645983031d46c66a3bbe38c4ff))

## [2.3.4](https://github.com/hyperi-io/claudemeter/compare/v2.3.3...v2.3.4) (2026-04-20)


### Bug Fixes

* address semgrep SAST findings + add hyperi-ci config ([9d8a7b5](https://github.com/hyperi-io/claudemeter/commit/9d8a7b58881e8dc132f9808233069a98bf983e1e))
* detect and render Claude Code rate-limit events in status bar ([6d795f4](https://github.com/hyperi-io/claudemeter/commit/6d795f4b556167561a75feeb2ae5c645ad32b6a6))
* expand tokensDisplay enum with value/limit modes, new default 'limit' ([ac261f7](https://github.com/hyperi-io/claudemeter/commit/ac261f7857ba4263f913358e91db6055f5d23e8f))
* rate-limit badge dev-test tooling + UX cleanups ([9efb12b](https://github.com/hyperi-io/claudemeter/commit/9efb12b49f6889c2805d4124710c0880b0ca08e1))
* render happy-hour icon on Claude label panel ([6b57580](https://github.com/hyperi-io/claudemeter/commit/6b575802bd2f8d42d3538f33dd3767b4419f89a7))
* **wip:** claudeLabelComposer module — platform-state icon composition ([f743017](https://github.com/hyperi-io/claudemeter/commit/f74301794b928416f48e7797327f8cba0a76fcbe))
* **wip:** happyHour module for peak-window detection ([c7fdd63](https://github.com/hyperi-io/claudemeter/commit/c7fdd635c57a26e1133aebea781ebef735d4a859))
* **wip:** rateLimitDetector module — classify + scanTail ([e8fcfa6](https://github.com/hyperi-io/claudemeter/commit/e8fcfa6bc244a56f9bfaba0233b4bf8fb51472c4))
* **wip:** tooltipComposer pure module (extraction scaffold) ([9d17513](https://github.com/hyperi-io/claudemeter/commit/9d17513b1934774cff6468c915a57dd1c3824d43))

## [2.3.3](https://github.com/hyperi-io/claudemeter/compare/v2.3.2...v2.3.3) (2026-04-16)


### Bug Fixes

* **deps:** update puppeteer-core to v24.41.0 ([#26](https://github.com/hyperi-io/claudemeter/issues/26)) ([83576f1](https://github.com/hyperi-io/claudemeter/commit/83576f199057d5a709fe8a4d1a88b94fba8c49be))

## [2.3.2](https://github.com/hyperi-io/claudemeter/compare/v2.3.1...v2.3.2) (2026-04-16)


### Bug Fixes

* display 1M+ token counts in compact m-format ([28aef27](https://github.com/hyperi-io/claudemeter/commit/28aef27c3a78d4722f3a46862d66e2043bab1111))

## [2.3.1](https://github.com/hyperi-io/claudemeter/compare/v2.3.0...v2.3.1) (2026-04-14)


### Bug Fixes

* skip API-only orgs and make login browser stateless ([3902e04](https://github.com/hyperi-io/claudemeter/commit/3902e04be068b0c4afdf726b8bb289c9dd6c4be1))

# [2.3.0](https://github.com/hyperi-io/claudemeter/compare/v2.2.4...v2.3.0) (2026-04-12)


### Bug Fixes

* align context window detection with recent Claude Code changes ([bb60f39](https://github.com/hyperi-io/claudemeter/commit/bb60f39abbf4d0f6f1ef512a16c162905056d384))
* exclude tests, vitest config and renovate config from VSIX ([55efe1b](https://github.com/hyperi-io/claudemeter/commit/55efe1b078a51de3f5963554ecb91c6334d4c328))


### Features

* new tokensDisplay option for Tk status bar item ([507a495](https://github.com/hyperi-io/claudemeter/commit/507a49564dcb281e32c97afb324aced6e2776396))

## [2.2.4](https://github.com/hyperi-io/claudemeter/compare/v2.2.3...v2.2.4) (2026-04-11)


### Bug Fixes

* update marketplace description and docs for recent features ([59eaf9f](https://github.com/hyperi-io/claudemeter/commit/59eaf9f255d52be83edb0cca77cadaafdebe7f63))

## [2.2.3](https://github.com/hyperi-io/claudemeter/compare/v2.2.2...v2.2.3) (2026-04-11)


### Bug Fixes

* stub proxy-agent to drop basic-ftp from bundle ([d15fbeb](https://github.com/hyperi-io/claudemeter/commit/d15fbebb7c257170f6d6783de48242786d31052f))

## [2.2.2](https://github.com/hyperi-io/claudemeter/compare/v2.2.1...v2.2.2) (2026-04-11)


### Bug Fixes

* patch transitive CVEs in basic-ftp, vite, lodash via overrides ([35fac38](https://github.com/hyperi-io/claudemeter/commit/35fac38d9c5df6f20325384f960112863156bc49))

## [2.2.1](https://github.com/hyperi-io/claudemeter/compare/v2.2.0...v2.2.1) (2026-04-11)


### Bug Fixes

* robust account detection, 1M context, multi-instance session safety ([43ec08a](https://github.com/hyperi-io/claudemeter/commit/43ec08a5d269f0a4ca1222ccd826e1928cf3e43a)), closes [#18](https://github.com/hyperi-io/claudemeter/issues/18)

# [2.2.0](https://github.com/hyperi-io/claudemeter/compare/v2.1.5...v2.2.0) (2026-04-02)


### Features

* add AI/ML training restriction policy and crawler blocklist ([ca7cddc](https://github.com/hyperi-io/claudemeter/commit/ca7cddca4a332044058c66698b017e5918676236))


### Reverts

* restore MIT LICENSE, remove FSL/AI policy files (erroneously applied) ([d38e916](https://github.com/hyperi-io/claudemeter/commit/d38e916c73d969092f24e967f802bb656710ccf3))

## [2.1.5](https://github.com/hyperi-io/claudemeter/compare/v2.1.4...v2.1.5) (2026-03-30)


### Bug Fixes

* expand pop culture status messages with 200+ new quotes ([2046077](https://github.com/hyperi-io/claudemeter/commit/2046077dd45487c75144fbe5e2c6bbab53b553d2))

## [2.1.4](https://github.com/hyperi-io/claudemeter/compare/v2.1.3...v2.1.4) (2026-03-24)


### Bug Fixes

* show account email and org type (Personal/Team/Enterprise) in tooltip ([2ef57ea](https://github.com/hyperi-io/claudemeter/commit/2ef57ea68f2f6c9bbff4b50400e69f334078a7d2))

## [2.1.3](https://github.com/hyperi-io/claudemeter/compare/v2.1.2...v2.1.3) (2026-03-24)


### Bug Fixes

* update semantic-release-action to v6 for node24 support ([5573d17](https://github.com/hyperi-io/claudemeter/commit/5573d1761d4c9d32e16fe6077d19862a2fb1d365))

## [2.1.2](https://github.com/hyperi-io/claudemeter/compare/v2.1.1...v2.1.2) (2026-03-24)


### Bug Fixes

* bump engines.vscode to match @types/vscode 1.110.0 ([359f42a](https://github.com/hyperi-io/claudemeter/commit/359f42a3804f7ab7a121c70fe84c7cc52a795d8b))

## [2.1.1](https://github.com/hyperi-io/claudemeter/compare/v2.1.0...v2.1.1) (2026-03-24)


### Bug Fixes

* update dependencies and patch transitive security vulnerabilities ([4456bf9](https://github.com/hyperi-io/claudemeter/commit/4456bf94bee3365e038f127e52b82b333b8a5535))

# [2.1.0](https://github.com/hyperi-io/claudemeter/compare/v2.0.6...v2.1.0) (2026-03-17)


### Features

* auto-detect context window from Claude Code model selection ([fb5406c](https://github.com/hyperi-io/claudemeter/commit/fb5406c0162ef08eade0fcfb4f676499e5deb2a0))

## [2.0.6](https://github.com/hyperi-io/claudemeter/compare/v2.0.5...v2.0.6) (2026-03-16)


### Bug Fixes

* update all CI dependencies to latest versions ([#12](https://github.com/hyperi-io/claudemeter/issues/12)) ([02e5ea7](https://github.com/hyperi-io/claudemeter/commit/02e5ea793e7578b451abff1414d04d626c932513))

## [2.0.5](https://github.com/hyperi-io/claudemeter/compare/v2.0.4...v2.0.5) (2026-03-16)


### Bug Fixes

* add sec commit type to semantic-release config ([6db6691](https://github.com/hyperi-io/claudemeter/commit/6db669156dfc0bc5f061f5f2aab6203078044b4d))

## [2.0.4](https://github.com/hyperi-io/claudemeter/compare/v2.0.3...v2.0.4) (2026-03-16)


### Bug Fixes

* auto-detect context window from model ID ([95e58ee](https://github.com/hyperi-io/claudemeter/commit/95e58ee56933f4660ac12f859acbd3fbceee4134))

## [2.0.3](https://github.com/hyperi-io/claudemeter/compare/v2.0.2...v2.0.3) (2026-03-09)


### Bug Fixes

* add resync account command and clean VSIX build output ([6ae3127](https://github.com/hyperi-io/claudemeter/commit/6ae3127169f653dda4d9ff4ac02db18ab63c6614))

## [2.0.2](https://github.com/hyperi-io/claudemeter/compare/v2.0.1...v2.0.2) (2026-03-06)


### Bug Fixes

* use orgId-only comparison for account switch detection ([bd1ac2e](https://github.com/hyperi-io/claudemeter/commit/bd1ac2e3000d50e8e3ef697a5d198a04921e2da7))

## [2.0.1](https://github.com/hyperi-io/claudemeter/compare/v2.0.0...v2.0.1) (2026-03-06)


### Bug Fixes

* show token gauge in tokenOnlyMode without requiring login ([#11](https://github.com/hyperi-io/claudemeter/issues/11)) ([38df997](https://github.com/hyperi-io/claudemeter/commit/38df9973652c5f32370a615e8523b9d50dd40c28))

# [2.0.0](https://github.com/hyperi-io/claudemeter/compare/v1.3.10...v2.0.0) (2026-03-06)


* feat!: Claudemeter v2 — streamlined HTTP fetching, account verification, HyperI rebrand ([21dd141](https://github.com/hyperi-io/claudemeter/commit/21dd1415c35523cc45673ec72a29a61675d39506))
* feat!: v2 lightweight release — replace Puppeteer with HTTP cookie-based fetching ([6d780fc](https://github.com/hyperi-io/claudemeter/commit/6d780fcb19e6a255fea1a71365d8c251dc759c33))
* feat!: v2 streamlined release — docs and submodule migration ([67dcc3b](https://github.com/hyperi-io/claudemeter/commit/67dcc3b4f05029f71ab64f44cd9fe02c364de1b7))


### Features

* v2 streamlined release — HTTP fetching, account verification, and UX polish ([67fead3](https://github.com/hyperi-io/claudemeter/commit/67fead31b818a7505c47d7d0846c44f389945d2f))


### BREAKING CHANGES

* v2 replaces Puppeteer browser automation with streamlined
HTTP cookie-based fetching. Existing browser sessions are not migrated;
a fresh login is required on first use of v2.

## Features
- HTTP cookie-based fetching: usage data via direct API calls (1-3s, no
  browser overhead) replaces full Puppeteer browser automation (~200MB)
- Self-contained 4.5MB bundle: puppeteer-core bundled via esbuild, no
  node_modules at runtime
- Account verification: after browser login, verifies the browser account
  matches the Claude Code CLI account; rejects mismatched accounts with
  error and re-login prompt showing the expected email
- Account switch detection: credentials watcher detects CLI account changes,
  clears login browser cache, prompts re-login for the new account
- First-run login prompt: prompts user to log in on first v2 launch
  instead of silently doing nothing
- Extension version shown in status bar tooltip
- Org UUID resolution via /api/bootstrap (CLI org ID != web org ID)

## Bug Fixes
- Lazy-load puppeteer-core and scraper module to prevent crash on load
- Fix 404 on usage API by resolving correct web org UUID

## Chores
- Rebrand HyperSec to HyperI across codebase (marketplace publisher ID
  stays hypersec, display name updated to HyperI)
- Rename terminology: "lightweight" to "streamlined"
- Migrate ai/ submodule to hyperi-ai/
- Update README: account verification, Cloudflare check, account switch
  flow, troubleshooting, privacy section

# Conflicts:
#	package-lock.json
* v2 replaces Puppeteer browser automation with streamlined
HTTP cookie-based fetching. Existing browser sessions are not migrated;
a fresh login is required on first use of v2.

## What's New in v2

### Features
- HTTP cookie-based fetching: usage data via direct API calls (1-3s, no
  browser overhead) replaces full Puppeteer browser automation (~200MB)
- Self-contained 4.5MB bundle: puppeteer-core bundled via esbuild, no
  node_modules at runtime
- Account verification: after browser login, verifies the browser account
  matches the Claude Code CLI account; rejects mismatched accounts with
  error and re-login prompt
- Account switch detection: credentials watcher detects CLI account changes,
  clears login browser cache, prompts re-login for the new account
- First-run login prompt: prompts user to log in on first v2 launch
  instead of silently doing nothing
- Extension version shown in status bar tooltip
- Org UUID resolution via /api/bootstrap (CLI org ID != web org ID)

### Bug Fixes
- Lazy-load puppeteer-core and scraper module to prevent crash on load
- Fix 404 on usage API by resolving correct web org UUID

### Chores
- Rebrand HyperSec to HyperI across codebase (marketplace publisher ID
  stays hypersec per VS Code Marketplace constraints, display name updated)
- Rename terminology: "lightweight" to "streamlined"
- Migrate ai/ submodule to hyperi-ai/

### Documentation
- README: document account verification, Cloudflare check, account switch
  flow, new troubleshooting section for wrong account after login
- README: update Privacy section — self-contained bundle, account verification
- README: fix typos ("ony top of", "nee HyperSec" → "formerly HyperSec")
* Replace browser automation with direct HTTP API calls.

- Replace puppeteer (~200MB) with puppeteer-core (~2MB, no bundled Chromium)
- All usage fetches now via native fetch() with stored sessionKey cookie (1-3s)
- Browser only launched once for initial login flow
- Retain legacy browser scraper as opt-in fallback (claudemeter.useLegacyScraper)
  because usage API endpoints are undocumented and could change without notice
- Remove proper-lockfile dependency, use file-based locks
- Remove headless setting (no longer applicable)
- Add httpFetcher.js as default fetch engine, legacyAuth.js for legacy scraper
- Update README with v2 architecture, rationale, and troubleshooting
- Update package.json settings and command titles

## [1.3.10](https://github.com/hyperi-io/claudemeter/compare/v1.3.9...v1.3.10) (2026-03-04)


### Bug Fixes

* use refreshToken instead of accessToken for account switch detection ([d9e9202](https://github.com/hyperi-io/claudemeter/commit/d9e9202fab172ba3b610a1635e797bcb33b8a7bb))

## [1.3.9](https://github.com/hyperi-io/claudemeter/compare/v1.3.8...v1.3.9) (2026-03-04)


### Bug Fixes

* bump engines.vscode to match @types/vscode 1.109.0 ([ec36f70](https://github.com/hyperi-io/claudemeter/commit/ec36f70adea4d03a3550bf1b97b92a69d7e18f3c))

## [1.3.8](https://github.com/hyperi-io/claudemeter/compare/v1.3.7...v1.3.8) (2026-03-04)


### Bug Fixes

* account swap detection for org and personal accounts ([#6](https://github.com/hyperi-io/claudemeter/issues/6)) ([425b0e0](https://github.com/hyperi-io/claudemeter/commit/425b0e0f8fecdf0731d749aa59b33c40a1ec4eff))
* clear stale login_failed state on manual retry ([#6](https://github.com/hyperi-io/claudemeter/issues/6)) ([3292cd5](https://github.com/hyperi-io/claudemeter/commit/3292cd58f1f92886f719087745a29fc1381e707c))
* correct YAML syntax in CI and release workflows ([ae1f886](https://github.com/hyperi-io/claudemeter/commit/ae1f886ffd2442e6ef7c9ada2476b518f9d01d98))
* detect account switching and show active account in tooltip ([#6](https://github.com/hyperi-io/claudemeter/issues/6)) ([268caad](https://github.com/hyperi-io/claudemeter/commit/268caade0763f657c8a582cccee2b9da70fe6433))
* show plan details on separate tooltip line ([#6](https://github.com/hyperi-io/claudemeter/issues/6)) ([0c08277](https://github.com/hyperi-io/claudemeter/commit/0c0827711fb6d286f4a3c26a158e92f397781109))
* strip org suffix from personal account names in tooltip ([#6](https://github.com/hyperi-io/claudemeter/issues/6)) ([6950f23](https://github.com/hyperi-io/claudemeter/commit/6950f23642141d974dc0928d066245d215b5d4ee))
* use GH_RUNNER_DEFAULT variable instead of hardcoded runner ([3173c7d](https://github.com/hyperi-io/claudemeter/commit/3173c7d84b8434aaeab51554cf031cfce07cde41))
* watch credentials file for account switching, show plan in tooltip ([#6](https://github.com/hyperi-io/claudemeter/issues/6)) ([551b42a](https://github.com/hyperi-io/claudemeter/commit/551b42a97197ab621ae307849a4a9768a6b73f12))

## [1.3.7](https://github.com/hyperi-io/claudemeter/compare/v1.3.6...v1.3.7) (2026-02-21)


### Bug Fixes

* update CI security gate for submodule-aware repo layout ([bb59a71](https://github.com/hyperi-io/claudemeter/commit/bb59a713dfc0a6f0be6230fbac0bde52ceac609c))

## [1.3.6](https://github.com/hyperi-io/claudemeter/compare/v1.3.5...v1.3.6) (2026-02-10)


### Bug Fixes

* add missing assets for marketplace README rendering ([ff3b4ec](https://github.com/hyperi-io/claudemeter/commit/ff3b4ecc530b56f243d2376a2d22c918bda6847b))

## [1.3.5](https://github.com/hyperi-io/claudemeter/compare/v1.3.4...v1.3.5) (2026-02-10)


### Bug Fixes

* compact mode now shows service status icon ([d8d0468](https://github.com/hyperi-io/claudemeter/commit/d8d0468256830a3d9bec7180e58fa30229bdda3a))
* rebrand to hyperi-io, update README screenshots and typos ([ca2cfef](https://github.com/hyperi-io/claudemeter/commit/ca2cfef90549e781fcfa3c6f4d94c13d8fae5c41))
* update .releaserc.json repositoryUrl for hyperi-io rename ([bbf80e5](https://github.com/hyperi-io/claudemeter/commit/bbf80e55eef0216ff1e3db77da1a3a9cbeb54d71))
* update release workflow repo check for hyperi-io rename ([14189a1](https://github.com/hyperi-io/claudemeter/commit/14189a14160b9d111b47c918fc5f78969ebb8469))

## [1.3.4](https://github.com/hypersec-io/claudemeter/compare/v1.3.3...v1.3.4) (2026-02-03)


### Bug Fixes

* change default timeFormat to countdown ([b2c66bb](https://github.com/hypersec-io/claudemeter/commit/b2c66bb4fb9d0954c57a1202f4d7794fc348bcb7))

## [1.3.3](https://github.com/hypersec-io/claudemeter/compare/v1.3.2...v1.3.3) (2026-02-03)


### Bug Fixes

* change default usageFormat to barCircle ([ad49e13](https://github.com/hypersec-io/claudemeter/commit/ad49e136ef231b331ec89804c74e177d0461c73d))

## [1.3.2](https://github.com/hypersec-io/claudemeter/compare/v1.3.1...v1.3.2) (2026-02-02)


### Bug Fixes

* add timeFormat and usageFormat enum settings ([c609731](https://github.com/hypersec-io/claudemeter/commit/c6097315381bdad2729d03118c9e2ab5329ec1b4)), closes [#5](https://github.com/hypersec-io/claudemeter/issues/5)

## [1.3.1](https://github.com/hypersec-io/claudemeter/compare/v1.3.0...v1.3.1) (2026-02-01)


### Bug Fixes

* add status bar position and progress bar options ([63e4b20](https://github.com/hypersec-io/claudemeter/commit/63e4b201d6016871016db7554f22886df7793474)), closes [#2](https://github.com/hypersec-io/claudemeter/issues/2)

# [1.3.0](https://github.com/hypersec-io/claudemeter/compare/v1.2.4...v1.3.0) (2026-02-01)


### Features

* add 24-hour time format option ([7ed71de](https://github.com/hypersec-io/claudemeter/commit/7ed71de14fde2a3571298cefb271dee57e78a094)), closes [#4](https://github.com/hypersec-io/claudemeter/issues/4)

## [1.2.4](https://github.com/hypersec-io/claudemeter/compare/v1.2.3...v1.2.4) (2026-01-31)


### Bug Fixes

* separate poll intervals for local tokens and web scraping ([dfedf01](https://github.com/hypersec-io/claudemeter/commit/dfedf01c2cb75e02dce90988dda656d80330d3e4))

## [1.2.3](https://github.com/hypersec-io/claudemeter/compare/v1.2.2...v1.2.3) (2026-01-31)


### Bug Fixes

* cross-platform line ending handling for JSONL parsing ([971d3b2](https://github.com/hypersec-io/claudemeter/commit/971d3b23caf4e873ed739d629f0d693d52a17538))

## [1.2.2](https://github.com/hypersec-io/claudemeter/compare/v1.2.1...v1.2.2) (2026-01-31)


### Bug Fixes

* Windows token monitoring path handling ([d04eed2](https://github.com/hypersec-io/claudemeter/commit/d04eed25a2634ebf05d8090562c49c830fb8e771))

## [1.2.1](https://github.com/hypersec-io/claudemeter/compare/v1.2.0...v1.2.1) (2026-01-30)


### Bug Fixes

* prevent unnecessary login browser popup on transient errors ([936478f](https://github.com/hypersec-io/claudemeter/commit/936478f641f5e202d332ba294e1205a910be57fb))

# [1.2.0](https://github.com/hypersec-io/claudemeter/compare/v1.1.4...v1.2.0) (2026-01-29)


### Features

* add Claude service status indicator ([194f605](https://github.com/hypersec-io/claudemeter/commit/194f6054d5ee8e6b39d83303f866d764a9eaf506))

## [1.1.4](https://github.com/hypersec-io/claudemeter/compare/v1.1.3...v1.1.4) (2026-01-18)


### Bug Fixes

* multi-window browser coordination ([#3](https://github.com/hypersec-io/claudemeter/issues/3)) ([72aea5d](https://github.com/hypersec-io/claudemeter/commit/72aea5deb005efd5f42b52cc33cb275b6991438f))

## [1.1.3](https://github.com/hypersec-io/claudemeter/compare/v1.1.2...v1.1.3) (2026-01-15)


### Bug Fixes

* revert multi-session changes due to bugs discovered in regression testing ([3c2c3c2](https://github.com/hypersec-io/claudemeter/commit/3c2c3c2776fc6ce2421a4feef9954a99e8ce70a9))

## [1.1.2](https://github.com/hypersec-io/claudemeter/compare/v1.1.1...v1.1.2) (2026-01-15)


### Bug Fixes

* multi-session support showing highest token usage ([aa6b4a6](https://github.com/hypersec-io/claudemeter/commit/aa6b4a6263b9dcbab8f891b4c69ade2748f04409))

## [1.1.1](https://github.com/hypersec-io/claudemeter/compare/v1.1.0...v1.1.1) (2026-01-13)


### Bug Fixes

* remove emojis from release bot comments ([a2a46e5](https://github.com/hypersec-io/claudemeter/commit/a2a46e544e7d1a1d85d0221ea24ac0e5ff47195a))

# [1.1.0](https://github.com/hypersec-io/claudemeter/compare/v1.0.2...v1.1.0) (2026-01-13)


### Features

* support Remote SSH sessions ([96350d7](https://github.com/hypersec-io/claudemeter/commit/96350d765fd63000f0a6e73a5253d17b50966a92)), closes [#1](https://github.com/hypersec-io/claudemeter/issues/1)

## [1.0.2](https://github.com/hypersec-io/claudemeter/compare/v1.0.1...v1.0.2) (2026-01-13)


### Bug Fixes

* use lowercase publisher ID for marketplace ([7c78f23](https://github.com/hypersec-io/claudemeter/commit/7c78f23bcd71a679bceef82ef767d55dc6037d56))

## [1.0.1](https://github.com/hypersec-io/claudemeter/compare/v1.0.0...v1.0.1) (2026-01-13)


### Bug Fixes

* exclude AI tooling from VSIX package ([e178d6f](https://github.com/hypersec-io/claudemeter/commit/e178d6ffe0b80e0e48b520b293568928867b0001))

# 1.0.0 (2026-01-13)


### Bug Fixes

* add keywords to extension for marketplace ([540fa7b](https://github.com/hypersec-io/claudemeter/commit/540fa7bbc6f5316c3c69bd1f8e081dafbb4426a7))
* update README and login screenshots ([bb70dcf](https://github.com/hypersec-io/claudemeter/commit/bb70dcf7ad2c3c9b448a0a98812cf4f07b0702a8))

# 1.0.0 (2026-01-13)


### Bug Fixes

* add keywords to extension for marketplace ([540fa7b](https://github.com/hypersec-io/claudemeter/commit/540fa7bbc6f5316c3c69bd1f8e081dafbb4426a7))
* update README and login screenshots ([bb70dcf](https://github.com/hypersec-io/claudemeter/commit/bb70dcf7ad2c3c9b448a0a98812cf4f07b0702a8))

# 1.0.0 (2026-01-13)


### Bug Fixes

* add keywords to extension for marketplace ([540fa7b](https://github.com/hypersec-io/claudemeter/commit/540fa7bbc6f5316c3c69bd1f8e081dafbb4426a7))

## [1.2.1](https://github.com/hypersec-io/claudemeter/compare/v1.2.0...v1.2.1) (2026-01-13)


### Bug Fixes

* update icon path to match renamed asset ([26e9828](https://github.com/hypersec-io/claudemeter/commit/26e98284b2767318b5d0d34acd94a8dd04e93258))

# [1.2.0](https://github.com/hypersec-io/claudemeter/compare/v1.1.1...v1.2.0) (2026-01-13)


### Features

* add VS Code Marketplace CI deployment and consolidate assets ([73d0816](https://github.com/hypersec-io/claudemeter/commit/73d081681c06f25aaa74e3546fb76e2cb15e250a))

## [1.1.1](https://github.com/hypersec-io/claudemeter/compare/v1.1.0...v1.1.1) (2026-01-12)


### Bug Fixes

* show prepaid credits balance in Extra Usage tooltip ([3ced959](https://github.com/hypersec-io/claudemeter/commit/3ced9590ae38e6ff9912f477a9935a217cfdd839))

# [1.1.0](https://github.com/hypersec-io/claudemeter/compare/v1.0.0...v1.1.0) (2026-01-12)


### Features

* add token-only mode and improve browser detection ([ca4273f](https://github.com/hypersec-io/claudemeter/commit/ca4273f67eb95d19851b1a7416b09f9bad95c019))

# 1.0.0 (2026-01-06)


### Bug Fixes

* **ci:** use gitleaks binary instead of action ([627aea3](https://github.com/hypersec-io/claudemeter/commit/627aea30ea73fdab3e7a7f5b8730dba6a6881325))

# Changelog

All notable changes to Claudemeter will be documented in this file.

## [1.0.0] - 2026-01-06

### Initial Release

Claudemeter is a VS Code extension for monitoring Claude.ai web usage and Claude Code token consumption.

#### Features

- **Direct API Access**: Fast, reliable data retrieval using Claude.ai's internal API
  - 2-3x faster than traditional web scraping
  - Intelligent fallback to HTML scraping if API fails

- **Comprehensive Usage Tracking**: Monitor all Claude.ai usage metrics
  - Session usage with reset countdown
  - Rolling weekly usage
  - Sonnet model weekly usage
  - Opus model weekly usage (Max plans)
  - Extra Usage (spending cap) monitoring

- **Claude Code Token Tracking**: Real-time monitoring of development sessions
  - Automatic JSONL file monitoring
  - Per-project token tracking
  - Input, output, and cache token breakdown

- **Configurable Status Bar**: Choose which metrics to display
  - Session, Weekly, Sonnet, Opus, Tokens, Credits
  - Each metric can be shown/hidden independently
  - Color-coded warnings (configurable thresholds)
  - Detailed tooltips with reset times and activity status

- **Configurable Thresholds**: Customize warning and error levels
  - Global warning threshold (default 80%)
  - Global error threshold (default 90%)
  - Per-gauge overrides for session, tokens, weekly, Sonnet, Opus, credits
  - Token threshold defaults to 65% (VS Code auto-compacts at ~65-75%)

- **Auto-Refresh**: Configurable interval (1-60 minutes, default 5)

- **Silent Mode**: Runs browser in headless mode, shows only if login needed

- **Session Persistence**: Log in once, stay authenticated across sessions

---

**Attribution:** Based on [claude-usage-monitor](https://github.com/Gronsten/claude-usage-monitor) by Mark Campbell.
