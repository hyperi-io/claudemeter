// Project:   Claudemeter
// File:      contextWindowResolver.js
// Purpose:   Resolve the token limit for the current Claude Code
//            session, using a priority chain of signals and
//            returning {limit, source, confidence} so the UI can
//            display an honest source label.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Why a priority chain and not a Math.max over the signals:
//
// `observedFloor` is a LOWER BOUND - it says "the limit is at least X", not
// what the limit IS. Maximising over it lets it become the answer whenever
// every other signal is absent, which is the normal state for a Max Personal
// account whose VS Code setting is `"default"`, whose JSONL model suffix
// Claude Code has stripped, and whose s1mAccessCache is stale. The reported
// limit then ratchets upward with usage and the gauge pins at ~100% forever.
//
// So the signals are strictly ordered instead. Each step either returns a
// concrete {limit, source, confidence} or falls through, `observedFloor` is
// consulted ONLY as the final fallback, and when it is the result is snapped
// to the next known tier (200K -> 1M -> 2M) rather than returned raw. That
// result is always labelled `inferred` so the UI can say so.
//
// Why the rule table keys on the model, not the plan:
//
// The window is a property of the model and the surface, not of the plan -
// support.claude.com article 8606394 lists Sonnet 5, Fable 5 and Opus 4.6
// through 5 at 1M on Pro, Max, Team and Enterprise alike. Keying on a plan
// token loses the window wherever the plan cannot be read (no
// .credentials.json on macOS, no oauthAccount on older builds, no live fetch in
// tokenOnlyMode), leaving the session at 200K until `observedFloor` snaps it up
// mid-conversation (#55).
//
// The plan is consulted only for the two credit caveats Anthropic applies: Pro
// needs usage credits for 1M on Opus, and Sonnet 4.6 needs them on every paid
// plan bar usage-based Enterprise. `creditsRequiredPlans` expresses these, and
// withholds a rule only when the plan is known to be one of them AND credits
// are known to be off. An unknown plan or unknown credit state grants the
// window.
//
// Plan detection:
//
// In practice the plan comes from LOCAL signals: `organizationType` from
// ~/.claude.json oauthAccount (current builds write the capability token
// verbatim, e.g. "claude_max" - the only local signal on macOS, where
// .credentials.json does not exist, #51), then the legacy `subscriptionType`
// field from ~/.claude/.credentials.json for older builds. `capabilities` is
// the same vocabulary from a live endpoint; nothing supplies one today.

const STANDARD_LIMIT = 200000;

// Known context window tiers in ascending order. The snap-to-tier
// fallback uses these as the set of valid result values. When
// Anthropic ships a new tier (e.g. 5M on some plan), add it here
// AND add a matching rule to CONTEXT_WINDOW_RULES below.
const KNOWN_CONTEXT_TIERS = [200000, 1000000, 2000000];

// Rule table mapping (model family, model version) -> default context window,
// with `creditsRequiredPlans` naming the plans that reach it only with usage
// credits enabled. First match wins, so a narrower rule must precede the wider
// one it overlaps. Each rule encodes a product fact from Anthropic's defaults;
// sources should cite the release announcement or observed behaviour.
//
// Future-proofing:
//   - `minVersion` uses a numeric >= comparison so new point releases
//     (Opus 4.7, 5.0, ...) automatically qualify without code changes.
//   - Adding a new family or limit is one new rule entry.
//   - Removing a rule (if Anthropic reverts a default) is one deletion.
//
// What this CANNOT handle: rules not shaped as (family, version, limit) plus a
// plan-and-credits caveat. E.g. "2M on Opus but only during business hours"
// would require a code change.
const CONTEXT_WINDOW_RULES = [
    // 1M on current-generation Opus (4.6 and later) on every paid plan. Pro
    // reaches it only with usage credits enabled; Max, Team and Enterprise get
    // it automatically. Source: support.claude.com 8606394.
    {
        family: 'opus',
        minVersion: 4.6,
        limit: 1_000_000,
        creditsRequiredPlans: ['claude_pro'],
        source: 'rule:opus-4.6+',
    },
    // 1M on Sonnet 5+ on every paid plan, no credits condition. Listed ahead of
    // the Sonnet 4.6 rule below, which carries one.
    {
        family: 'sonnet',
        minVersion: 5,
        limit: 1_000_000,
        source: 'rule:sonnet-5+',
    },
    // 1M on Fable 5+ on every paid plan. Source: Fable 5 launch 9 Jun 2026,
    // support.claude.com 8606394.
    {
        family: 'fable',
        minVersion: 5,
        limit: 1_000_000,
        source: 'rule:fable-5+',
    },
    // Sonnet 4.6 reaches 1M on every paid plan, but only with usage credits
    // enabled - except on usage-based Enterprise, which claudemeter cannot
    // distinguish from seat-based Enterprise, so Enterprise is left off the
    // credits list and always granted.
    {
        family: 'sonnet',
        minVersion: 4.6,
        limit: 1_000_000,
        creditsRequiredPlans: ['claude_pro', 'claude_max', 'claude_team'],
        source: 'rule:sonnet-4.6+',
    },
    // Deliberately no rule for Haiku: Anthropic has never offered extended
    // context on it. Falls through to STANDARD_LIMIT.
];

