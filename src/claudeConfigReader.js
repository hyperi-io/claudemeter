// Project:   Claudemeter
// File:      claudeConfigReader.js
// Purpose:   Read ~/.claude.json and ~/.claude/sessions/*.json for account identity,
//            1M context eligibility, and live Claude Code session mapping.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Claude Code no longer writes organizationUuid, subscriptionType, or rateLimitTier
// to ~/.claude/.credentials.json — those fields are now null in the new format.
// The authoritative account identity lives in ~/.claude.json under oauthAccount,
// and extended-context eligibility lives under s1mAccessCache keyed by org UUID.
//
// This module isolates all reads of Claude Code's own state so the rest of
// claudemeter has a single, well-typed view of "who is Claude Code logged in as
// right now, and what is that account entitled to?".

const fs = require('fs');
const path = require('path');
const os = require('os');

// Home directory is resolved per-call (not at module load) so tests can
// override it via the CLAUDE_CONFIG_HOME env var without re-importing.
function getHomeDir() {
    return process.env.CLAUDE_CONFIG_HOME || os.homedir();
}

function getClaudeConfigPath() {
    return path.join(getHomeDir(), '.claude.json');
}

function getClaudeSessionsDir() {
    return path.join(getHomeDir(), '.claude', 'sessions');
}

// Back-compat constants — snapshot at module load, still useful for callers
// that don't override CLAUDE_CONFIG_HOME. Prefer the getters above in new code.
const CLAUDE_CONFIG_PATH = path.join(os.homedir(), '.claude.json');
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

// Read and parse ~/.claude.json.
// Returns null on any read/parse error — callers must handle the null case.
function readClaudeConfig() {
    try {
        const configPath = getClaudeConfigPath();
        if (!fs.existsSync(configPath)) {
            return null;
        }
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        return null;
    }
}

// Return the identity of the currently logged-in Claude Code account, or null.
// Shape:
//   {
//     accountUuid,       // stable per-Anthropic-account (primary key)
//     organizationUuid,  // stable per-org (including personal orgs)
//     emailAddress,
//     displayName,
//     organizationName,
//     organizationRole,
//     billingType,
//     hasAvailableSubscription,
//     hasOpusPlanDefault,
//   }
function getOAuthAccount() {
    const config = readClaudeConfig();
    if (!config) return null;

    const oauth = config.oauthAccount;
    if (!oauth || typeof oauth !== 'object') return null;

    return {
        accountUuid: oauth.accountUuid || null,
        organizationUuid: oauth.organizationUuid || null,
        emailAddress: oauth.emailAddress || null,
        displayName: oauth.displayName || null,
        organizationName: oauth.organizationName || null,
        organizationRole: oauth.organizationRole || null,
        billingType: oauth.billingType || null,
        hasAvailableSubscription: config.hasAvailableSubscription === true,
        hasOpusPlanDefault: config.hasOpusPlanDefault === true,
    };
}

// Check whether the currently logged-in org has 1M ("s1m") context access
// according to Claude Code's own eligibility cache.
// Returns:
//   true  — eligible (hasAccess === true)
//   false — known-ineligible (hasAccess === false)
//   null  — unknown (no cache entry for this org, or file missing)
//
// Claude Code refreshes this cache during its own eligibility checks, so
// the value reflects Anthropic's current decision at the moment Claude Code
// last checked. Callers should treat null as "no signal" and fall back to
// other detection paths.
function hasMaxContextAccess() {
    const config = readClaudeConfig();
    if (!config) return null;

    const oauth = config.oauthAccount;
    const orgUuid = oauth?.organizationUuid;
    if (!orgUuid) return null;

    const cache = config.s1mAccessCache;
    if (!cache || typeof cache !== 'object') return null;

    const entry = cache[orgUuid];
    if (!entry || typeof entry !== 'object') return null;

    return entry.hasAccess === true;
}

// Read ~/.claude/sessions/*.json — each file represents one live Claude Code
// process and contains {pid, sessionId, cwd, startedAt, kind, entrypoint}.
// Returns an array of session records, possibly empty.
//
// Stale files (process no longer running) are returned as-is; callers can
// filter by startedAt if needed. We deliberately do NOT check PID liveness
// here to keep this function side-effect-free and fast.
function getLiveSessions() {
    try {
        const sessionsDir = getClaudeSessionsDir();
        if (!fs.existsSync(sessionsDir)) return [];
        const files = fs.readdirSync(sessionsDir)
            .filter(name => name.endsWith('.json'));

        const sessions = [];
        for (const name of files) {
            try {
                const full = path.join(sessionsDir, name);
                const raw = fs.readFileSync(full, 'utf-8');
                const data = JSON.parse(raw);
                if (data && data.sessionId && data.cwd) {
                    sessions.push(data);
                }
            } catch {
                continue;
            }
        }
        return sessions;
    } catch {
        return [];
    }
}

// Find the live Claude Code session whose cwd matches the given workspace
// path. When multiple sessions share a cwd (rare — two Claude Code processes
// in the same workspace), returns the most recently started one.
// Returns null if no match.
function findSessionForWorkspace(workspacePath) {
    if (!workspacePath) return null;
    const sessions = getLiveSessions()
        .filter(s => s.cwd === workspacePath)
        .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    return sessions[0] || null;
}

// Return the mtime of ~/.claude.json in milliseconds, or 0 if unreadable.
// Used by the multi-instance coordination layer to detect external account
// changes without parsing the whole file on every fetch.
function getClaudeConfigMtime() {
    try {
        const stat = fs.statSync(getClaudeConfigPath());
        return stat.mtimeMs;
    } catch {
        return 0;
    }
}

module.exports = {
    CLAUDE_CONFIG_PATH,
    CLAUDE_SESSIONS_DIR,
    getClaudeConfigPath,
    getClaudeSessionsDir,
    readClaudeConfig,
    getOAuthAccount,
    hasMaxContextAccess,
    getLiveSessions,
    findSessionForWorkspace,
    getClaudeConfigMtime,
};
