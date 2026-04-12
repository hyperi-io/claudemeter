import { describe, it, expect } from 'vitest';
const {
    parseModelId,
    parseModelAlias,
    parseContextSuffix,
    getHighestDeclaredLimit,
    getModelContextWindow,
    resolveSessionContextWindow,
    getPlanContextSummary,
    FALLBACK_LIMIT,
    STANDARD_LIMIT,
} = require('../../src/modelContextWindows');

describe('parseContextSuffix', () => {
    it('parses [1m] to 1,000,000', () => {
        expect(parseContextSuffix('[1m]')).toBe(1000000);
    });

    it('parses [2m] to 2,000,000', () => {
        expect(parseContextSuffix('[2m]')).toBe(2000000);
    });

    it('parses [5m] to 5,000,000', () => {
        expect(parseContextSuffix('[5m]')).toBe(5000000);
    });

    it('parses [500k] to 500,000', () => {
        expect(parseContextSuffix('[500k]')).toBe(500000);
    });

    it('returns 0 for null/undefined/empty', () => {
        expect(parseContextSuffix(null)).toBe(0);
        expect(parseContextSuffix(undefined)).toBe(0);
        expect(parseContextSuffix('')).toBe(0);
    });

    it('returns 0 for unrecognised suffix', () => {
        expect(parseContextSuffix('[big]')).toBe(0);
        expect(parseContextSuffix('[1g]')).toBe(0);
    });
});

describe('parseModelAlias', () => {
    it('extracts 1M from opus[1m]', () => {
        expect(parseModelAlias('opus[1m]')).toBe(1000000);
    });

    it('extracts 2M from opus[2m]', () => {
        expect(parseModelAlias('opus[2m]')).toBe(2000000);
    });

    it('extracts 1M from sonnet[1m]', () => {
        expect(parseModelAlias('sonnet[1m]')).toBe(1000000);
    });

    it('extracts 1M from full model ID with suffix', () => {
        expect(parseModelAlias('claude-opus-4-6[1m]')).toBe(1000000);
    });

    it('returns 0 for alias without suffix', () => {
        expect(parseModelAlias('opus')).toBe(0);
        expect(parseModelAlias('sonnet')).toBe(0);
        expect(parseModelAlias('default')).toBe(0);
    });

    it('returns 0 for null/undefined/empty', () => {
        expect(parseModelAlias(null)).toBe(0);
        expect(parseModelAlias(undefined)).toBe(0);
        expect(parseModelAlias('')).toBe(0);
    });

    it('returns 0 for non-string', () => {
        expect(parseModelAlias(123)).toBe(0);
    });
});

describe('parseModelId', () => {
    it('parses standard opus 4.6', () => {
        const result = parseModelId('claude-opus-4-6');
        expect(result).toEqual({ family: 'opus', version: 4.6, contextLimit: 0, raw: 'claude-opus-4-6' });
    });

    it('parses standard sonnet 4.6', () => {
        const result = parseModelId('claude-sonnet-4-6');
        expect(result).toEqual({ family: 'sonnet', version: 4.6, contextLimit: 0, raw: 'claude-sonnet-4-6' });
    });

    it('parses haiku 4.5', () => {
        const result = parseModelId('claude-haiku-4-5');
        expect(result).toEqual({ family: 'haiku', version: 4.5, contextLimit: 0, raw: 'claude-haiku-4-5' });
    });

    it('parses model ID with date suffix', () => {
        const result = parseModelId('claude-opus-4-6-20260301');
        expect(result).toEqual({ family: 'opus', version: 4.6, contextLimit: 0, raw: 'claude-opus-4-6-20260301' });
    });

    it('parses [1m] suffix as 1M context', () => {
        const result = parseModelId('claude-opus-4-6[1m]');
        expect(result).toEqual({ family: 'opus', version: 4.6, contextLimit: 1000000, raw: 'claude-opus-4-6[1m]' });
    });

    it('parses [2m] suffix as 2M context', () => {
        const result = parseModelId('claude-opus-4-6[2m]');
        expect(result).toEqual({ family: 'opus', version: 4.6, contextLimit: 2000000, raw: 'claude-opus-4-6[2m]' });
    });

    it('parses [1m] suffix on sonnet', () => {
        const result = parseModelId('claude-sonnet-4-6[1m]');
        expect(result).toEqual({ family: 'sonnet', version: 4.6, contextLimit: 1000000, raw: 'claude-sonnet-4-6[1m]' });
    });

    it('parses [1m] suffix with date prefix', () => {
        const result = parseModelId('claude-opus-4-6-20260301[1m]');
        expect(result).toEqual({ family: 'opus', version: 4.6, contextLimit: 1000000, raw: 'claude-opus-4-6-20260301[1m]' });
    });

    it('returns null for empty input', () => {
        expect(parseModelId(null)).toBeNull();
        expect(parseModelId(undefined)).toBeNull();
        expect(parseModelId('')).toBeNull();
    });

    it('returns null for non-string input', () => {
        expect(parseModelId(123)).toBeNull();
        expect(parseModelId({})).toBeNull();
    });

    it('returns null for unrecognised format', () => {
        expect(parseModelId('gpt-4')).toBeNull();
        expect(parseModelId('claude-')).toBeNull();
        expect(parseModelId('random-string')).toBeNull();
    });
});