// Snap an observed-token count to the smallest known tier that
// is >= the value. Used only when observedFloor is the active
// signal; never used when an authoritative or configured signal
// has already produced a value.
//
//   0       -> 200K (standard)
//   199999  -> 200K
//   200000  -> 200K
//   200001  -> 1M   (jumped a tier)
//   999999  -> 1M
//   1000000 -> 1M
//   1000001 -> 2M
//   3000000 -> 2M   (saturates at the highest known tier)
//
// Defensive for NaN/negative: falls through to STANDARD_LIMIT.
function snapToNextKnownTier(observed) {
    if (typeof observed !== 'number' || !Number.isFinite(observed) || observed <= STANDARD_LIMIT) {
        return STANDARD_LIMIT;
    }
    for (const tier of KNOWN_CONTEXT_TIERS) {
        if (observed <= tier) return tier;
    }
    return KNOWN_CONTEXT_TIERS[KNOWN_CONTEXT_TIERS.length - 1];
}

// Parse a model ID into family + numeric version so the rule
// table's minVersion comparison is numeric (so 4.7, 5.0, 5.1
// all satisfy `>= 4.6` automatically).
//
// Accepts: "claude-opus-4-6", "claude-opus-4-6-20260301",
//          "claude-opus-4-6[1m]", "claude-opus-4-6-20260301[1m]"
// Returns: {family, version} or null
function parseFamilyAndVersion(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;
    // Strip any [Nm]/[Nk] suffix before matching.
    const stripped = modelId.replace(/\[\d+[mk]\]$/, '');
    // minor OPTIONAL for every family. claude-fable-5 -> 5.0, opus-4-6 -> 4.6.
    // (?!\d) keeps a trailing date out of the minor.
    const match = stripped.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/);
    if (!match) return null;
    return {
        family: match[1],
        version: match[3] ? parseFloat(`${match[2]}.${match[3]}`) : parseFloat(match[2]),
    };
}

// Find the first rule in CONTEXT_WINDOW_RULES whose (family, minVersion)
// matches one of the caller's detected model IDs and whose credits caveat is
// not blocking. Returns {limit, source} on match, or null otherwise.
//
// Parameters:
//   modelIds       - array of model IDs from JSONL scan (Claude Code strips
//                    [Nm] suffixes so these are usually bare, e.g.
//                    ['claude-opus-4-6', 'claude-sonnet-4-6']).
//   planTokens     - capability tokens for the account ('claude_max',
//                    'claude_pro', ...). Empty or unknown tokens simply mean
//                    no credits caveat can apply.
//   creditsEnabled - true / false / null when unknown. Only an explicit false
//                    can withhold a rule.
function matchRuleTable(modelIds, { planTokens = [], creditsEnabled = null } = {}) {
    if (!Array.isArray(modelIds) || modelIds.length === 0) return null;

    const parsed = modelIds
        .map(parseFamilyAndVersion)
        .filter(Boolean);
    if (parsed.length === 0) return null;

    const plans = Array.isArray(planTokens) ? planTokens : [];

    for (const rule of CONTEXT_WINDOW_RULES) {
        const modelMatch = parsed.some(
            m => m.family === rule.family && m.version >= rule.minVersion
        );
        if (!modelMatch) continue;
        if (creditsEnabled === false && Array.isArray(rule.creditsRequiredPlans)
            && plans.some(p => rule.creditsRequiredPlans.includes(p))) {
            continue;
        }
        return { limit: rule.limit, source: rule.source };
    }

    return null;
}

// Synthesise a capability token from a local subscriptionType string
// when the live /api/bootstrap capabilities aren't available. Keeps
// the rule table as the single source of truth for plan matching.
//
//   "max"        -> "claude_max"
//   "pro"        -> "claude_pro"
//   "team"       -> "claude_team"
//   "enterprise" -> "claude_enterprise"
//   "free"       -> null (no claude_* token for free)
//   null         -> null
function subscriptionTypeToCapability(subscriptionType) {
    if (!subscriptionType || typeof subscriptionType !== 'string') return null;
    const norm = subscriptionType.toLowerCase();
    if (norm === 'free') return null;
    if (['max', 'pro', 'team', 'enterprise'].includes(norm)) {
        return `claude_${norm}`;
    }
    return null;
}

