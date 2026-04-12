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
// Background (the 2026-04 ratchet bug):
//
// The prior implementation in modelContextWindows.resolveSessionContextWindow
// took the Math.max across user override, alias-declared limit,
// JSONL-declared limit, eligibility limit from s1mAccessCache, and
// `observedFloor` (set to maxObservedTokens when observed > 200K).
//
// The problem was that observedFloor is a LOWER BOUND — it tells
// you "the limit is at least X" — but the old code treated it as
// a definitive limit. For accounts where every other positive
// signal was 0 (e.g. Max Personal users whose VS Code setting is
// `"default"`, whose JSONL model suffix has been stripped by
// Claude Code, and whose s1mAccessCache is stale), the observed
// value became the stored limit. As usage grew, the "limit"
// ratcheted up with it, producing a permanent ~100% Tk% display.
//
// The new resolver uses a strictly ordered priority chain. Each
// step either returns a concrete {limit, source, confidence} or
// falls through. `observedFloor` is ONLY consulted as the final
// fallback, and when it is, the result is snapped to the next
// known tier (200K → 1M → 2M) rather than returned raw. The
// result is always labelled `inferred` so the UI can say so.
//
// Plan detection:
//
// The resolver accepts `capabilities` (live from /api/bootstrap)
// as the authoritative plan signal. Max shows `["claude_max", "chat"]`,
// Free shows `["chat"]`, presumably Pro/Team/Enterprise show their
// own `claude_*` tokens. When capabilities aren't available (e.g.
// tokenOnlyMode, first fetch hasn't completed, offline), the
// resolver falls back to the local `subscriptionType` field from
// ~/.claude/.credentials.json which Claude Code still populates.

const STANDARD_LIMIT = 200000;

// Known context window tiers in ascending order. The snap-to-tier
// fallback uses these as the set of valid result values. When
// Anthropic ships a new tier (e.g. 5M on some plan), add it here
// AND add a matching rule to CONTEXT_WINDOW_RULES below.
const KNOWN_CONTEXT_TIERS = [200000, 1000000, 2000000];

// Rule table mapping (plan, model family, model version) → default
// context window. First match wins. Each rule encodes a product
// fact from Anthropic's defaults; sources should cite the release
// announcement or observed behaviour.
//
// Future-proofing:
//   - `minVersion` uses a numeric >= comparison so new point releases
//     (Opus 4.7, 5.0, …) automatically qualify without code changes.
//   - Adding a new plan tier is a one-line edit (extend the `plans`
//     array on an existing rule).
//   - Adding a new family or limit is one new rule entry.
//   - Removing a rule (if Anthropic reverts a default) is one deletion.
//
// What this CANNOT handle: non-(plan, family, version, limit)-shaped
// rules. E.g., "Max gets 2M on Opus but only during business hours"
// would require a code change.
const CONTEXT_WINDOW_RULES = [
    // Max / Team / Enterprise default to 1M on current-generation
    // Opus (4.6 and later). Confirmed by observing claude-opus-4-6[1m]
    // as the runtime model on a Max Personal account with no explicit
    // [1m] suffix configured. Source: Anthropic March 2026 GA
    // announcement + live verification on 2026-04-12.
    {
        plans: ['claude_max', 'claude_team', 'claude_enterprise'],
        family: 'opus',
        minVersion: 4.6,
        limit: 1_000_000,
        source: 'rule:max-opus-4.6+',
    },
    // Same defaults for current-generation Sonnet (4.6 and later).
    // Observed as claude-sonnet-4-6 being the running model in the
    // same Max session.
    {
        plans: ['claude_max', 'claude_team', 'claude_enterprise'],
        family: 'sonnet',
        minVersion: 4.6,
        limit: 1_000_000,
        source: 'rule:max-sonnet-4.6+',
    },
    // Deliberately no rule for Haiku on any plan: Anthropic has
    // never offered extended context on Haiku as far as we can
    // verify. Falls through to STANDARD_LIMIT on all plans.
    //
    // Deliberately no rule for Pro: Pro users get 1M only via
    // explicit [1m] alias or pay-as-you-go top-ups, which are
    // handled by the alias/JSONL paths upstream of this table.
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
    const match = stripped.match(/^claude-([a-z]+)-(\d+)-(\d+)/);
    if (!match) return null;
    return {
        family: match[1],
        version: parseFloat(`${match[2]}.${match[3]}`),
    };
}

