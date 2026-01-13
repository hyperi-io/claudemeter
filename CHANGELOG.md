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
