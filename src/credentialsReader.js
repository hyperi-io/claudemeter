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

const { getOAuthAccount } = require('./claudeConfigReader');
const { credentialsFilePath, readCredentialsFile, oauthBlob } = require('./tokenSource');

// Return a unified view of the current Claude Code account.
//
// Identity comes from ~/.claude.json oauthAccount. Token presence and
// subscriptionType come from .credentials.json, which older builds still fill
// and newer ones leave null. Plan fields fall back to oauthAccount (#51).
//
// Returns null if BOTH files are missing or unreadable. Returns a partial
// object (with some null fields) if only one source is available, so callers
// can still function with degraded information.
function readCredentials() {
    const oauthAccount = getOAuthAccount();
    const raw = readCredentialsFile();

    if (!oauthAccount && !raw) {
        return null;
    }

    const oauth = oauthBlob(raw) || {};

    return {
        // Identity - prefer .claude.json (new), fall back to .credentials.json (legacy)
        orgId: oauthAccount?.organizationUuid || raw?.organizationUuid || null,
        accountUuid: oauthAccount?.accountUuid || null,
        email: oauthAccount?.emailAddress || null,
        displayName: oauthAccount?.displayName || null,
        organizationName: oauthAccount?.organizationName || null,
        organizationRole: oauthAccount?.organizationRole || null,
        billingType: oauthAccount?.billingType || null,
        hasAvailableSubscription: oauthAccount?.hasAvailableSubscription === true,

        // Plan details. subscriptionType only ever lived in
        // .credentials.json, which does not exist on macOS (tokens are in
        // the Keychain) - may be null there. organizationType is the
        // current builds' verbatim plan token ("claude_max") from
        // ~/.claude.json, and organizationRateLimitTier there has the same
        // verbatim shape as the legacy rateLimitTier, so it serves as the
        // fallback (#51).
        subscriptionType: oauth.subscriptionType || null,
        organizationType: oauthAccount?.organizationType || null,
        rateLimitTier: oauth.rateLimitTier || oauthAccount?.organizationRateLimitTier || null,

        // Presence only: this object outlives the call and readToken() supplies values.
        hasAccessToken: !!oauth.accessToken,
        hasRefreshToken: !!oauth.refreshToken,
    };
}

// Build a stable identity tuple used for account-switch detection.
// Prioritised: accountUuid (primary, most stable) > email > orgId.
// Any of these changing between two readings means the account switched.
//
// Returns null if the credentials object has no usable identity signals -
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
// Uses OR semantics - any of the three fields differing is a switch.
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
    // "max" -> "Max", "pro" -> "Pro", "free" -> "Free"
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

function formatRateLimitTier(tier) {
    if (!tier) return null;
    // "default_claude_max_20x" -> "Max 20x"
    // "default_claude_pro" -> "Pro"
    const match = tier.match(/default_claude_(\w+?)(?:_(\d+x))?$/);
    if (match) {
        const plan = match[1].charAt(0).toUpperCase() + match[1].slice(1);
        return match[2] ? `${plan} ${match[2]}` : plan;
    }
    return tier;
}

module.exports = {
    getCredentialsPath: credentialsFilePath,
    readCredentials,
    getIdentityKey,
    identityChanged,
    formatSubscriptionType,
    formatRateLimitTier,
};