describe('getHighestDeclaredLimit', () => {
    it('returns 1M when one model has [1m]', () => {
        expect(getHighestDeclaredLimit(['claude-opus-4-6[1m]', 'claude-sonnet-4-6'])).toBe(1000000);
    });

    it('returns 2M when a model has [2m]', () => {
        expect(getHighestDeclaredLimit(['claude-opus-4-6[2m]', 'claude-sonnet-4-6[1m]'])).toBe(2000000);
    });

    it('returns 0 when no model has a suffix', () => {
        expect(getHighestDeclaredLimit(['claude-opus-4-6', 'claude-sonnet-4-6'])).toBe(0);
    });

    it('returns 0 for empty array', () => {
        expect(getHighestDeclaredLimit([])).toBe(0);
    });

    it('returns 0 for null/undefined', () => {
        expect(getHighestDeclaredLimit(null)).toBe(0);
        expect(getHighestDeclaredLimit(undefined)).toBe(0);
    });

    it('ignores unrecognised model IDs', () => {
        expect(getHighestDeclaredLimit(['gpt-4', 'unknown'])).toBe(0);
    });
});

describe('getModelContextWindow', () => {
    it('returns 200K for standard opus', () => {
        expect(getModelContextWindow('claude-opus-4-6')).toBe(STANDARD_LIMIT);
    });

    it('returns 200K for standard sonnet', () => {
        expect(getModelContextWindow('claude-sonnet-4-6')).toBe(STANDARD_LIMIT);
    });

    it('returns 1M for opus with [1m]', () => {
        expect(getModelContextWindow('claude-opus-4-6[1m]')).toBe(1000000);
    });

    it('returns 2M for opus with [2m]', () => {
        expect(getModelContextWindow('claude-opus-4-6[2m]')).toBe(2000000);
    });

    it('returns fallback for unrecognised model', () => {
        expect(getModelContextWindow('unknown-model')).toBe(FALLBACK_LIMIT);
    });
});

