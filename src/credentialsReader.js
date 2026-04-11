// Project:   Claudemeter
// File:      credentialsReader.js
// Purpose:   Read Claude Code credentials and unified account identity
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Claude Code stopped writing organizationUuid / subscriptionType / rateLimitTier
// to ~/.claude/.credentials.json in late 2025. The file now contains only the
// OAuth tokens and scopes. Account identity (organizationUuid, emailAddress,
// accountUuid, displayName, organizationRole) now lives in ~/.claude.json under
// oauthAccount.
//
// This module merges both sources into one unified view so the rest of
// claudemeter sees a stable shape regardless of which file carries which field.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getOAuthAccount } = require('./claudeConfigReader');

// Home directory is resolved per-call (not at module load) so tests can
// override it via the CLAUDE_CONFIG_HOME env var without re-importing.
function getHomeDir() {
    return process.env.CLAUDE_CONFIG_HOME || os.homedir();
}

function getCredentialsPath() {
    return path.join(getHomeDir(), '.claude', '.credentials.json');
}

// Back-compat constant — snapshot at module load, still used by callers that
// don't override CLAUDE_CONFIG_HOME. Prefer getCredentialsPath() in new code.
const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

// Read the raw .credentials.json oauth blob. Returns null if missing/unreadable.
function readCredentialsRaw() {
    try {
        const credentialsPath = getCredentialsPath();
        if (!fs.existsSync(credentialsPath)) {
            return null;
        }
        const raw = fs.readFileSync(credentialsPath, 'utf-8');
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : null;
    } catch (error) {
        console.warn('Claudemeter: Failed to read credentials:', error.message);
        return null;
    }
}

// Return a unified view of the current Claude Code account.
//
// Identity fields (orgId, email, accountUuid, displayName, organizationName,
// organizationRole) come from ~/.claude.json oauthAccount (the new source of
// truth). Token fields (accessToken, refreshToken, subscriptionType,
// rateLimitTier) come from .credentials.json for backwards compatibility —
// older Claude Code builds still populate them there, newer builds leave
// them null.
//
// Returns null if BOTH files are missing or unreadable. Returns a partial
// object (with some null fields) if only one source is available, so callers
// can still function with degraded information.
function readCredentials() {
    const oauthAccount = getOAuthAccount();
    const raw = readCredentialsRaw();

    if (!oauthAccount && !raw) {
        return null;
    }

    const oauth = (raw && raw.claudeAiOauth) || {};

    return {
        // Identity — prefer .claude.json (new), fall back to .credentials.json (legacy)
        orgId: oauthAccount?.organizationUuid || raw?.organizationUuid || null,
        accountUuid: oauthAccount?.accountUuid || null,
        email: oauthAccount?.emailAddress || null,
        displayName: oauthAccount?.displayName || null,
        organizationName: oauthAccount?.organizationName || null,
        organizationRole: oauthAccount?.organizationRole || null,
        billingType: oauthAccount?.billingType || null,
        hasAvailableSubscription: oauthAccount?.hasAvailableSubscription === true,

        // Plan details — only .credentials.json ever had these, may now be null
        subscriptionType: oauth.subscriptionType || null,
        rateLimitTier: oauth.rateLimitTier || null,

        // OAuth tokens — only .credentials.json has these
        accessToken: oauth.accessToken || null,
        refreshToken: oauth.refreshToken || null,
    };
}

// Build a stable identity tuple used for account-switch detection.
// Prioritised: accountUuid (primary, most stable) > email > orgId.
// Any of these changing between two readings means the account switched.
//
// Returns null if the credentials object has no usable identity signals —
// callers should treat that as "no switch detectable" rather than a switch.
function getIdentityKey(credentials) {
    if (!credentials) return null;
    const { accountUuid, email, orgId } = credentials;
    if (!accountUuid && !email && !orgId) return null;
    return {
        accountUuid: accountUuid || null,
        email: email || null,
        orgId: orgId || null,
    };
}

// Compare two identity keys and return true if they represent different accounts.
// Uses OR semantics — any of the three fields differing is a switch.
// A null previous or null current returns false (no switch detectable).
function identityChanged(previousKey, currentKey) {
    if (!previousKey || !currentKey) return false;
    return (
        previousKey.accountUuid !== currentKey.accountUuid ||
        previousKey.email !== currentKey.email ||
        previousKey.orgId !== currentKey.orgId
    );
}

function formatSubscriptionType(type) {
    if (!type) return null;
    // "max" → "Max", "pro" → "Pro", "free" → "Free"
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

function formatRateLimitTier(tier) {
    if (!tier) return null;
    // "default_claude_max_20x" → "Max 20x"
    // "default_claude_pro" → "Pro"
    const match = tier.match(/default_claude_(\w+?)(?:_(\d+x))?$/);
    if (match) {
        const plan = match[1].charAt(0).toUpperCase() + match[1].slice(1);
        return match[2] ? `${plan} ${match[2]}` : plan;
    }
    return tier;
}

module.exports = {
    CREDENTIALS_PATH,
    getCredentialsPath,
    readCredentials,
    readCredentialsRaw,
    getIdentityKey,
    identityChanged,
    formatSubscriptionType,
    formatRateLimitTier,
};
