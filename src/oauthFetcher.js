// Project:   Claudemeter
// File:      oauthFetcher.js
// Purpose:   Browserless usage fetch via the Claude Code OAuth token.
// Language:  JavaScript (CommonJS)
//
// Reads the SAME OAuth access token Claude Code uses -- CLI *or* the VS
// Code extension share one credential store per config dir -- and calls
// the first-party endpoints on api.anthropic.com that back Claude Code's
// own /usage:
//
//   GET /api/oauth/usage    -> five_hour / seven_day / *_opus / *_sonnet
//                              / extra_usage / spend / limits[]
//   GET /api/oauth/profile  -> account + organization (org type, rate
//                              limit tier) + application
//
// Why this replaces the claude.ai sessionKey + Playwright login:
//   - No browser, so no Google-SSO "browser not secure" block (#49),
//     no Cloudflare, no cookie expiry, no re-login.
//   - The token IS the account the user's Claude Code is on, so the old
//     CLI-vs-web account-mismatch failure mode disappears.
//   - The claude.ai OAuth Bearer is REJECTED by claude.ai's own
//     /api/organizations/* (403 account_session_invalid); these
//     api.anthropic.com/oauth/* endpoints are the only token-auth'd
//     usage path, and the ones Claude Code depends on.
//
// Token lifecycle is NOT ours: tokenSource reads fresh every call and we
// never refresh (see tokenSource.js for why self-refresh would log the
// user out). On a 401 we re-read once -- covers a rotation that landed
// between our read and the request -- then surface NO_OAUTH_TOKEN so the
// caller can prompt `claude auth login`.
//
// vscode-free by design: `node src/oauthFetcher.js`.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const { processApiResponse } = require('./apiSchema');
const { readToken } = require('./tokenSource');

const API_BASE = 'https://api.anthropic.com';
const USAGE_URL = `${API_BASE}/api/oauth/usage`;
const PROFILE_URL = `${API_BASE}/api/oauth/profile`;

// The oauth beta flag gates Bearer access to /api/oauth/*; version is the
// standard API pin. UA identifies us honestly rather than spoofing Chrome.
const OAUTH_HEADERS = {
    'anthropic-beta': 'oauth-2025-04-20',
    'anthropic-version': '2023-06-01',
    Accept: 'application/json',
    'User-Agent': 'claudemeter (oauth-usage)',
};

// Total-request timeout. These are two quick first-party GETs; without a
// bound a hung socket would spin the status-bar spinner for minutes (undici
// has no default overall timeout).
const FETCH_TIMEOUT_MS = 15000;

async function getJson(url, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(url, {
            method: 'GET',
            headers: { ...OAUTH_HEADERS, Authorization: `Bearer ${token}` },
            // These endpoints never 3xx. A redirect on a Bearer-bearing request
            // is anomalous -- fail loudly rather than follow it anywhere.
            redirect: 'error',
            signal: controller.signal,
        });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('FETCH_TIMEOUT');
        throw e; // network / redirect error -- not an auth failure
    } finally {
        clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) {
        const err = new Error('TOKEN_REJECTED');
        err.status = res.status;
        throw err;
    }
    if (!res.ok) {
        throw new Error(`API_ERROR_${res.status}`);
    }
    return res.json();
}

// Map /api/oauth/profile into claudemeter's accountInfo shape. The org
// object carries the authoritative tier signals the profile-based
// threshold system wants -- no more org-name-regex guessing.
function mapAccountInfo(profile) {
    const acc = profile?.account || {};
    const org = profile?.organization || {};
    return {
        name: acc.display_name || acc.full_name || null,
        email: acc.email || null,
        orgName: org.name || null,
        // Raw first-party tier signals (feed profileSelector directly).
        organizationType: org.organization_type || null, // e.g. 'claude_max'
        rateLimitTier: org.rate_limit_tier || null, // e.g. 'default_claude_max_20x'
        // Normalise the plan flags to the 'max'/'pro' vocabulary the context
        // -window resolver and profileSelector expect.
        subscriptionType: acc.has_claude_max ? 'max' : (acc.has_claude_pro ? 'pro' : null),
        subscriptionStatus: org.subscription_status || null,
        billingType: org.billing_type || null,
        hasClaudeMax: !!acc.has_claude_max,
        hasClaudePro: !!acc.has_claude_pro,
    };
}

