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

// "1 setting" / "2 settings" - regular plurals only.
function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// Command IDs (must match package.json contributes.commands)
const COMMANDS = {
    FETCH_NOW: 'claudemeter.fetchNow',
    OPEN_SETTINGS: 'claudemeter.openSettings',
    START_SESSION: 'claudemeter.startNewSession',
    SHOW_DEBUG: 'claudemeter.showDebug',
    // Launches `claude auth login` in a terminal when no OAuth token is
    // found. Replaced the old browser-login / paste-cookie / resync
    // commands -- claudemeter no longer owns a session, it tracks Claude
    // Code's token.
    LOGIN_CLI: 'claudemeter.login',
    DUMP_STATE: 'claudemeter.dumpState',
    SIMULATE_STATUS: 'claudemeter.simulateStatus',
    // Nopilot: applies the VS Code settings that switch off the built-in
    // Copilot surfaces, telemetry, nags and self-opening panels.
    NOPILOT: 'claudemeter.nopilot',
    NOPILOT_DISMISS: 'claudemeter.nopilot.dismiss',
    NOPILOT_UNDO: 'claudemeter.nopilot.undo',
};

// Claudemeter's OWN config directory, following OS conventions. Named apart
// from tokenSource.getConfigDir, which resolves Claude Code's.
// macOS: ~/Library/Application Support/claudemeter
// Linux: ~/.config/claudemeter (XDG spec)
// Windows: %APPDATA%\claudemeter
function getClaudemeterConfigDir() {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'claudemeter');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'claudemeter');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claudemeter');
}

const CONFIG_DIR = getClaudemeterConfigDir();

const PATHS = {
    CONFIG_DIR: CONFIG_DIR,
    SESSION_DATA_FILE: path.join(CONFIG_DIR, 'session-data.json'),
};

// File-based debug logging with instance identification
// Each instance identified by short hash + project name for easy differentiation
let fileLoggerInstance = null;

// Strip the user's home directory from a log line so a shared log can't leak the
// OS username (and, by extension, absolute local paths). Best-effort PII guard,
// applied centrally to every line the file logger and diagnostic channels emit.
// Project folder names may still appear (a project-scoped tool needs them to
// diagnose "wrong project" issues) - but never the username. See SECURITY.md.
// Replace the home directory with ~ and the OS username with <user>.
//
// Both forms of the home path are replaced: JSON.stringify escapes each
// backslash, so a Windows home never matches its serialised form and a
// raw-path-only scrub leaves the username in the state dump.
//
// The username is then replaced wherever else it appears, because a home
// prefix is not the only place it shows up - WSL paths under /mnt/c/Users,
// a config dir pointed outside home, and any case-insensitive filesystem
// where the path case differs from homedir() all escape a prefix match.
function scrubHome(message) {
    if (typeof message !== 'string') return message;
    let out = message;
    const home = os.homedir();
    if (home) {
        for (const form of [home, home.split('\\').join('\\\\')]) {
            out = out.split(form).join('~');
        }
    }
    const user = currentUsername();
    // Word-bounded so a username that is also a common substring cannot
    // corrupt unrelated text: a user named "sam" must not turn "sample" into
    // "<user>ple". A path separator is a word boundary, so real paths match.
    if (user) {
        out = out.replace(new RegExp(`\\b${escapeRegExp(user)}\\b`, 'gi'), '<user>');
    }
    return out;
}

