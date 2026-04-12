// Tests for the new context window resolver — the replacement for the
// old Math.max-based resolveSessionContextWindow. The new resolver
// treats observedFloor as a LOWER BOUND (not a true limit), uses a
// rule table driven by subscription capabilities from /api/bootstrap,
// and returns a {limit, source, confidence} tuple so callers can
// render an honest source label in the tooltip.
//
// Primary regression target: the 2026-04 ratchet bug where session
// limit was stored as the raw observed cache_read value (e.g. 557675)
// because Math.max was treating observedFloor as authoritative.

import { describe, it, expect } from 'vitest';
const {
    resolveContextWindow,
    snapToNextKnownTier,
    matchRuleTable,
    KNOWN_CONTEXT_TIERS,
    CONTEXT_WINDOW_RULES,
    STANDARD_LIMIT,
} = require('../../src/contextWindowResolver');

describe('KNOWN_CONTEXT_TIERS', () => {
    it('contains the currently-shipping tiers', () => {
        expect(KNOWN_CONTEXT_TIERS).toContain(200000);
        expect(KNOWN_CONTEXT_TIERS).toContain(1000000);
        expect(KNOWN_CONTEXT_TIERS).toContain(2000000);
    });

    it('is sorted ascending', () => {
        const sorted = [...KNOWN_CONTEXT_TIERS].sort((a, b) => a - b);
        expect(KNOWN_CONTEXT_TIERS).toEqual(sorted);
    });

    it('starts at STANDARD_LIMIT', () => {
        expect(KNOWN_CONTEXT_TIERS[0]).toBe(STANDARD_LIMIT);
    });
});

describe('snapToNextKnownTier', () => {
    it('returns STANDARD_LIMIT for 0', () => {
        expect(snapToNextKnownTier(0)).toBe(200000);
    });

    it('returns STANDARD_LIMIT for values below 200K', () => {
        expect(snapToNextKnownTier(100000)).toBe(200000);
        expect(snapToNextKnownTier(199999)).toBe(200000);
    });

    it('returns STANDARD_LIMIT exactly at 200K', () => {
        expect(snapToNextKnownTier(200000)).toBe(200000);
    });

    it('snaps to 1M for 200001 through 999999', () => {
        expect(snapToNextKnownTier(200001)).toBe(1000000);
        expect(snapToNextKnownTier(500000)).toBe(1000000);
        expect(snapToNextKnownTier(999999)).toBe(1000000);
    });

    it('returns 1M exactly at 1M', () => {
        expect(snapToNextKnownTier(1000000)).toBe(1000000);
    });

    it('snaps to 2M for 1000001 through 1999999', () => {
        expect(snapToNextKnownTier(1000001)).toBe(2000000);
        expect(snapToNextKnownTier(1500000)).toBe(2000000);
        expect(snapToNextKnownTier(1999999)).toBe(2000000);
    });

    it('returns 2M exactly at 2M', () => {
        expect(snapToNextKnownTier(2000000)).toBe(2000000);
    });

    it('returns highest known tier for values above the top tier', () => {
        // We explicitly do NOT invent higher tiers — the rule table is the
        // source of truth for new tiers. Snap saturates at the top.
        expect(snapToNextKnownTier(2000001)).toBe(2000000);
        expect(snapToNextKnownTier(3000000)).toBe(2000000);
    });

    it('handles negative and NaN defensively', () => {
        expect(snapToNextKnownTier(-1)).toBe(200000);
        expect(snapToNextKnownTier(NaN)).toBe(200000);
    });
});