// The OAuth usage payload keeps credit/spend inline rather than in the two
// separate claude.ai endpoints. Adapt them to the shapes processApiResponse
// expects. Best-effort -- spend is disabled for most subscription accounts,
// so these commonly resolve to null downstream.
function deriveCreditsArgs(usage) {
    const spend = usage?.spend || null;
    const extra = usage?.extra_usage || null;

    const creditsData = spend && spend.balance != null
        ? { remaining_credits: spend.balance.amount_minor, currency: spend.balance.currency }
        : null;

    const overageData = extra && extra.is_enabled
        ? {
            is_enabled: true,
            monthly_credit_limit: extra.monthly_limit,
            used_credits: extra.used_credits,
            currency: extra.currency || 'USD',
            out_of_credits: extra.utilization != null && extra.utilization >= 100,
        }
        : null;

    return { creditsData, overageData };
}

// Fetch usage + profile with a given token, mapped into the status-bar shape.
// Usage is CRITICAL (drives the gauges) -- its rejection propagates so a 401
// triggers the caller's rotation re-read. Profile is SECONDARY (identity +
// tier enrichment): if it fails (403 on some org types, a timeout, ...) we
// degrade to null accountInfo rather than sinking a perfectly good usage
// fetch and falsely prompting the user to log in.
async function fetchWithToken(tok) {
    const [usageR, profileR] = await Promise.allSettled([
        getJson(USAGE_URL, tok.token),
        getJson(PROFILE_URL, tok.token),
    ]);
    if (usageR.status === 'rejected') throw usageR.reason;
    const usage = usageR.value;
    const profile = profileR.status === 'fulfilled' ? profileR.value : null;

    const accountInfo = profile ? mapAccountInfo(profile) : null;
    const { creditsData, overageData } = deriveCreditsArgs(usage);

    // usage already uses five_hour/seven_day/seven_day_opus/seven_day_sonnet/
    // extra_usage field names -> feeds USAGE_API_SCHEMA verbatim.
    const result = processApiResponse(usage, creditsData, overageData, accountInfo);
    result.tokenMeta = {
        source: tok.source,
        expiresAt: tok.expiresAt,
        scopes: tok.scopes,
    };
    result.limits = usage.limits || null; // normalised {kind,group,percent,...}
    return result;
}

// End-to-end. Throws typed errors the caller maps to UX:
//   NO_OAUTH_TOKEN  - nothing usable in the store (prompt `claude auth login`)
//   AUTH_OVERRIDE   - user is on API key / Bedrock / Vertex (no sub usage)
//   TOKEN_REJECTED  - a valid-looking token the server refused twice
async function fetchUsageData() {
    let tok = readToken();
    if (!tok.ok) {
        const err = new Error(tok.reason === 'ENV_OVERRIDE' ? 'AUTH_OVERRIDE' : 'NO_OAUTH_TOKEN');
        err.detail = tok.detail;
        throw err;
    }

    try {
        return await fetchWithToken(tok);
    } catch (e) {
        if (e.message !== 'TOKEN_REJECTED') throw e;
        // The token was refused. Claude Code may have just rotated it -- read
        // fresh ONCE (bypassing the Keychain TTL cache) and retry with
        // whatever is in the store now.
        const fresh = readToken({ fresh: true });
        if (fresh.ok && fresh.token !== tok.token) {
            return fetchWithToken(fresh);
        }
        // Same token still refused (or none left): genuinely stale. The user
        // hasn't run Claude Code for the token's lifetime -> re-auth needed.
        const err = new Error('NO_OAUTH_TOKEN');
        err.detail = 'token rejected';
        throw err;
    }
}

module.exports = {
    fetchUsageData,
    fetchWithToken,
    mapAccountInfo,
    deriveCreditsArgs,
    USAGE_URL,
    PROFILE_URL,
};

// Standalone smoke test: `node src/oauthFetcher.js`. Redacts identity.
if (require.main === module) {
    (async () => {
        try {
            const r = await fetchUsageData();
            const redacted = {
                ...r,
                accountInfo: {
                    ...r.accountInfo,
                    name: r.accountInfo.name ? '<name>' : null,
                    email: r.accountInfo.email ? '<redacted>' : null,
                    orgName: r.accountInfo.orgName ? '<org>' : null,
                },
                rawData: '<omitted>',
            };
            console.log(JSON.stringify(redacted, null, 2));
        } catch (e) {
            console.error('FAILED:', e.message, e.detail ? `(${e.detail})` : '');
            process.exit(1);
        }
    })();
}
