// Project:   Claudemeter
// File:      utils.js
// Purpose:   Shared constants and utility functions
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const CONFIG_NAMESPACE = 'claudemeter';

// Split text into lines, handling both Unix (\n) and Windows (\r\n) line endings
function splitLines(text) {
    return text.split(/\r?\n/);
}

// Command IDs (must match package.json contributes.commands)
const COMMANDS = {
    FETCH_NOW: 'claudemeter.fetchNow',
    OPEN_SETTINGS: 'claudemeter.openSettings',
    START_SESSION: 'claudemeter.startNewSession',
    SHOW_DEBUG: 'claudemeter.showDebug',
    RESET_CONNECTION: 'claudemeter.resetConnection',
    CLEAR_SESSION: 'claudemeter.clearSession',
    OPEN_BROWSER: 'claudemeter.openBrowser',
    RESYNC_ACCOUNT: 'claudemeter.resyncAccount',
    DUMP_STATE: 'claudemeter.dumpState',
    TEST_RATE_LIMIT: 'claudemeter.testRateLimit',
};

// Cross-platform config directory following OS conventions
// macOS: ~/Library/Application Support/claudemeter
// Linux: ~/.config/claudemeter (XDG spec)
// Windows: %APPDATA%\claudemeter
function getConfigDir() {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'claudemeter');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'claudemeter');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claudemeter');
}

const CONFIG_DIR = getConfigDir();

const PATHS = {
    CONFIG_DIR: CONFIG_DIR,
    SESSION_COOKIE_FILE: path.join(CONFIG_DIR, 'session-cookie.json'),
    SESSION_DATA_FILE: path.join(CONFIG_DIR, 'session-data.json'),
    USAGE_HISTORY_FILE: path.join(CONFIG_DIR, 'usage-history.json'),
    // Legacy scraper paths (used when useLegacyScraper is enabled)
    BROWSER_SESSION_DIR: path.join(CONFIG_DIR, 'browser-session'),
    BROWSER_LOCK_FILE: path.join(CONFIG_DIR, 'browser.lock'),
    BROWSER_STATE_FILE: path.join(CONFIG_DIR, 'browser-state.json'),
};

const { FALLBACK_LIMIT: DEFAULT_TOKEN_LIMIT } = require('./modelContextWindows');

// File-based debug logging with instance identification
// Each instance identified by short hash + project name for easy differentiation
let fileLoggerInstance = null;

class FileLogger {
    constructor(workspacePath = null) {
        this.workspacePath = workspacePath;
        this.instanceId = this.generateInstanceId(workspacePath);
        this.logFile = this.getLogFilePath();
        this.maxSizeBytes = this.getMaxSizeBytes();
    }

    getLogFilePath() {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const customPath = config.get('debugLogFile', '');
        if (customPath && customPath.trim()) {
            // Expand ~ to home directory
            let expandedPath = customPath.trim();
            if (expandedPath.startsWith('~/')) {
                expandedPath = path.join(os.homedir(), expandedPath.slice(2));
            }
            return expandedPath;
        }
        return path.join(PATHS.CONFIG_DIR, 'debug.log');
    }

    getMaxSizeBytes() {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const maxSizeKB = config.get('debugLogMaxSizeKB', 256);
        return Math.max(64, Math.min(2048, maxSizeKB)) * 1024;
    }

    generateInstanceId(workspacePath) {
        if (!workspacePath) {
            return '[global]';
        }
        // Short hash (8 chars) + project name for identification
        const hash = crypto.createHash('sha256').update(workspacePath).digest('hex').slice(0, 8);
        const projectName = path.basename(workspacePath);
        return `[${hash}:${projectName}]`;
    }

    trimIfNeeded() {
        try {
            if (!fs.existsSync(this.logFile)) return;

            const stats = fs.statSync(this.logFile);
            if (stats.size >= this.maxSizeBytes) {
                // FIFO trim: keep newest ~75% of max size, discard oldest entries
                const content = fs.readFileSync(this.logFile, 'utf-8');
                const lines = splitLines(content);
                const targetSize = Math.floor(this.maxSizeBytes * 0.75);

                // Find cut point to keep ~targetSize bytes from the end
                let keptSize = 0;
                let cutIndex = lines.length;
                for (let i = lines.length - 1; i >= 0; i--) {
                    keptSize += lines[i].length + 1; // +1 for newline
                    if (keptSize >= targetSize) {
                        cutIndex = i;
                        break;
                    }
                }

                const trimmedContent = lines.slice(cutIndex).join('\n');
                fs.writeFileSync(this.logFile, trimmedContent);
            }
        } catch (e) {
            // Ignore trim errors
        }
    }

