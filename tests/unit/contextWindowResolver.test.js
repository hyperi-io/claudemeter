// Tests for the context window resolver. It treats observedFloor as a LOWER
// BOUND (not a true limit), uses a rule table driven by subscription
// capabilities from /api/bootstrap, and returns a {limit, source, confidence}
// tuple so callers can render an honest source label in the tooltip.
//
// The ordering matters most where every other signal is absent: maximising
// over observedFloor there makes the reported limit follow usage upward and
// pin the gauge at ~100%.

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
        // We explicitly do NOT invent higher tiers - the rule table is the
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

    it('every rule has family, minVersion, limit, source', () => {
        for (const rule of CONTEXT_WINDOW_RULES) {
            expect(typeof rule.family).toBe('string');
            expect(typeof rule.minVersion).toBe('number');
            expect(typeof rule.limit).toBe('number');
            expect(typeof rule.source).toBe('string');
            expect(rule.source).toMatch(/^rule:/);
        }
    });

    // The window is a property of the model, not the plan, so no rule may
    // carry a plan allowlist - that gate is what made a Pro or
    // plan-signal-less account read 200K on a 1M model (#55).
    it('no rule gates on a plan allowlist', () => {
        for (const rule of CONTEXT_WINDOW_RULES) {
            expect(rule.plans).toBeUndefined();
        }
    });

    it('any credits caveat names plans, not a bare flag', () => {
        for (const rule of CONTEXT_WINDOW_RULES) {
            if (rule.creditsRequiredPlans !== undefined) {
                expect(Array.isArray(rule.creditsRequiredPlans)).toBe(true);
                expect(rule.creditsRequiredPlans.length).toBeGreaterThan(0);
            }
        }
    });

    it('covers opus-4.6 at 1M, credits-gated for Pro only', () => {
        const match = CONTEXT_WINDOW_RULES.find(r =>
            r.family === 'opus' && r.minVersion <= 4.6 && r.limit === 1000000
        );
        expect(match).toBeDefined();
        expect(match.creditsRequiredPlans).toEqual(['claude_pro']);
    });

    it('covers sonnet-5 at 1M with no credits caveat', () => {
        const match = CONTEXT_WINDOW_RULES.find(r =>
            r.family === 'sonnet' && r.minVersion === 5 && r.limit === 1000000
        );
        expect(match).toBeDefined();
        expect(match.creditsRequiredPlans).toBeUndefined();
    });

    it('covers fable-5 at 1M with no credits caveat', () => {
        const match = CONTEXT_WINDOW_RULES.find(r =>
            r.family === 'fable' && r.minVersion === 5 && r.limit === 1000000
        );
        expect(match).toBeDefined();
        expect(match.creditsRequiredPlans).toBeUndefined();
    });

    // Sonnet 4.6 needs credits on every paid plan except usage-based
    // Enterprise, and first-match-wins means the unconditional Sonnet 5 rule
    // has to sit ahead of it or Sonnet 5 inherits the caveat.
    it('lists the sonnet-5 rule before the credits-gated sonnet-4.6 rule', () => {
        const five = CONTEXT_WINDOW_RULES.findIndex(r => r.family === 'sonnet' && r.minVersion === 5);
        const legacy = CONTEXT_WINDOW_RULES.findIndex(r => r.family === 'sonnet' && r.minVersion === 4.6);
        expect(five).toBeGreaterThanOrEqual(0);
        expect(legacy).toBeGreaterThan(five);
        expect(CONTEXT_WINDOW_RULES[legacy].creditsRequiredPlans).toContain('claude_pro');
        expect(CONTEXT_WINDOW_RULES[legacy].creditsRequiredPlans).not.toContain('claude_enterprise');
    });
});

