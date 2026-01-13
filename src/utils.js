// Project:   Claudemeter
// File:      utils.js
// Purpose:   Shared constants and utility functions
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

const vscode = require('vscode');
const path = require('path');
const os = require('os');

const CONFIG_NAMESPACE = 'claudemeter';

// Command IDs (must match package.json contributes.commands)
const COMMANDS = {
    FETCH_NOW: 'claudemeter.fetchNow',
    OPEN_SETTINGS: 'claudemeter.openSettings',
    START_SESSION: 'claudemeter.startNewSession',
    SHOW_DEBUG: 'claudemeter.showDebug',
    RESET_CONNECTION: 'claudemeter.resetConnection',
    CLEAR_SESSION: 'claudemeter.clearSession',
    OPEN_BROWSER: 'claudemeter.openBrowser'
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
    BROWSER_SESSION_DIR: path.join(CONFIG_DIR, 'browser-session'),
    SESSION_DATA_FILE: path.join(CONFIG_DIR, 'session-data.json'),
    USAGE_HISTORY_FILE: path.join(CONFIG_DIR, 'usage-history.json')
};

// Claude Code default context window (tokens)
const DEFAULT_TOKEN_LIMIT = 200000;

// Timeouts in milliseconds
const TIMEOUTS = {
    PAGE_LOAD: 30000,
    LOGIN_WAIT: 300000,
    LOGIN_POLL: 2000,
    API_RETRY_DELAY: 2000,
    SESSION_DURATION: 3600000
};

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

function getTokenLimit() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return config.get('tokenLimit', DEFAULT_TOKEN_LIMIT);
}

// Parse relative time string (e.g. "2h 30m", "5d 21h") and calculate reset datetime
function calculateResetClockTime(resetTime, timeFormat = { hour: 'numeric', minute: '2-digit' }) {
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

        const timeStr = resetDate.toLocaleTimeString(undefined, timeFormat);

        if (totalMinutes >= 24 * 60) {
            const dayName = resetDate.toLocaleDateString(undefined, { weekday: 'short' });
            return `${dayName} ${timeStr}`;
        }

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
            minute: '2-digit'
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

module.exports = {
    CONFIG_NAMESPACE,
    COMMANDS,
    PATHS,
    DEFAULT_TOKEN_LIMIT,
    TIMEOUTS,
    VIEWPORT,
    CLAUDE_URLS,
    getTokenLimit,
    setDevMode,
    isDebugEnabled,
    getDebugChannel,
    disposeDebugChannel,
    sleep,
    calculateResetClockTime,
    calculateResetClockTimeExpanded,
    getCurrencySymbol,
    formatCompact
};