describe('CONTEXT_WINDOW_RULES', () => {
    it('is a non-empty array', () => {
        expect(Array.isArray(CONTEXT_WINDOW_RULES)).toBe(true);
        expect(CONTEXT_WINDOW_RULES.length).toBeGreaterThan(0);
    });

    it('every rule has plans, family, minVersion, limit, source', () => {
        for (const rule of CONTEXT_WINDOW_RULES) {
            expect(Array.isArray(rule.plans)).toBe(true);
            expect(typeof rule.family).toBe('string');
            expect(typeof rule.minVersion).toBe('number');
            expect(typeof rule.limit).toBe('number');
            expect(typeof rule.source).toBe('string');
            expect(rule.source).toMatch(/^rule:/);
        }
    });

    it('covers claude_max + opus-4.6 at 1M', () => {
        const match = CONTEXT_WINDOW_RULES.find(r =>
            r.plans.includes('claude_max') &&
            r.family === 'opus' &&
            r.minVersion <= 4.6 &&
            r.limit === 1000000
        );
        expect(match).toBeDefined();
    });

    it('covers claude_max + sonnet-4.6 at 1M', () => {
        const match = CONTEXT_WINDOW_RULES.find(r =>
            r.plans.includes('claude_max') &&
            r.family === 'sonnet' &&
            r.minVersion <= 4.6 &&
            r.limit === 1000000
        );
        expect(match).toBeDefined();
    });

    it('covers claude_team and claude_enterprise in the same rules', () => {
        const maxOpusRule = CONTEXT_WINDOW_RULES.find(r =>
            r.family === 'opus' && r.plans.includes('claude_max')
        );
        expect(maxOpusRule.plans).toContain('claude_team');
        expect(maxOpusRule.plans).toContain('claude_enterprise');
    });
});

