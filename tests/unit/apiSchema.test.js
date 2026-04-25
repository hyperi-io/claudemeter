import { describe, it, expect } from 'vitest';
const {
    getNestedValue,
    extractFromSchema,
    processOverageData,
    processPrepaidData,
    calculateResetTime,
    processApiResponse,
    getSchemaInfo,
    matchesEndpoint,
    API_ENDPOINTS,
} = require('../../src/apiSchema');

describe('getNestedValue', () => {
    it('retrieves top-level value', () => {
        expect(getNestedValue({ foo: 42 }, 'foo')).toBe(42);
    });

    it('retrieves nested value', () => {
        expect(getNestedValue({ a: { b: { c: 'deep' } } }, 'a.b.c')).toBe('deep');
    });

    it('returns default for missing path', () => {
        expect(getNestedValue({ a: 1 }, 'b', 'default')).toBe('default');
    });

    it('returns default for null obj', () => {
        expect(getNestedValue(null, 'a', 99)).toBe(99);
    });

    it('returns default for null path', () => {
        expect(getNestedValue({ a: 1 }, null, 99)).toBe(99);
    });

    it('returns null as default when no default specified', () => {
        expect(getNestedValue({ a: 1 }, 'missing')).toBeNull();
    });

    it('handles intermediate nulls', () => {
        expect(getNestedValue({ a: null }, 'a.b', 'fallback')).toBe('fallback');
    });
});

describe('extractFromSchema', () => {
    it('extracts flat fields', () => {
        const schema = { isEnabled: { path: 'is_enabled', type: 'boolean', default: false } };
        const result = extractFromSchema({ is_enabled: true }, schema);
        expect(result.isEnabled).toBe(true);
    });

    it('extracts grouped fields', () => {
        const schema = {
            fiveHour: {
                utilization: { path: 'five_hour.utilization', type: 'percent', default: 0 },
                resetsAt: { path: 'five_hour.resets_at', type: 'time', default: null },
            }
        };
        const response = { five_hour: { utilization: 42, resets_at: '2026-03-17T12:00:00Z' } };
        const result = extractFromSchema(response, schema);
        expect(result.fiveHour.utilization).toBe(42);
        expect(result.fiveHour.resetsAt).toBe('2026-03-17T12:00:00Z');
    });

    it('uses defaults for missing data', () => {
        const schema = {
            fiveHour: {
                utilization: { path: 'five_hour.utilization', type: 'percent', default: 0 },
            }
        };
        const result = extractFromSchema({}, schema);
        expect(result.fiveHour.utilization).toBe(0);
    });
});

describe('processOverageData', () => {
    it('returns null for null input', () => {
        expect(processOverageData(null)).toBeNull();
    });

    it('returns null when not enabled', () => {
        expect(processOverageData({ is_enabled: false })).toBeNull();
    });

    it('converts cents to dollars and calculates percentage', () => {
        const result = processOverageData({
            is_enabled: true,
            monthly_credit_limit: 10000,
            used_credits: 3314,
            currency: 'AUD',
            out_of_credits: false,
        });
        expect(result.limit).toBe(100);
        expect(result.used).toBe(33.14);
        expect(result.currency).toBe('AUD');
        expect(result.percent).toBe(33);
        expect(result.outOfCredits).toBe(false);
    });

    it('handles zero limit without division by zero', () => {
        const result = processOverageData({
            is_enabled: true,
            monthly_credit_limit: 0,
            used_credits: 0,
            currency: 'USD',
        });
        expect(result.percent).toBe(0);
    });
});

describe('processPrepaidData', () => {
    it('returns null for null input', () => {
        expect(processPrepaidData(null)).toBeNull();
    });

    it('returns null for zero balance', () => {
        expect(processPrepaidData({ remaining_credits: 0 })).toBeNull();
    });

    it('converts cents to dollars', () => {
        const result = processPrepaidData({ remaining_credits: 5000, currency: 'USD' });
        expect(result.balance).toBe(50);
        expect(result.currency).toBe('USD');
    });

    it('tries alternative field names', () => {
        expect(processPrepaidData({ balance: 1000 }).balance).toBe(10);
        expect(processPrepaidData({ credit_balance: 2000 }).balance).toBe(20);
        expect(processPrepaidData({ available_credits: 3000 }).balance).toBe(30);
    });

    it('defaults currency to USD', () => {
        const result = processPrepaidData({ remaining_credits: 100 });
        expect(result.currency).toBe('USD');
    });
});

