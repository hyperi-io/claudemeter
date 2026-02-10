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


## Installation

### Prerequisites

- VS Code 1.80.0 or higher
- A Chromium-based browser (Chrome, Chromium, Brave, or Edge)

## First-Time Setup

The extension will **automatically fetch usage data** when VS Code starts. If you haven't logged in before:

1. A browser window will appear (the extension detected you need to log in)
2. Log in to Claude.ai with your credentials
3. Once logged in, the extension automatically fetches your usage data
4. Your session is saved locally - you won't need to log in again

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

### `claudemeter.headless`

- **Type**: Boolean
- **Default**: `true`
- **Description**: Run browser in headless (hidden) mode. Browser will show automatically if login is needed.

### `claudemeter.autoRefreshMinutes`

- **Type**: Number
- **Default**: `5`
- **Range**: `1-60` minutes
- **Description**: Auto-refresh interval in minutes for fetching Claude.ai web usage data. This triggers browser automation to scrape session and weekly limits from claude.ai/settings.

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
- **Description**: Token-only mode - only track Claude Code tokens, skip Claude.ai web usage scraping entirely

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
- **`Claudemeter: Reset Browser Connection`** - Reset browser connection if stuck
- **`Claudemeter: Clear Browser Session (Re-login)`** - Force re-login
- **`Claudemeter: Open Browser for Login`** - Manually open browser for login

## Troubleshooting

### Browser won't launch

- Ensure you have enough disk space (~500MB for Chromium)
- Check that no antivirus is blocking Puppeteer
- Try running VS Code as administrator (Windows)

### Session expired or corrupted

- Delete the session folder:
  - macOS: `~/Library/Application Support/claudemeter/`
  - Linux: `~/.config/claudemeter/`
  - Windows: `%APPDATA%\claudemeter\`
- Log in again - session should persist this time

### Can't find usage data

- Claude.ai may have changed their settings page layout
- Check if you can see your usage at [claude.ai/settings](https://claude.ai/settings)
- [Report an issue](https://github.com/hyperi-io/claudemeter/issues) for the extension to be updated

## Privacy & Security

- **No credentials stored**: The extension never stores or transmits your credentials
- **Local session only**: Your authentication session is saved locally by Chromium
- **No data transmission**: Usage data stays on your machine
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

![HyperSec Logo](assets/hyperi-logo.png)

Paying it forward by the hoopy froods at HyperI (nee HyperSec)
<https://hyperi.io>

## Development

### Optional AI Submodule (HyperSec Internal)

This repo includes an optional `ai/` submodule containing HyperSec coding standards. It's a private repo - external contributors can safely ignore it.

```bash
# HyperSec devs only - init the submodule if you have access
git submodule update --init ai
```

External clones work normally without the submodule.

## License

MIT License - See LICENSE file for details.

Originally inspired and based on [claude-usage-monitor](https://github.com/Gronsten/claude-usage-monitor) by Mark Campbell. If you find this useful, please consider [sponsoring the original author](https://github.com/sponsors/Gronsten).

---

**Note**: This is an unofficial extension and is not affiliated with Anthropic or Claude.ai.