describe('matchRuleTable', () => {
    it('matches Max + Opus 4.6 → 1M', () => {
        const result = matchRuleTable(['claude_max'], ['claude-opus-4-6']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
        expect(result.source).toMatch(/^rule:/);
    });

    it('matches Max + Sonnet 4.6 → 1M', () => {
        const result = matchRuleTable(['claude_max'], ['claude-sonnet-4-6']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Team + Opus 4.6 → 1M', () => {
        const result = matchRuleTable(['claude_team'], ['claude-opus-4-6']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Enterprise + Sonnet 4.6 → 1M', () => {
        const result = matchRuleTable(['claude_enterprise'], ['claude-sonnet-4-6']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    // Future-proofing: minVersion is a >= comparison, so new point releases
    // automatically qualify without requiring a code change. When Anthropic
    // ships Opus 4.7, this test proves the rule table still fires.
    it('matches Max + future Opus 4.7 → 1M (minVersion future-proofing)', () => {
        const result = matchRuleTable(['claude_max'], ['claude-opus-4-7']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Max + future Opus 5.0 → 1M', () => {
        const result = matchRuleTable(['claude_max'], ['claude-opus-5-0']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Max + future Sonnet 5.0 → 1M', () => {
        const result = matchRuleTable(['claude_max'], ['claude-sonnet-5-0']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('does NOT match Max + old-gen Opus 4.5 (minVersion cutoff)', () => {
        const result = matchRuleTable(['claude_max'], ['claude-opus-4-5-20251101']);
        expect(result).toBeNull();
    });

    it('does NOT match Max + old-gen Sonnet 4.5', () => {
        const result = matchRuleTable(['claude_max'], ['claude-sonnet-4-5-20250929']);
        expect(result).toBeNull();
    });

    it('does NOT match Max + Haiku (no rule for haiku family)', () => {
        const result = matchRuleTable(['claude_max'], ['claude-haiku-4-5-20251001']);
        expect(result).toBeNull();
    });

    it('does NOT match Max + Claude 3 Opus', () => {
        const result = matchRuleTable(['claude_max'], ['claude-3-opus-20240229']);
        expect(result).toBeNull();
    });

    it('does NOT match Pro + Opus 4.6 (Pro is not in rule plans)', () => {
        const result = matchRuleTable(['claude_pro'], ['claude-opus-4-6']);
        expect(result).toBeNull();
    });

    it('does NOT match Free + Opus 4.6 (free has no claude_* token)', () => {
        const result = matchRuleTable(['chat'], ['claude-opus-4-6']);
        expect(result).toBeNull();
    });

    it('ignores unknown capability tokens', () => {
        const result = matchRuleTable(['claude_unicorn', 'chat'], ['claude-opus-4-6']);
        expect(result).toBeNull();
    });

    it('mixed: unknown token alongside real plan still matches', () => {
        const result = matchRuleTable(['claude_max', 'claude_unicorn'], ['claude-opus-4-6']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('returns null when capabilities is null/undefined/empty', () => {
        expect(matchRuleTable(null, ['claude-opus-4-6'])).toBeNull();
        expect(matchRuleTable(undefined, ['claude-opus-4-6'])).toBeNull();
        expect(matchRuleTable([], ['claude-opus-4-6'])).toBeNull();
    });

    it('returns null when modelIds is null/undefined/empty', () => {
        expect(matchRuleTable(['claude_max'], null)).toBeNull();
        expect(matchRuleTable(['claude_max'], undefined)).toBeNull();
        expect(matchRuleTable(['claude_max'], [])).toBeNull();
    });

    it('matches even if unrecognised model IDs are mixed in', () => {
        const result = matchRuleTable(
            ['claude_max'],
            ['gpt-4-turbo', 'claude-opus-4-6', 'random-model']
        );
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });
});

describe('resolveContextWindow — primary bug regression', () => {
    // This is the regression test for the 2026-04 ratchet bug. Your
    // session was on claude-opus-4-6[1m] (per Claude Code's internal
    // default for Max plans post-March-2026-GA), the JSONL had the
    // suffix stripped, s1mAccessCache said hasAccess:false (stale),
    // VS Code selectedModel was "default", and claudemeter ratcheted
    // the stored limit up to the raw observed token count (557675).
    //
    // With the new resolver, the rule table match on
    // (claude_max + opus-4-6) fires first and returns 1M regardless
    // of observed usage.
    it('ratchet bug regression: Max + opus-4-6 + observed 557675 → 1M', () => {
        const result = resolveContextWindow({
            userOverride: 0,
            aliasDeclaredLimit: 0,
            jsonlDeclaredLimit: 0,
            capabilities: ['claude_max', 'chat'],
            subscriptionType: 'max',
            s1mHasAccess: false, // stale cache like in the real bug
            modelIds: ['claude-opus-4-6', 'claude-sonnet-4-6'],
            observedFloor: 557675,
        });
        expect(result.limit).toBe(1000000);
        expect(result.confidence).not.toBe('unknown');
    });

    it('without live capabilities, local subscriptionType still resolves Max', () => {
        const result = resolveContextWindow({
            userOverride: 0,
            aliasDeclaredLimit: 0,
            jsonlDeclaredLimit: 0,
            capabilities: null, // no live API data (tokenOnlyMode)
            subscriptionType: 'max',
            s1mHasAccess: false,
            modelIds: ['claude-opus-4-6'],
            observedFloor: 557675,
        });
        expect(result.limit).toBe(1000000);
    });

    it('the resolved limit does not drift with higher observed tokens', () => {
        // Prove the ratchet is truly dead: same inputs except observed = 1.1M
        // (implausible but defensive). The rule table still wins.
        const result = resolveContextWindow({
            capabilities: ['claude_max'],
            modelIds: ['claude-opus-4-6'],
            observedFloor: 1100000,
        });
        expect(result.limit).toBe(1000000);
    });
});

describe('resolveContextWindow — priority order', () => {
    it('user override beats everything', () => {
        const result = resolveContextWindow({
            userOverride: 750000,
            capabilities: ['claude_max'],
            modelIds: ['claude-opus-4-6'],
            observedFloor: 500000,
        });
        expect(result.limit).toBe(750000);
        expect(result.source).toBe('user-override');
        expect(result.confidence).toBe('authoritative');
    });

    it('alias-declared limit beats rule table', () => {
        const result = resolveContextWindow({
            aliasDeclaredLimit: 2000000,
            capabilities: ['claude_max'],
            modelIds: ['claude-opus-4-6'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(2000000);
        expect(result.source).toBe('cc-alias');
        expect(result.confidence).toBe('authoritative');
    });

    it('jsonl-declared limit beats rule table', () => {
        const result = resolveContextWindow({
            jsonlDeclaredLimit: 2000000,
            capabilities: ['claude_max'],
            modelIds: ['claude-opus-4-6[2m]'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(2000000);
        expect(result.source).toBe('jsonl-suffix');
        expect(result.confidence).toBe('authoritative');
    });

    it('rule table beats s1m cache when both agree', () => {
        const result = resolveContextWindow({
            capabilities: ['claude_max'],
            modelIds: ['claude-opus-4-6'],
            s1mHasAccess: true,
            observedFloor: 0,
        });
        expect(result.limit).toBe(1000000);
        expect(result.source).toMatch(/^rule:/);
    });

    it('s1m cache fires when rule table has no match', () => {
        const result = resolveContextWindow({
            capabilities: ['claude_pro'],
            modelIds: ['claude-opus-4-6'],
            s1mHasAccess: true,
            observedFloor: 0,
        });
        expect(result.limit).toBe(1000000);
        expect(result.source).toBe('cc-eligibility');
        expect(result.confidence).toBe('configured');
    });
});

describe('resolveContextWindow — fallback behaviour', () => {
    it('Free user with no signals → standard 200K', () => {
        const result = resolveContextWindow({
            capabilities: ['chat'],
            modelIds: ['claude-opus-4-6'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(200000);
        expect(result.source).toBe('standard');
        expect(result.confidence).toBe('unknown');
    });

    it('Free user with observed > 200K → snap to 1M, inferred', () => {
        const result = resolveContextWindow({
            capabilities: ['chat'],
            modelIds: ['claude-opus-4-6'],
            observedFloor: 250000,
        });
        expect(result.limit).toBe(1000000);
        expect(result.source).toBe('observed-snap');
        expect(result.confidence).toBe('inferred');
    });

    it('Pro + Opus 4.6 + no alias + low observed → standard 200K', () => {
        const result = resolveContextWindow({
            capabilities: ['claude_pro'],
            modelIds: ['claude-opus-4-6'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(200000);
        expect(result.source).toBe('standard');
    });

    it('Pro + explicit [1m] alias wins → 1M authoritative', () => {
        const result = resolveContextWindow({
            aliasDeclaredLimit: 1000000,
            capabilities: ['claude_pro'],
            modelIds: ['claude-opus-4-6'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(1000000);
        expect(result.source).toBe('cc-alias');
        expect(result.confidence).toBe('authoritative');
    });

    it('Max + Haiku → no rule match → standard 200K (Haiku not in rules)', () => {
        const result = resolveContextWindow({
            capabilities: ['claude_max'],
            modelIds: ['claude-haiku-4-5-20251001'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(200000);
        expect(result.source).toBe('standard');
    });

    it('Max + Opus 3 → no rule match (minVersion fails) → standard', () => {
        const result = resolveContextWindow({
            capabilities: ['claude_max'],
            modelIds: ['claude-3-opus-20240229'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(200000);
        expect(result.source).toBe('standard');
    });

    it('no signals at all → standard 200K, confidence unknown', () => {
        const result = resolveContextWindow({});
        expect(result.limit).toBe(200000);
        expect(result.source).toBe('standard');
        expect(result.confidence).toBe('unknown');
    });
});

describe('resolveContextWindow — shape contract', () => {
    it('always returns {limit, source, confidence}', () => {
        const result = resolveContextWindow({});
        expect(result).toHaveProperty('limit');
        expect(result).toHaveProperty('source');
        expect(result).toHaveProperty('confidence');
    });

    it('limit is always a positive number', () => {
        const result = resolveContextWindow({});
        expect(typeof result.limit).toBe('number');
        expect(result.limit).toBeGreaterThan(0);
    });

    it('confidence is one of authoritative | configured | inferred | unknown', () => {
        const result = resolveContextWindow({});
        expect(['authoritative', 'configured', 'inferred', 'unknown']).toContain(result.confidence);
    });

    it('source is a non-empty string', () => {
        const result = resolveContextWindow({});
        expect(typeof result.source).toBe('string');
        expect(result.source.length).toBeGreaterThan(0);
    });
});