describe('calculateResetTime', () => {
    it('returns Unknown for null/undefined', () => {
        expect(calculateResetTime(null)).toBe('Unknown');
        expect(calculateResetTime(undefined)).toBe('Unknown');
    });

    it('returns Soon for past timestamps', () => {
        const past = new Date(Date.now() - 60000).toISOString();
        expect(calculateResetTime(past)).toBe('Soon');
    });

    it('returns minutes format for < 1 hour', () => {
        const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const result = calculateResetTime(future);
        expect(result).toMatch(/^\d+m$/);
    });

    it('returns hours and minutes for < 24 hours', () => {
        const future = new Date(Date.now() + 3 * 60 * 60 * 1000 + 15 * 60 * 1000).toISOString();
        const result = calculateResetTime(future);
        expect(result).toMatch(/^\d+h \d+m$/);
    });

    it('returns days and hours for > 24 hours', () => {
        const future = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString();
        const result = calculateResetTime(future);
        expect(result).toMatch(/^\d+d \d+h$/);
    });
});

describe('processApiResponse', () => {
    it('builds standardised response from raw API data', () => {
        const apiData = {
            five_hour: { utilization: 16, resets_at: new Date(Date.now() + 3600000).toISOString() },
            seven_day: { utilization: 13, resets_at: new Date(Date.now() + 86400000).toISOString() },
            seven_day_sonnet: { utilization: 0, resets_at: null },
            seven_day_opus: { utilization: null, resets_at: null },
            extra_usage: null,
        };
        const accountInfo = { name: 'Test', email: 'test@example.com' };

        const result = processApiResponse(apiData, null, null, accountInfo);

        expect(result.usagePercent).toBe(16);
        expect(result.usagePercentWeek).toBe(13);
        expect(result.usagePercentSonnet).toBe(0);
        expect(result.accountInfo).toEqual(accountInfo);
        expect(result.timestamp).toBeInstanceOf(Date);
        expect(result.schemaVersion).toBe('2.0');
        expect(result.rawData).toBe(apiData);
    });

    it('includes overage data when provided', () => {
        const apiData = {
            five_hour: { utilization: 0, resets_at: null },
            seven_day: { utilization: 0, resets_at: null },
            seven_day_sonnet: { utilization: null, resets_at: null },
            seven_day_opus: { utilization: null, resets_at: null },
            extra_usage: null,
        };
        const overageData = {
            is_enabled: true,
            monthly_credit_limit: 10000,
            used_credits: 5000,
            currency: 'USD',
        };

        const result = processApiResponse(apiData, null, overageData, null);
        expect(result.monthlyCredits).not.toBeNull();
        expect(result.monthlyCredits.used).toBe(50);
        expect(result.monthlyCredits.limit).toBe(100);
    });
});

describe('matchesEndpoint', () => {
    it('matches usage endpoint', () => {
        const url = 'https://claude.ai/api/organizations/abc-123/usage';
        expect(matchesEndpoint(url, API_ENDPOINTS.usage)).toBe(true);
    });

    it('matches prepaid credits endpoint', () => {
        const url = 'https://claude.ai/api/organizations/abc-123/prepaid/credits';
        expect(matchesEndpoint(url, API_ENDPOINTS.prepaidCredits)).toBe(true);
    });

    it('does not match unrelated URLs', () => {
        expect(matchesEndpoint('https://claude.ai/chat', API_ENDPOINTS.usage)).toBe(false);
    });
});

describe('getSchemaInfo', () => {
    it('returns version string', () => {
        expect(getSchemaInfo().version).toBe('2.0');
    });

    it('returns usage field names', () => {
        const info = getSchemaInfo();
        expect(info.usageFields).toContain('fiveHour');
        expect(info.usageFields).toContain('sevenDay');
    });

    it('returns endpoint names', () => {
        expect(getSchemaInfo().endpoints).toContain('usage');
    });
});