function currentUsername() {
    try {
        return os.userInfo().username || null;
    } catch {
        return null; // no passwd entry (some containers)
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
        return getDefaultDebugLogPath();
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
                // FIFO trim: keep the newest ~75% of max size. Only that tail
                // is read, so a log of any size costs at most maxSizeBytes.
                const targetSize = Math.floor(this.maxSizeBytes * 0.75);
                const tail = Buffer.alloc(targetSize);
                const fd = fs.openSync(this.logFile, 'r');
                let bytesRead;
                try {
                    bytesRead = fs.readSync(fd, tail, 0, targetSize, stats.size - targetSize);
                } finally {
                    fs.closeSync(fd);
                }
                // Drop the partial line the cut landed in.
                const kept = tail.subarray(tail.indexOf(0x0a) + 1, bytesRead);
                fs.writeFileSync(this.logFile, kept);
            }
        } catch (e) {
            // Ignore trim errors
        }
    }

    log(message) {
        if (!isDebugEnabled()) return;

        try {
            // Owner-only modes apply on create alone: debugLogFile can point at
            // an existing file whose permissions are the user's business.
            const dir = path.dirname(this.logFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }

            this.trimIfNeeded();

            const timestamp = new Date().toISOString();
            const line = `${timestamp} ${this.instanceId} ${scrubHome(message)}\n`;
            fs.appendFileSync(this.logFile, line, { mode: 0o600 });
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
//   capabilities     - live org capabilities array, when a caller has one.
//                      The OAuth /profile payload does not expose this, so it
//                      is currently always null and the resolver leans on
//                      subscriptionType + the s1m-access cache instead. Kept
//                      in the signature in case a future signal supplies it.
//   organizationType - verbatim plan token ('claude_max') from
//                      ~/.claude.json oauthAccount, when a caller has one
//   subscriptionType - subscriptionType ('max'/'pro') from the token/profile
//   creditsEnabled   - usage credits on for the org; only ever narrows a
//                      context-window rule that carries a credits caveat
//
// Signals not passed in ctx are resolved here from VS Code settings /
// ~/.claude.json etc. This design lets call sites that already have
// the live API signals pass them in for the most accurate result,
// while simpler call sites can call with just modelIds/observedFloor.
function resolveTokenLimit(ctx = {}) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const userOverride = config.get('tokenLimit', 0);

    // F5 overrides. A forced window short-circuits the chain; forced plan
    // signals feed it, so the rules can be exercised on any account.
    const simulator = require('./simulator');
    const simWindow = simulator.getContextWindow();
    if (simWindow !== null) {
        return { limit: simWindow, source: 'simulated', confidence: 'authoritative' };
    }
    const simPlan = simulator.getPlanSignals();

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
    // cost negligible) and only trusted as a corroborating signal -
    // never as a definitive negative, since we've seen it go stale
    // with hasAccess:false on accounts that were genuinely running
    // 1M context at the time.
    // Suppressed while plan signals are simulated: a real cached eligibility
    // would grant 1M and hide the simulated plan's answer.
    let s1mHasAccess = null;
    if (!simPlan) {
        try {
            const { hasMaxContextAccess } = require('./claudeConfigReader');
            s1mHasAccess = hasMaxContextAccess();
        } catch {
            s1mHasAccess = null;
        }
    }

    // Local plan fallbacks (used when live capabilities aren't
    // available - tokenOnlyMode, pre-first-fetch, offline).
    // organizationType from ~/.claude.json oauthAccount is the primary
    // local signal - on macOS .credentials.json does not exist, so the
    // legacy subscriptionType below is never readable there (#51).
    // Simulated plan signals replace the local ones outright rather than
    // merging: a real claude_max read from disk would otherwise mask the
    // Pro-without-credits case the simulator exists to reproduce.
    let organizationType = simPlan ? simPlan.organizationType : (ctx.organizationType || null);
    let subscriptionType = simPlan ? simPlan.subscriptionType : (ctx.subscriptionType || null);
    let creditsEnabled = simPlan
        ? simPlan.creditsEnabled
        : (typeof ctx.creditsEnabled === 'boolean' ? ctx.creditsEnabled : null);

    if (!simPlan) {
        if (!organizationType || creditsEnabled === null) {
            try {
                const { getOAuthAccount } = require('./claudeConfigReader');
                const account = getOAuthAccount();
                organizationType = organizationType || account?.organizationType || null;
                if (creditsEnabled === null && typeof account?.hasExtraUsageEnabled === 'boolean') {
                    creditsEnabled = account.hasExtraUsageEnabled;
                }
            } catch {
                organizationType = organizationType || null;
            }
        }
        if (!subscriptionType) {
            try {
                const { readCredentials } = require('./credentialsReader');
                subscriptionType = readCredentials()?.subscriptionType || null;
            } catch {
                subscriptionType = null;
            }
        }
    }

    return resolveContextWindow({
        userOverride,
        aliasDeclaredLimit,
        jsonlDeclaredLimit,
        capabilities: ctx.capabilities || null,
        organizationType,
        subscriptionType,
        creditsEnabled,
        s1mHasAccess,
        modelIds: ctx.modelIds || null,
        observedFloor: ctx.observedFloor || 0,
    });
}

// Back-compat wrapper that returns just the numeric limit. New callers
// that want the source/confidence metadata should use resolveTokenLimit
// directly. This wrapper is intentionally conservative - existing call
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

// Shown wherever a reset time is due but the payload carried no stamp.
const NO_RESET_TIME = '-';

const DAY_MS = 24 * 60 * 60 * 1000;

// A reset stamp (ISO string or Date) as a Date, or null when absent or invalid.
function toResetDate(resetsAt) {
    if (!resetsAt) return null;
    const date = resetsAt instanceof Date ? resetsAt : new Date(resetsAt);
    return Number.isNaN(date.getTime()) ? null : date;
}

// Time left until a reset, e.g. "2h 15m" or "5d 21h". Minutes drop once days
// show, and a reset already passed reads "0m".
function formatCountdown(resetDate) {
    const totalMinutes = Math.max(0, Math.floor((resetDate.getTime() - Date.now()) / 60000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Status-bar reset time, measured from now at every render: a countdown, a
// clock time within the day, or day plus time further out.
function calculateResetClockTime(resetsAt, timeFormat = { hour: 'numeric', minute: '2-digit' }) {
    const resetDate = toResetDate(resetsAt);
    if (!resetDate) return NO_RESET_TIME;
    if (getUseCountdownTimer()) return formatCountdown(resetDate);

    const hour12 = !getUse24HourTime();
    if (resetDate.getTime() - Date.now() >= DAY_MS) {
        const dayName = resetDate.toLocaleDateString(undefined, { weekday: 'short' });
        const timeStr = resetDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 });
        return `${dayName} ${timeStr}`;
    }
    return resetDate.toLocaleTimeString(undefined, { ...timeFormat, hour12 });
}

// "Sunday 19 April at 2:01 pm": every long-form time in a tooltip uses this,
// so the reset and happy-hour rows read alike. '' for a non-Date.
function formatLongDateTime(date, use24Hour) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
        hour12: !use24Hour,
    });
}