    log(message) {
        if (!isDebugEnabled()) return;

        try {
            const dir = path.dirname(this.logFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            this.trimIfNeeded();

            const timestamp = new Date().toISOString();
            const line = `${timestamp} ${this.instanceId} ${message}\n`;
            fs.appendFileSync(this.logFile, line);
        } catch (e) {
            // Silently ignore write errors to avoid blocking
        }
    }

    clear() {
        try {
            if (fs.existsSync(this.logFile)) {
                fs.unlinkSync(this.logFile);
            }
        } catch (e) {
            // Ignore
        }
    }
}

function initFileLogger(workspacePath) {
    fileLoggerInstance = new FileLogger(workspacePath);
    return fileLoggerInstance;
}

function getFileLogger() {
    if (!fileLoggerInstance) {
        fileLoggerInstance = new FileLogger(null);
    }
    return fileLoggerInstance;
}

function fileLog(message) {
    getFileLogger().log(message);
}

function getDefaultDebugLogPath() {
    return path.join(PATHS.CONFIG_DIR, 'debug.log');
}

// Timeouts in milliseconds
const TIMEOUTS = {
    PAGE_LOAD: 45000,
    LOGIN_WAIT: 300000,
    LOGIN_POLL: 2000,
    API_RETRY_DELAY: 2000,
    SESSION_DURATION: 3600000
};

// Legacy scraper viewport (used when useLegacyScraper is enabled)
const VIEWPORT = {
    WIDTH: 1280,
    HEIGHT: 800
};

const CLAUDE_URLS = {
    BASE: 'https://claude.ai',
    LOGIN: 'https://claude.ai/login',
    USAGE: 'https://claude.ai/settings/usage',
    API_ORGS: 'https://claude.ai/api/organizations'
};

// Debug output channel (lazy initialised)
let debugChannel = null;
let runningInDevMode = false;

function setDevMode(isDev) {
    runningInDevMode = isDev;
}

function isDebugEnabled() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const userEnabled = config.get('debug', false);
    return userEnabled || runningInDevMode;
}

function getDebugChannel() {
    if (!debugChannel) {
        debugChannel = vscode.window.createOutputChannel('Claudemeter - API Debug');
    }
    return debugChannel;
}

function disposeDebugChannel() {
    if (debugChannel) {
        debugChannel.dispose();
        debugChannel = null;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Resolve the token limit for the current session, returning the full
// {limit, source, confidence} triple from contextWindowResolver.
//
// Accepts an optional `ctx` object with any of these pre-fetched signals:
//   modelIds         - array of model IDs from JSONL (e.g. from claudeDataLoader)
//   observedFloor    - max cache_read tokens observed (e.g. highestCacheRead)
//   capabilities     - live /api/bootstrap org.capabilities array
//                      (from httpFetcher AccountIdentityCache.accountInfo.capabilities)
//   subscriptionType - local .credentials.json subscriptionType fallback
//
// Signals not passed in ctx are resolved here from VS Code settings /
// ~/.claude.json etc. This design lets call sites that already have
// the live API signals pass them in for the most accurate result,
// while simpler call sites can call with just modelIds/observedFloor.
function resolveTokenLimit(ctx = {}) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const userOverride = config.get('tokenLimit', 0);

    const { resolveContextWindow } = require('./contextWindowResolver');
    const { parseModelAlias, getHighestDeclaredLimit } = require('./modelContextWindows');

    // Claude Code's selected model picker may embed an explicit suffix
    const ccModel = vscode.workspace.getConfiguration('claudeCode').get('selectedModel', '');
    const aliasDeclaredLimit = parseModelAlias(ccModel);

    // JSONL model IDs may (rarely) carry [Nm] suffixes. Claude Code
    // strips these in practice, but the parser is kept for future-
    // proofing in case the behaviour changes.
    const jsonlDeclaredLimit = getHighestDeclaredLimit(ctx.modelIds || null);

    // Claude Code's own eligibility cache. Read lazily (file is small,
    // cost negligible) and only trusted as a corroborating signal —
    // never as a definitive negative, since we've seen it go stale
    // with hasAccess:false on accounts that were genuinely running
    // 1M context at the time.
    let s1mHasAccess = null;
    try {
        const { hasMaxContextAccess } = require('./claudeConfigReader');
        s1mHasAccess = hasMaxContextAccess();
    } catch {
        s1mHasAccess = null;
    }

    // Local subscription fallback (used when live capabilities aren't
    // available — tokenOnlyMode, pre-first-fetch, offline).
    let subscriptionType = ctx.subscriptionType || null;
    if (!subscriptionType) {
        try {
            const { readCredentials } = require('./credentialsReader');
            const creds = readCredentials();
            subscriptionType = creds?.subscriptionType || null;
        } catch {
            subscriptionType = null;
        }
    }

    return resolveContextWindow({
        userOverride,
        aliasDeclaredLimit,
        jsonlDeclaredLimit,
        capabilities: ctx.capabilities || null,
        subscriptionType,
        s1mHasAccess,
        modelIds: ctx.modelIds || null,
        observedFloor: ctx.observedFloor || 0,
    });
}

// Back-compat wrapper that returns just the numeric limit. New callers
// that want the source/confidence metadata should use resolveTokenLimit
// directly. This wrapper is intentionally conservative — existing call
// sites that read a bare number continue to work.
function getTokenLimit(modelIds = null, maxObservedTokens = 0) {
    return resolveTokenLimit({
        modelIds,
        observedFloor: maxObservedTokens,
    }).limit;
}

function getTimeFormat() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return config.get('statusBar.timeFormat', 'countdown');
}