// Find a rule in CONTEXT_WINDOW_RULES whose plans include at least
// one of the caller's capability tokens, AND whose (family, minVersion)
// matches at least one of the caller's detected model IDs. Returns
// {limit, source} on match, or null otherwise.
//
// Parameters:
//   capabilities - array of capability tokens from /api/bootstrap
//                  (e.g. ['claude_max', 'chat']). A single token
//                  like 'claude_max' is enough to match a rule whose
//                  plans array contains it.
//   modelIds     - array of model IDs from JSONL scan (Claude Code
//                  strips [Nm] suffixes so these are usually bare,
//                  e.g. ['claude-opus-4-6', 'claude-sonnet-4-6']).
function matchRuleTable(capabilities, modelIds) {
    if (!Array.isArray(capabilities) || capabilities.length === 0) return null;
    if (!Array.isArray(modelIds) || modelIds.length === 0) return null;

    const parsed = modelIds
        .map(parseFamilyAndVersion)
        .filter(Boolean);
    if (parsed.length === 0) return null;

    for (const rule of CONTEXT_WINDOW_RULES) {
        const planMatch = capabilities.some(cap => rule.plans.includes(cap));
        if (!planMatch) continue;
        const modelMatch = parsed.some(
            m => m.family === rule.family && m.version >= rule.minVersion
        );
        if (!modelMatch) continue;
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
//   4. rule table (live API)  -> inferred (capabilities + modelIds)
//   5. rule table (local)     -> inferred (subscriptionType + modelIds)
//   6. s1mHasAccess === true  -> configured (Claude Code's own cache)
//   7. observedFloor snap     -> inferred (fallback with explicit label)
//   8. STANDARD_LIMIT         -> unknown
//
// Input:
//   userOverride       - from claudemeter.tokenLimit setting; 0 = none
//   aliasDeclaredLimit - from parseModelAlias(claudeCode.selectedModel); 0 = none
//   jsonlDeclaredLimit - from getHighestDeclaredLimit(modelIds); 0 = none
//   capabilities       - live /api/bootstrap org capabilities array; null if unavailable
//   subscriptionType   - local .credentials.json subscriptionType; null if unavailable
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
        subscriptionType = null,
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

    // 3. JSONL model ID with an explicit suffix (rare in practice —
    // Claude Code strips these — but still authoritative when present)
    if (jsonlDeclaredLimit > 0) {
        return {
            limit: jsonlDeclaredLimit,
            source: 'jsonl-suffix',
            confidence: 'authoritative',
        };
    }

    // 4. Rule table match using live /api/bootstrap capabilities
    const liveRule = matchRuleTable(capabilities, modelIds);
    if (liveRule) {
        return {
            limit: liveRule.limit,
            source: liveRule.source,
            confidence: 'inferred',
        };
    }

    // 5. Rule table match using local subscriptionType as a
    // synthesised capability. Useful in tokenOnlyMode where the
    // /api/bootstrap fetch never runs, or before the first fetch
    // completes on startup.
    const localCap = subscriptionTypeToCapability(subscriptionType);
    if (localCap) {
        const localRule = matchRuleTable([localCap], modelIds);
        if (localRule) {
            return {
                limit: localRule.limit,
                source: `${localRule.source}-local`,
                confidence: 'inferred',
            };
        }
    }

    // 6. Claude Code's own eligibility cache corroborates extended
    // context. Only fires when the rule table DIDN'T match —
    // meaning we trust the cache as a last-resort "configured"
    // signal rather than a primary source.
    if (s1mHasAccess === true) {
        return {
            limit: 1_000_000,
            source: 'cc-eligibility',
            confidence: 'configured',
        };
    }

    // 7. observed-floor fallback: snap to the next known tier so
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

    // 8. Nothing to go on — default to standard.
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