describe('resolveSessionContextWindow', () => {
    it('returns 200K when no signals', () => {
        const models = ['claude-opus-4-6', 'claude-sonnet-4-6'];
        expect(resolveSessionContextWindow(models, 50000)).toBe(STANDARD_LIMIT);
    });

    it('returns 1M from alias declared limit', () => {
        const models = ['claude-opus-4-6'];
        expect(resolveSessionContextWindow(models, 0, 1000000)).toBe(1000000);
    });

    it('returns 2M from alias declared limit', () => {
        const models = ['claude-opus-4-6'];
        expect(resolveSessionContextWindow(models, 0, 2000000)).toBe(2000000);
    });

    it('returns 1M when JSONL model has [1m] suffix', () => {
        const models = ['claude-opus-4-6[1m]', 'claude-sonnet-4-6'];
        expect(resolveSessionContextWindow(models, 0)).toBe(1000000);
    });

    it('returns 2M when JSONL model has [2m] suffix', () => {
        const models = ['claude-opus-4-6[2m]'];
        expect(resolveSessionContextWindow(models, 0)).toBe(2000000);
    });

    // NOTE: the tests below assert the post-ratchet-fix behaviour.
    // resolveSessionContextWindow is now a deprecated delegator to
    // contextWindowResolver.resolveContextWindow — observed tokens
    // are treated as a LOWER BOUND and snapped to the next known
    // tier (200K -> 1M -> 2M), never returned raw. See
    // tests/unit/contextWindowResolver.test.js for the full matrix.

    it('snaps observed tokens to next tier when they exceed standard limit', () => {
        const models = ['claude-opus-4-6'];
        expect(resolveSessionContextWindow(models, 250000)).toBe(1000000);
    });

    it('alias limit wins over observed tokens when both present', () => {
        const models = ['claude-opus-4-6'];
        expect(resolveSessionContextWindow(models, 250000, 1000000)).toBe(1000000);
    });

    it('observed > alias: snap to next tier above the highest signal', () => {
        const models = ['claude-opus-4-6'];
        // Old behaviour returned the raw observed value (1500000). New
        // behaviour: alias wins as authoritative, so we get 1M.
        expect(resolveSessionContextWindow(models, 1500000, 1000000)).toBe(1000000);
    });

    it('returns 200K when observed tokens exactly at boundary', () => {
        expect(resolveSessionContextWindow(['claude-opus-4-6'], 200000)).toBe(STANDARD_LIMIT);
    });

    it('snaps to 1M when observed is just over 200K', () => {
        // Old behaviour returned the raw 200001. New behaviour snaps
        // to the next known tier (1M) because 200001 is not itself a
        // valid context window size.
        expect(resolveSessionContextWindow(['claude-opus-4-6'], 200001)).toBe(1000000);
    });

    it('returns 200K for empty model list with low tokens', () => {
        expect(resolveSessionContextWindow([], 0)).toBe(STANDARD_LIMIT);
    });

    it('snaps to 1M for empty model list with high observed tokens', () => {
        // Old behaviour returned the raw 300000. New: snap to 1M tier.
        expect(resolveSessionContextWindow([], 300000)).toBe(1000000);
    });

    it('returns alias limit for empty model list', () => {
        expect(resolveSessionContextWindow([], 0, 1000000)).toBe(1000000);
    });

    it('returns 200K for null/undefined models', () => {
        expect(resolveSessionContextWindow(null, 0)).toBe(STANDARD_LIMIT);
        expect(resolveSessionContextWindow(undefined, 0)).toBe(STANDARD_LIMIT);
    });

    // Eligibility signal — Bug 1: s1mAccessCache says the account
    // qualifies for 1M context even though no observed token has
    // confirmed it yet. In the new resolver this is the `cc-eligibility`
    // path at priority 6.
    it('returns 1M from eligibility signal alone', () => {
        expect(resolveSessionContextWindow(['claude-opus-4-6'], 0, 0, 1000000)).toBe(1000000);
    });

    it('returns 1M from eligibility even when alias unset and observed is low', () => {
        expect(resolveSessionContextWindow(['claude-opus-4-6'], 50000, 0, 1000000)).toBe(1000000);
    });

    it('eligibility wins over observed even with observed above eligibility', () => {
        // Old behaviour preferred observed (1500000). New: eligibility
        // says 1M authoritatively, so the limit stays at 1M. Observed
        // is treated as a lower bound that can't exceed a known tier.
        expect(resolveSessionContextWindow(['claude-opus-4-6'], 1500000, 0, 1000000)).toBe(1000000);
    });

    it('prefers eligibility when observed is below standard', () => {
        expect(resolveSessionContextWindow(['claude-opus-4-6'], 100000, 0, 1000000)).toBe(1000000);
    });

    it('zero eligibility is treated as no signal', () => {
        expect(resolveSessionContextWindow(['claude-opus-4-6'], 0, 0, 0)).toBe(STANDARD_LIMIT);
    });
});

describe('getPlanContextSummary', () => {
    it('returns default entry', () => {
        const summary = getPlanContextSummary();
        expect(summary).toHaveLength(1);
        expect(summary[0]).toEqual({ label: 'Default', limit: STANDARD_LIMIT });
    });
});

describe('constants', () => {
    it('STANDARD_LIMIT is 200K', () => {
        expect(STANDARD_LIMIT).toBe(200000);
    });

    it('FALLBACK_LIMIT equals STANDARD_LIMIT', () => {
        expect(FALLBACK_LIMIT).toBe(STANDARD_LIMIT);
    });
});