function getUse24HourTime() {
    return getTimeFormat() === '24hour';
}

function getUseCountdownTimer() {
    return getTimeFormat() === 'countdown';
}

// Format countdown string (e.g., "2h 15m", "5d 21h")
function formatCountdown(resetTime) {
    try {
        const days = resetTime.match(/(\d+)d/);
        const hours = resetTime.match(/(\d+)h/);
        const minutes = resetTime.match(/(\d+)m/);

        const parts = [];
        if (days) parts.push(`${parseInt(days[1])}d`);
        if (hours) parts.push(`${parseInt(hours[1])}h`);
        if (minutes && !days) parts.push(`${parseInt(minutes[1])}m`);  // Skip minutes if days shown

        return parts.join(' ') || '0m';
    } catch (error) {
        return '??';
    }
}

// Parse relative time string (e.g. "2h 30m", "5d 21h") and calculate reset datetime
function calculateResetClockTime(resetTime, timeFormat = { hour: 'numeric', minute: '2-digit' }) {
    // If countdown mode enabled, return the relative time directly
    if (getUseCountdownTimer()) {
        return formatCountdown(resetTime);
    }

    try {
        const days = resetTime.match(/(\d+)d/);
        const hours = resetTime.match(/(\d+)h/);
        const minutes = resetTime.match(/(\d+)m/);

        let totalMinutes = 0;
        if (days) totalMinutes += parseInt(days[1]) * 24 * 60;
        if (hours) totalMinutes += parseInt(hours[1]) * 60;
        if (minutes) totalMinutes += parseInt(minutes[1]);

        const now = new Date();
        const resetDate = new Date(now.getTime() + totalMinutes * 60 * 1000);

        const hour12 = !getUse24HourTime();

        if (totalMinutes >= 24 * 60) {
            // Multi-day: show "Fri 15:20" (day name + time) for clarity
            const dayName = resetDate.toLocaleDateString(undefined, { weekday: 'short' });
            const timeStr = resetDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 });
            return `${dayName} ${timeStr}`;
        }

        // Within 24 hours: show time
        const timeStr = resetDate.toLocaleTimeString(undefined, { ...timeFormat, hour12 });
        return timeStr;
    } catch (error) {
        return '??:??';
    }
}

// Full datetime format for tooltips
function calculateResetClockTimeExpanded(resetTime) {
    try {
        const days = resetTime.match(/(\d+)d/);
        const hours = resetTime.match(/(\d+)h/);
        const minutes = resetTime.match(/(\d+)m/);

        let totalMinutes = 0;
        if (days) totalMinutes += parseInt(days[1]) * 24 * 60;
        if (hours) totalMinutes += parseInt(hours[1]) * 60;
        if (minutes) totalMinutes += parseInt(minutes[1]);

        const now = new Date();
        const resetDate = new Date(now.getTime() + totalMinutes * 60 * 1000);

        return resetDate.toLocaleString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: 'numeric',
            minute: '2-digit',
            hour12: !getUse24HourTime()
        });
    } catch (error) {
        return 'Unknown';
    }
}

function getCurrencySymbol(currency) {
    const symbols = {
        USD: '$',
        AUD: '$',
        CAD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥',
        CNY: '¥',
        KRW: '₩',
        INR: '₹',
        BRL: 'R$',
        MXN: '$',
        CHF: 'CHF ',
        SEK: 'kr',
        NOK: 'kr',
        DKK: 'kr',
        NZD: '$',
        SGD: '$',
        HKD: '$',
    };
    return symbols[currency] || '';
}

function formatCompact(value) {
    if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}K`;
    }
    return Math.round(value).toString();
}

// Find an available TCP port (for browser debugging)
function findAvailablePort() {
    const net = require('net');
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

module.exports = {
    CONFIG_NAMESPACE,
    COMMANDS,
    PATHS,
    DEFAULT_TOKEN_LIMIT,
    TIMEOUTS,
    VIEWPORT,
    CLAUDE_URLS,
    getTokenLimit,
    resolveTokenLimit,
    getTimeFormat,
    getUse24HourTime,
    getUseCountdownTimer,
    setDevMode,
    isDebugEnabled,
    getDebugChannel,
    disposeDebugChannel,
    sleep,
    calculateResetClockTime,
    calculateResetClockTimeExpanded,
    formatCountdown,
    getCurrencySymbol,
    formatCompact,
    initFileLogger,
    getFileLogger,
    fileLog,
    getDefaultDebugLogPath,
    splitLines,
    findAvailablePort
};