describe('matchRuleTable', () => {
    const max = { planTokens: ['claude_max'] };
    const pro = { planTokens: ['claude_pro'] };

    it('matches Opus 4.6 → 1M', () => {
        const result = matchRuleTable(['claude-opus-4-6'], max);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
        expect(result.source).toMatch(/^rule:/);
    });

    it('matches Sonnet 4.6 → 1M', () => {
        const result = matchRuleTable(['claude-sonnet-4-6'], max);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Team + Opus 4.6 → 1M', () => {
        const result = matchRuleTable(['claude-opus-4-6'], { planTokens: ['claude_team'] });
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Enterprise + Sonnet 4.6 → 1M', () => {
        const result = matchRuleTable(['claude-sonnet-4-6'], { planTokens: ['claude_enterprise'] });
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    // Future-proofing: minVersion is a >= comparison, so new point releases
    // automatically qualify without requiring a code change.
    it('matches Opus 4.7 → 1M (minVersion future-proofing)', () => {
        const result = matchRuleTable(['claude-opus-4-7'], max);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Opus 5.0 → 1M', () => {
        const result = matchRuleTable(['claude-opus-5-0'], max);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Sonnet 5.0 → 1M', () => {
        const result = matchRuleTable(['claude-sonnet-5-0'], max);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Fable 5 -> 1M (single-version ID)', () => {
        const result = matchRuleTable(['claude-fable-5'], max);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
        expect(result.source).toBe('rule:fable-5+');
    });

    it('matches Fable 5 with date suffix -> 1M (date not read as minor)', () => {
        const result = matchRuleTable(['claude-fable-5-20260609'], max);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches Pro + Fable 5 -> 1M (no plan gate, no credits caveat)', () => {
        const result = matchRuleTable(['claude-fable-5'], { ...pro, creditsEnabled: false });
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('matches with no plan tokens at all -> 1M (the window is the model\'s)', () => {
        const result = matchRuleTable(['claude-opus-5']);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    it('does NOT match Fable 4 (below minVersion 5)', () => {
        expect(matchRuleTable(['claude-fable-4'], max)).toBeNull();
    });

    it('does NOT match old-gen Opus 4.5 (minVersion cutoff)', () => {
        expect(matchRuleTable(['claude-opus-4-5-20251101'], max)).toBeNull();
    });

    it('does NOT match old-gen Sonnet 4.5', () => {
        expect(matchRuleTable(['claude-sonnet-4-5-20250929'], max)).toBeNull();
    });

    it('does NOT match Haiku (no rule for haiku family)', () => {
        expect(matchRuleTable(['claude-haiku-4-5-20251001'], max)).toBeNull();
    });

    it('does NOT match Claude 3 Opus', () => {
        expect(matchRuleTable(['claude-3-opus-20240229'], max)).toBeNull();
    });

    it('returns null when modelIds is null/undefined/empty', () => {
        expect(matchRuleTable(null, max)).toBeNull();
        expect(matchRuleTable(undefined, max)).toBeNull();
        expect(matchRuleTable([], max)).toBeNull();
    });

    it('matches even if unrecognised model IDs are mixed in', () => {
        const result = matchRuleTable(['gpt-4-turbo', 'claude-opus-4-6', 'random-model'], max);
        expect(result).not.toBeNull();
        expect(result.limit).toBe(1000000);
    });

    describe('credits caveat', () => {
        it('withholds Opus 1M from Pro when credits are known off', () => {
            expect(matchRuleTable(['claude-opus-5'], { ...pro, creditsEnabled: false })).toBeNull();
        });

        it('grants Opus 1M to Pro when credits are on', () => {
            const result = matchRuleTable(['claude-opus-5'], { ...pro, creditsEnabled: true });
            expect(result.limit).toBe(1000000);
        });

        // A signal we cannot read must not cost the user their window - that
        // failure mode is the whole of #55.
        it('grants Opus 1M to Pro when the credit state is unknown', () => {
            expect(matchRuleTable(['claude-opus-5'], pro).limit).toBe(1000000);
        });

        it('never applies the Opus caveat to Max', () => {
            const result = matchRuleTable(['claude-opus-5'], { ...max, creditsEnabled: false });
            expect(result.limit).toBe(1000000);
        });

        it('applies the Sonnet 4.6 caveat to Max as well as Pro', () => {
            expect(matchRuleTable(['claude-sonnet-4-6'], { ...max, creditsEnabled: false })).toBeNull();
            expect(matchRuleTable(['claude-sonnet-4-6'], { ...pro, creditsEnabled: false })).toBeNull();
        });

        it('exempts Enterprise from the Sonnet 4.6 caveat', () => {
            const result = matchRuleTable(['claude-sonnet-4-6'], {
                planTokens: ['claude_enterprise'], creditsEnabled: false,
            });
            expect(result.limit).toBe(1000000);
        });

        it('does not let the Sonnet 4.6 caveat reach Sonnet 5', () => {
            const result = matchRuleTable(['claude-sonnet-5'], { ...pro, creditsEnabled: false });
            expect(result.limit).toBe(1000000);
            expect(result.source).toBe('rule:sonnet-5+');
        });
    });
});

describe('resolveContextWindow — rule table overrides a high observed floor', () => {
    // A session on claude-opus-4-6[1m] whose JSONL has the suffix stripped,
    // whose s1mAccessCache reports hasAccess:false (stale), and whose VS Code
    // selectedModel is "default" has no authoritative signal at all - only the
    // rule table and a high observed floor. The rule table match on
    // (claude_max + opus-4-6) must fire first and return 1M regardless of how
    // high observed usage climbs, or the reported limit ratchets up with it.
    it('rule table beats a high observed floor: Max + opus-4-6 + observed 557675 → 1M', () => {
        const result = resolveContextWindow({
            userOverride: 0,
            aliasDeclaredLimit: 0,
            jsonlDeclaredLimit: 0,
            capabilities: ['claude_max', 'chat'],
            subscriptionType: 'max',
            s1mHasAccess: false, // stale: corroborates nothing, must not block the rule table
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

    it('macOS current builds (#51): resolves with organizationType alone', () => {
        // The environment issue #51 describes: no .credentials.json (tokens
        // in the Keychain, so subscriptionType is null), no s1mAccessCache,
        // no live capabilities yet - only oauthAccount.organizationType.
        const result = resolveContextWindow({
            capabilities: null,
            organizationType: 'claude_max',
            subscriptionType: null,
            s1mHasAccess: null,
            modelIds: ['claude-fable-5'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(1000000);
        expect(result.source).toBe('rule:fable-5+');
        expect(result.confidence).toBe('inferred');
    });

    it('resolves even when the legacy subscriptionType is a non-token', () => {
        const result = resolveContextWindow({
            organizationType: 'claude_max',
            subscriptionType: 'free',
            modelIds: ['claude-opus-4-6'],
        });
        expect(result.limit).toBe(1000000);
    });

    it('an unrecognised plan token does not block the model rule', () => {
        const result = resolveContextWindow({
            organizationType: 'claude_free_tier_of_the_future',
            subscriptionType: null,
            modelIds: ['claude-opus-4-6'],
        });
        expect(result.limit).toBe(1000000);
        expect(result.source).toBe('rule:opus-4.6+');
    });

    it('fable detection: Max + fable-5 + observed < 200K -> 1M', () => {
        // A single-version model id (claude-fable-5) has no minor to parse, so
        // a parser that requires one drops the rule match and falls back to
        // 200K.
        const result = resolveContextWindow({
            capabilities: ['claude_max', 'chat'],
            subscriptionType: 'max',
            s1mHasAccess: false,
            modelIds: ['claude-fable-5'],
            observedFloor: 150000,
        });
        expect(result.limit).toBe(1000000);
        expect(result.confidence).not.toBe('unknown');
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
            modelIds: ['claude-haiku-4-5-20251001'],
            s1mHasAccess: true,
            observedFloor: 0,
        });
        expect(result.limit).toBe(1000000);
        expect(result.source).toBe('cc-eligibility');
        expect(result.confidence).toBe('configured');
    });
});

// The reported symptom of #55: a 1M session reads 200K from its first turn and
// only corrects itself once usage climbs past 200K and observedFloor snaps.
describe('resolveContextWindow — issue #55 regression', () => {
    for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5']) {
        it(`${model} with no plan signal resolves 1M from the first turn`, () => {
            const result = resolveContextWindow({ modelIds: [model], observedFloor: 12000 });
            expect(result.limit).toBe(1000000);
            expect(result.source).toMatch(/^rule:/);
        });

        it(`${model} on Pro resolves 1M`, () => {
            const result = resolveContextWindow({
                subscriptionType: 'pro',
                modelIds: [model],
                observedFloor: 12000,
            });
            expect(result.limit).toBe(1000000);
        });
    }

    it('does not need observedFloor to reach 1M', () => {
        const low = resolveContextWindow({ modelIds: ['claude-opus-5'], observedFloor: 0 });
        const high = resolveContextWindow({ modelIds: ['claude-opus-5'], observedFloor: 900000 });
        expect(low.limit).toBe(high.limit);
        expect(low.source).toBe(high.source);
    });

    it('Pro on Opus without credits still reads 200K (Anthropic caveat)', () => {
        const result = resolveContextWindow({
            subscriptionType: 'pro',
            creditsEnabled: false,
            modelIds: ['claude-opus-5'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(STANDARD_LIMIT);
    });
});

describe('resolveContextWindow — fallback behaviour', () => {
    it('unmatched model with no other signal → standard 200K', () => {
        const result = resolveContextWindow({
            capabilities: ['chat'],
            modelIds: ['claude-haiku-4-5-20251001'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(200000);
        expect(result.source).toBe('standard');
        expect(result.confidence).toBe('unknown');
    });

    it('unmatched model with observed > 200K → snap to 1M, inferred', () => {
        const result = resolveContextWindow({
            capabilities: ['chat'],
            modelIds: ['claude-haiku-4-5-20251001'],
            observedFloor: 250000,
        });
        expect(result.limit).toBe(1000000);
        expect(result.source).toBe('observed-snap');
        expect(result.confidence).toBe('inferred');
    });

    it('Pro + Opus 4.6 + credits off + low observed → standard 200K', () => {
        const result = resolveContextWindow({
            capabilities: ['claude_pro'],
            creditsEnabled: false,
            modelIds: ['claude-opus-4-6'],
            observedFloor: 0,
        });
        expect(result.limit).toBe(200000);
        expect(result.source).toBe('standard');
    });

    it('Pro + credits off + explicit [1m] alias wins → 1M authoritative', () => {
        const result = resolveContextWindow({
            aliasDeclaredLimit: 1000000,
            capabilities: ['claude_pro'],
            creditsEnabled: false,
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