// Full reset datetime for tooltips.
function calculateResetClockTimeExpanded(resetsAt) {
    const resetDate = toResetDate(resetsAt);
    if (!resetDate) return NO_RESET_TIME;
    return formatLongDateTime(resetDate, getUse24HourTime());
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

// Thresholds sit just under each unit so rounding never prints "1000.0K".
function formatCompact(value) {
    if (value >= 999_950) {
        return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 999.5) {
        return `${(value / 1000).toFixed(1)}K`;
    }
    return Math.round(value).toString();
}

// The remote authority when this extension host is the client of a remote
// window, whose transcripts and Claude login live on another machine. Null when
// local, or when VS Code runs claudemeter on the remote host itself.
function clientSideRemoteName() {
    const remote = vscode.env.remoteName;
    if (!remote) return null;
    const kind = vscode.extensions.getExtension('HyperSec.claudemeter')?.extensionKind;
    return kind === vscode.ExtensionKind.Workspace ? null : remote;
}

module.exports = {
    clientSideRemoteName,
    CONFIG_NAMESPACE,
    COMMANDS,
    plural,
    PATHS,
    getTokenLimit,
    resolveTokenLimit,
    getUse24HourTime,
    setDevMode,
    isDebugEnabled,
    getDebugChannel,
    disposeDebugChannel,
    sleep,
    calculateResetClockTime,
    calculateResetClockTimeExpanded,
    formatLongDateTime,
    toResetDate,
    DAY_MS,
    getCurrencySymbol,
    formatCompact,
    initFileLogger,
    fileLog,
    scrubHome,
    getDefaultDebugLogPath,
};