// The resolver. Priority order (first match wins):
//
//   1. userOverride           -> authoritative
//   2. aliasDeclaredLimit     -> authoritative (explicit [1m] alias)
//   3. jsonlDeclaredLimit     -> authoritative (model ID with suffix)
//   4. rule table             -> inferred (modelIds, plan + credits as caveat)
//   5. s1mHasAccess === true  -> configured (Claude Code's own cache)
//   6. observedFloor snap     -> inferred (fallback with explicit label)
//   7. STANDARD_LIMIT         -> unknown
//
// Input:
//   userOverride       - from claudemeter.tokenLimit setting; 0 = none
//   aliasDeclaredLimit - from parseModelAlias(claudeCode.selectedModel); 0 = none
//   jsonlDeclaredLimit - from getHighestDeclaredLimit(modelIds); 0 = none
//   capabilities       - live org capabilities array; always null today
//   organizationType   - local ~/.claude.json oauthAccount.organizationType,
//                        a verbatim capability token ("claude_max"); null if unavailable
//   subscriptionType   - local .credentials.json subscriptionType (legacy builds); null if unavailable
//   creditsEnabled     - usage credits (extra usage) on for the org; bool or
//                        null when unknown
//   s1mHasAccess       - Claude Code's s1mAccessCache[org].hasAccess; bool or null
//   modelIds           - JSONL model IDs detected in the active session
//   observedFloor      - max cache_read_input_tokens observed in session
//
// Output: {limit, source, confidence}
function resolveContextWindow(input = {}) {
    const {
        userOverride = 0,
        aliasDeclaredLimit = 0,
        jsonlDeclaredLimit = 0,
        capabilities = null,
        organizationType = null,
        subscriptionType = null,
        creditsEnabled = null,
        s1mHasAccess = null,
        modelIds = null,
        observedFloor = 0,
    } = input;

    // 1. User override beats everything
    if (userOverride > 0) {
        return {
            limit: userOverride,
            source: 'user-override',
            confidence: 'authoritative',
        };
    }

    // 2. Explicit [1m]-style alias in VS Code settings
    if (aliasDeclaredLimit > 0) {
        return {
            limit: aliasDeclaredLimit,
            source: 'cc-alias',
            confidence: 'authoritative',
        };
    }

    // 3. JSONL model ID with an explicit suffix (rare in practice -
    // Claude Code strips these - but still authoritative when present)
    if (jsonlDeclaredLimit > 0) {
        return {
            limit: jsonlDeclaredLimit,
            source: 'jsonl-suffix',
            confidence: 'authoritative',
        };
    }

    // 4. Rule table match on the session's model. The plan tokens are
    // gathered from every source that has one - live capabilities, then
    // oauthAccount.organizationType (the only local signal on macOS, #51),
    // then the legacy subscriptionType of older builds - and are used solely
    // to evaluate a rule's credits caveat.
    const planTokens = [];
    if (Array.isArray(capabilities)) {
        planTokens.push(...capabilities.filter(c => typeof c === 'string'));
    }
    if (organizationType && typeof organizationType === 'string'
        && !planTokens.includes(organizationType)) {
        planTokens.push(organizationType);
    }
    const legacyCap = subscriptionTypeToCapability(subscriptionType);
    if (legacyCap && !planTokens.includes(legacyCap)) {
        planTokens.push(legacyCap);
    }

    const rule = matchRuleTable(modelIds, { planTokens, creditsEnabled });
    if (rule) {
        return {
            limit: rule.limit,
            source: rule.source,
            confidence: 'inferred',
        };
    }

    // 5. Claude Code's own eligibility cache corroborates extended
    // context. Only fires when the rule table did not match, so it
    // serves as a last-resort "configured" signal rather than a
    // primary source.
    if (s1mHasAccess === true) {
        return {
            limit: 1_000_000,
            source: 'cc-eligibility',
            confidence: 'configured',
        };
    }

    // 6. observed-floor fallback: snap to the next known tier so
    // the "limit" is always a plausible Anthropic context size,
    // never a raw mid-tier value. Labelled `inferred` so the
    // tooltip can say so.
    if (typeof observedFloor === 'number' && observedFloor > STANDARD_LIMIT) {
        return {
            limit: snapToNextKnownTier(observedFloor),
            source: 'observed-snap',
            confidence: 'inferred',
        };
    }

    // 7. Nothing to go on - default to standard.
    return {
        limit: STANDARD_LIMIT,
        source: 'standard',
        confidence: 'unknown',
    };
}

module.exports = {
    STANDARD_LIMIT,
    KNOWN_CONTEXT_TIERS,
    CONTEXT_WINDOW_RULES,
    snapToNextKnownTier,
    parseFamilyAndVersion,
    matchRuleTable,
    subscriptionTypeToCapability,
    resolveContextWindow,
};
