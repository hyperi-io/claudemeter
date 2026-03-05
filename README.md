# Claudemeter

[![VS Code Installs](https://img.shields.io/visual-studio-marketplace/i/HyperSec.claudemeter)](https://marketplace.visualstudio.com/items?itemName=HyperSec.claudemeter)
[![GitHub License](https://img.shields.io/github/license/hyperi-io/claudemeter)](https://github.com/hyperi-io/claudemeter)
[![GitHub Issues](https://img.shields.io/github/issues/hyperi-io/claudemeter)](https://github.com/hyperi-io/claudemeter/issues)
[![GitHub Stars](https://img.shields.io/github/stars/hyperi-io/claudemeter)](https://github.com/hyperi-io/claudemeter)

![Icon](assets/claudemeter-logo-trim.png)
> Monitor your Claude Code usage in real time, with full limit information.  
> *No more 'Surprise! You've hit your Claude Code weekly limit and it resets in 3 days you lucky, lucky person!'*

![Tooltip](assets/tooltip.png)

- Token context usage
- Session limits
- Weekly limits
- Limit consumption and reset times
- Claude service status (working, partial outage, major outage)
- Claude session and login all local to device
- Open source: <https://github.com/hyperi-io/claudemeter>

---

## Status Bar Default

![Status Bar Default](assets/status-bar-default.png)

## Minimal Status Bar

![Status Bar Minimal](assets/status-bar-minimal.png)

## Compact Status Bar

![Status Bar Compact](assets/status-bar-compact.png)

## 12 Hour

![Status Bar 12h](assets/status-bar-default-12h.png)

## 24 Hour

![Status Bar 24h](assets/status-bar-default-24h.png)


## How It Works

Claudemeter v2 uses lightweight HTTP requests to fetch your usage data directly from Claude.ai's API endpoints. A browser is only needed once for the initial login — after that, your session cookie is stored locally and all subsequent fetches complete in 1-3 seconds with no browser overhead.

> **Why not use the Claude CLI's OAuth token?** The CLI's OAuth scopes (`user:inference`, `user:profile`, etc.) don't grant access to the usage/billing endpoints. Only the `sessionKey` cookie from a browser login works. If Anthropic ever expands the CLI scopes, the browser login could be eliminated entirely.

> **Why keep puppeteer-core?** The usage API endpoints are undocumented and could change without notice. `puppeteer-core` (~2MB, no bundled Chromium) handles the login flow and powers an opt-in legacy scraper fallback if the API breaks. See `claudemeter.useLegacyScraper` in settings.

## Installation

### Prerequisites

- VS Code 1.109.0 or higher
- A Chromium-based browser for login (Chrome, Chromium, Brave, Edge, Arc, Vivaldi, or Opera)

## First-Time Setup

The extension will **automatically fetch usage data** when VS Code starts. If you haven't logged in before:

1. A browser window will open for you to log in to Claude.ai
2. Log in with your credentials (Google, email, etc.)
3. Once logged in, the extension saves your session cookie locally
4. The browser closes and all future fetches use fast HTTP requests — no browser needed

![Login 1](assets/login-1.png)
![Login 2](assets/login-2.png)
![Login 3](assets/login-3.png)

## Configuration

![Settings1](assets/settings1.png)
![Settings1](assets/settings2.png)

Open VS Code Settings and search for "Claudemeter" to configure:

### `claudemeter.fetchOnStartup`

- **Type**: Boolean
- **Default**: `true`
- **Description**: Automatically fetch usage data when VS Code starts

### `claudemeter.autoRefreshMinutes`

- **Type**: Number
- **Default**: `5`
- **Range**: `1-60` minutes
- **Description**: Auto-refresh interval in minutes for fetching Claude.ai usage data via HTTP. Each fetch takes 1-3 seconds with no browser overhead.

### `claudemeter.localRefreshSeconds`

- **Type**: Number
- **Default**: `15`
- **Range**: `5-60` seconds
- **Description**: Local token refresh interval in seconds. Controls how often local Claude Code token data is polled from JSONL files. This is a lightweight local operation (no web requests). Set higher to reduce CPU usage.

### `claudemeter.tokenLimit`

- **Type**: Number
- **Default**: `200000`
- **Range**: `1000-2000000`
- **Description**: Context window token limit used to calculate usage percentage

### `claudemeter.tokenOnlyMode`

- **Type**: Boolean
- **Default**: `false`
- **Description**: Token-only mode - only track Claude Code tokens, skip Claude.ai usage fetching entirely

### `claudemeter.useLegacyScraper`

- **Type**: Boolean
- **Default**: `false`
- **Description**: Use the legacy browser-based scraper instead of lightweight HTTP fetching. The default HTTP method calls undocumented Claude.ai API endpoints that could change without notice. Enable this fallback if the HTTP method stops working due to API changes. Requires a Chromium-based browser.

### `claudemeter.statusBar.displayMode`

- **Type**: String
- **Default**: `default`
- **Options**: `default`, `minimal`, `compact`
- **Description**: Status bar display mode:
  - **default**: Full display with reset times (separate panels)
  - **minimal**: Percentages only (separate panels)
  - **compact**: All metrics in a single panel

### `claudemeter.statusBar.showSonnet`

- **Type**: Boolean
- **Default**: `false`
- **Description**: Show Sonnet weekly usage in status bar (default/minimal modes only)

### `claudemeter.statusBar.showOpus`

- **Type**: Boolean
- **Default**: `false`
- **Description**: Show Opus weekly usage in status bar (Max plans only, default/minimal modes)

### `claudemeter.statusBar.showCredits`

- **Type**: Boolean
- **Default**: `false`
- **Description**: Show extra usage (spending cap) in status bar (default/minimal modes only)

### `claudemeter.statusBar.showServiceStatus`

- **Type**: Boolean
- **Default**: `true`
- **Description**: Show Claude service status indicator. Displays a warning/error icon if Claude services are degraded or experiencing an outage.

### `claudemeter.statusBar.timeFormat`

- **Type**: String
- **Default**: `countdown`
- **Options**: `12hour`, `24hour`, `countdown`
- **Description**: How to display reset times in the status bar:
  - **12hour**: 12-hour format with AM/PM (e.g., 2:30 PM)
  - **24hour**: 24-hour format (e.g., 14:30)
  - **countdown**: Countdown timer (e.g., 2h 15m)

### `claudemeter.statusBar.usageFormat`

- **Type**: String
- **Default**: `barCircle`
- **Options**: `percent`, `barLight`, `barSolid`, `barSquare`, `barCircle`
- **Description**: How to display usage values in the status bar:
  - **percent**: Percentage (e.g., 60%)
  - **barLight**: Light blocks (e.g., ▓▓▓░░)
  - **barSolid**: Solid blocks (e.g., ███░░)
  - **barSquare**: Squares (e.g., ■■■□□)
  - **barCircle**: Circles (e.g., ●●●○○)

### `claudemeter.statusBar.alignment`

- **Type**: String
- **Default**: `right`
- **Options**: `left`, `right`
- **Description**: Status bar alignment. Requires window reload to take effect.

### `claudemeter.statusBar.priority`

- **Type**: Number
- **Default**: `100`
- **Range**: `0-10000`
- **Description**: Status bar priority (higher values position items closer to the center). Requires window reload to take effect.

### `claudemeter.debug`

- **Type**: Boolean
- **Default**: `false`
- **Description**: Enable debug logging to output channel (for troubleshooting)

### Threshold Configuration

Configure warning and error thresholds globally or per-gauge:

```json
{
  "claudemeter.thresholds.warning": 80,
  "claudemeter.thresholds.error": 90,
  "claudemeter.thresholds.tokens.warning": 65
}
```

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **`Claudemeter: Fetch Claude Usage Now`** - Manually fetch current usage data
- **`Claudemeter: Open Claude Settings Page`** - Open claude.ai/settings in your default browser
- **`Claudemeter: Start New Claude Code Session`** - Start a new token tracking session
- **`Claudemeter: Show Debug Output`** - Open debug output channel
- **`Claudemeter: Login to Claude.ai`** - Open browser for login
- **`Claudemeter: Clear Session (Re-login)`** - Clear saved session and force re-login
- **`Claudemeter: Reset Browser Connection (Legacy)`** - Reset browser connection (legacy scraper mode only)

## Troubleshooting

### Browser won't open for login

- Ensure you have a Chromium-based browser installed (Chrome, Edge, Brave, etc.)
- The extension auto-detects your default browser; if it's not Chromium-based (e.g., Firefox), install Chrome or Edge
- Try running VS Code as administrator (Windows)

### Session expired or fetch errors

- Run **Claudemeter: Clear Session (Re-login)** from the Command Palette
- Or manually delete the session cookie file:
  - macOS: `~/Library/Application Support/claudemeter/session-cookie.json`
  - Linux: `~/.config/claudemeter/session-cookie.json`
  - Windows: `%APPDATA%\claudemeter\session-cookie.json`

### API changes broke usage fetching

- Claude.ai's usage API endpoints are undocumented and may change without notice
- Try enabling the legacy scraper: set `claudemeter.useLegacyScraper` to `true` in settings
- Check if you can see your usage at [claude.ai/settings](https://claude.ai/settings)
- [Report an issue](https://github.com/hyperi-io/claudemeter/issues) so the extension can be updated

## Privacy & Security

- **No credentials stored**: The extension never stores or transmits your login credentials
- **Local session cookie**: Your `sessionKey` cookie is saved locally at `~/.config/claudemeter/session-cookie.json` (or platform equivalent) and is only sent to `claude.ai`
- **No data transmission**: Usage data stays on your machine
- **No bundled browser**: Uses your existing system browser for login only (via `puppeteer-core`)
- **Open source**: All code is available for review

## Feedback & Issues

If you encounter any issues or have suggestions:

1. Check the troubleshooting section above
2. Review open issues on [GitHub](https://github.com/hyperi-io/claudemeter/issues)
3. Submit a new issue with:
   - VS Code version
   - Extension version
   - Error messages from the Output panel (View → Output → Claudemeter - Token Monitor)
   - Steps to reproduce

## Authors

![HyperI Logo](assets/hyperi-logo.png)

Paying it forward by the hoopy froods at HyperI (nee HyperSec)
<https://hyperi.io>

## Development

### Optional AI Submodule (HyperI Internal)

This repo includes an optional `ai/` submodule containing the HyperI AI assistant meta layer ony top of Claude Code and coding standards. It's a private repo - external contributors can safely ignore it.

```bash
# HyperSec devs only - init the submodule if you have access
git submodule update --init ai
```

External clones work normally without the submodule.

## License

MIT License - See LICENSE file for details.

Originally inspired and based on [claude-usage-monitor](https://github.com/Gronsten/claude-usage-monitor) by Mark Campbell.

---

**Note**: This is an unofficial extension and is not affiliated with Anthropic or Claude.ai.
