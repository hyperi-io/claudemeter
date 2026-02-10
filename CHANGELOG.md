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
