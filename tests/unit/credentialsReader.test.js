import { describe, it, expect } from 'vitest';
const {
    formatSubscriptionType,
    formatRateLimitTier,
    getIdentityKey,
    identityChanged,
} = require('../../src/credentialsReader');

describe('formatSubscriptionType', () => {
    it('capitalises plan name', () => {
        expect(formatSubscriptionType('max')).toBe('Max');
        expect(formatSubscriptionType('pro')).toBe('Pro');
        expect(formatSubscriptionType('free')).toBe('Free');
    });

    it('handles mixed case input', () => {
        expect(formatSubscriptionType('MAX')).toBe('Max');
        expect(formatSubscriptionType('Pro')).toBe('Pro');
    });

    it('returns null for null/undefined', () => {
        expect(formatSubscriptionType(null)).toBeNull();
        expect(formatSubscriptionType(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(formatSubscriptionType('')).toBeNull();
    });
});

describe('formatRateLimitTier', () => {
    it('formats max 20x tier', () => {
        expect(formatRateLimitTier('default_claude_max_20x')).toBe('Max 20x');
    });

    it('formats max 5x tier', () => {
        expect(formatRateLimitTier('default_claude_max_5x')).toBe('Max 5x');
    });

    it('formats pro tier', () => {
        expect(formatRateLimitTier('default_claude_pro')).toBe('Pro');
    });

    it('formats free tier', () => {
        expect(formatRateLimitTier('default_claude_free')).toBe('Free');
    });

    it('returns raw string for unrecognised format', () => {
        expect(formatRateLimitTier('something_else')).toBe('something_else');
    });

    it('returns null for null/undefined', () => {
        expect(formatRateLimitTier(null)).toBeNull();
        expect(formatRateLimitTier(undefined)).toBeNull();
    });
});

describe('getIdentityKey', () => {
    it('returns tuple with all three fields present', () => {
        const key = getIdentityKey({
            accountUuid: 'acc-1',
            email: 'user@x.com',
            orgId: 'org-1',
        });
        expect(key).toEqual({
            accountUuid: 'acc-1',
            email: 'user@x.com',
            orgId: 'org-1',
        });
    });

    it('returns null for null/undefined credentials', () => {
        expect(getIdentityKey(null)).toBeNull();
        expect(getIdentityKey(undefined)).toBeNull();
    });

    it('returns null if all three fields missing', () => {
        expect(getIdentityKey({ foo: 'bar' })).toBeNull();
        expect(getIdentityKey({ accountUuid: null, email: null, orgId: null })).toBeNull();
    });

    it('returns partial tuple when only one field present', () => {
        expect(getIdentityKey({ accountUuid: 'acc-1' })).toEqual({
            accountUuid: 'acc-1',
            email: null,
            orgId: null,
        });
        expect(getIdentityKey({ email: 'user@x.com' })).toEqual({
            accountUuid: null,
            email: 'user@x.com',
            orgId: null,
        });
    });
});

describe('identityChanged', () => {
    const a = { accountUuid: 'acc-1', email: 'user@x.com', orgId: 'org-1' };
    const b = { accountUuid: 'acc-2', email: 'user@x.com', orgId: 'org-1' };
    const c = { accountUuid: 'acc-1', email: 'other@x.com', orgId: 'org-1' };
    const d = { accountUuid: 'acc-1', email: 'user@x.com', orgId: 'org-2' };

    it('returns false for same tuple', () => {
        expect(identityChanged(a, { ...a })).toBe(false);
    });

    it('returns true when accountUuid differs', () => {
        expect(identityChanged(a, b)).toBe(true);
    });

    it('returns true when email differs', () => {
        expect(identityChanged(a, c)).toBe(true);
    });

    it('returns true when orgId differs', () => {
        expect(identityChanged(a, d)).toBe(true);
    });

    it('returns false when either key is null (no signal)', () => {
        expect(identityChanged(null, a)).toBe(false);
        expect(identityChanged(a, null)).toBe(false);
        expect(identityChanged(null, null)).toBe(false);
    });

    it('detects personal → personal switch via accountUuid alone', () => {
        const personal1 = { accountUuid: 'acc-alice', email: null, orgId: null };
        const personal2 = { accountUuid: 'acc-bob', email: null, orgId: null };
        expect(identityChanged(personal1, personal2)).toBe(true);
    });
});
