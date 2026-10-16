import { describe, it, expect } from 'vitest';
const {
    parseModelId,
    parseModelAlias,
    parseContextSuffix,
    getHighestDeclaredLimit,
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

describe('constants', () => {
    it('STANDARD_LIMIT is 200K', () => {
        expect(STANDARD_LIMIT).toBe(200000);
    });
});
