import { describe, it, expect, beforeEach } from 'vitest';
const { AccountIdentityCache } = require('../../src/accountIdentityCache');

// Fixture helpers — the cache accepts the shape returned by
// credentialsReader.readCredentials(), so we match that loosely.
function creds(overrides = {}) {
    return {
        orgId: 'org-uuid-1',
        accountUuid: 'acc-uuid-1',
        email: 'user1@example.com',
        ...overrides,
    };
}

describe('AccountIdentityCache.noteCurrentIdentity', () => {
    let cache;
    beforeEach(() => { cache = new AccountIdentityCache(); });

    it('reports no change on first non-null identity', () => {
        const result = cache.noteCurrentIdentity(creds());
        expect(result.changed).toBe(false);
        expect(result.previous).toBeNull();
        expect(result.current).toEqual({
            orgId: 'org-uuid-1',
            accountUuid: 'acc-uuid-1',
            email: 'user1@example.com',
        });
    });

    it('reports no change when identity unchanged', () => {
        cache.noteCurrentIdentity(creds());
        const result = cache.noteCurrentIdentity(creds());
        expect(result.changed).toBe(false);
    });

    it('detects accountUuid change (personal → personal)', () => {
        cache.noteCurrentIdentity(creds({ accountUuid: 'acc-a', email: 'a@x.com', orgId: 'org-a' }));
        const result = cache.noteCurrentIdentity(creds({ accountUuid: 'acc-b', email: 'b@x.com', orgId: 'org-b' }));
        expect(result.changed).toBe(true);
        expect(result.previous.accountUuid).toBe('acc-a');
        expect(result.current.accountUuid).toBe('acc-b');
    });

    it('detects email change even when org unchanged', () => {
        cache.noteCurrentIdentity(creds({ email: 'first@x.com' }));
        const result = cache.noteCurrentIdentity(creds({ email: 'second@x.com' }));
        expect(result.changed).toBe(true);
    });

    it('detects orgId change even when email unchanged', () => {
        cache.noteCurrentIdentity(creds({ orgId: 'org-a' }));
        const result = cache.noteCurrentIdentity(creds({ orgId: 'org-b' }));
        expect(result.changed).toBe(true);
    });

    it('treats null credentials as unknown — no change reported', () => {
        cache.noteCurrentIdentity(creds());
        const before = cache.getCurrentIdentity();
        const result = cache.noteCurrentIdentity(null);
        expect(result.changed).toBe(false);
        // Identity preserved, not wiped
        expect(cache.getCurrentIdentity()).toEqual(before);
    });

    it('invalidates resolved web org UUID on identity change', () => {
        cache.noteCurrentIdentity(creds({ orgId: 'org-a' }));
        cache.setResolvedWebOrgId('web-org-1', { name: 'Alice' });
        expect(cache.getResolvedWebOrgId()).toBe('web-org-1');

        cache.noteCurrentIdentity(creds({ orgId: 'org-b' }));
        expect(cache.getResolvedWebOrgId()).toBeNull();
        expect(cache.getAccountInfo()).toBeNull();
    });

    it('preserves resolved web org UUID when identity unchanged', () => {
        cache.noteCurrentIdentity(creds());
        cache.setResolvedWebOrgId('web-org-1', { name: 'Alice' });

        cache.noteCurrentIdentity(creds());
        expect(cache.getResolvedWebOrgId()).toBe('web-org-1');
        expect(cache.getAccountInfo()).toEqual({ name: 'Alice' });
    });
});

describe('AccountIdentityCache.invalidateResolved', () => {
    it('clears web org UUID but keeps identity', () => {
        const cache = new AccountIdentityCache();
        cache.noteCurrentIdentity(creds());
        cache.setResolvedWebOrgId('web-org-1', { name: 'Alice' });

        cache.invalidateResolved();
        expect(cache.getResolvedWebOrgId()).toBeNull();
        expect(cache.getAccountInfo()).toBeNull();
        // Identity still known — so switch detection still works
        expect(cache.getCurrentIdentity()).not.toBeNull();
    });

    it('next noteCurrentIdentity with same identity does NOT re-trigger switch', () => {
        const cache = new AccountIdentityCache();
        cache.noteCurrentIdentity(creds());
        cache.invalidateResolved();
        const result = cache.noteCurrentIdentity(creds());
        expect(result.changed).toBe(false);
    });
});

describe('AccountIdentityCache.clear', () => {
    it('wipes everything', () => {
        const cache = new AccountIdentityCache();
        cache.noteCurrentIdentity(creds());
        cache.setResolvedWebOrgId('web-org-1', { name: 'Alice' });

        cache.clear();
        expect(cache.getCurrentIdentity()).toBeNull();
        expect(cache.getResolvedWebOrgId()).toBeNull();
        expect(cache.getAccountInfo()).toBeNull();
    });

    it('after clear, next noteCurrentIdentity is treated as first-seen', () => {
        const cache = new AccountIdentityCache();
        cache.noteCurrentIdentity(creds());
        cache.clear();
        const result = cache.noteCurrentIdentity(creds({ orgId: 'org-different' }));
        // First-seen after clear = no change, not a switch
        expect(result.changed).toBe(false);
    });
});

describe('AccountIdentityCache.toDiagnostics', () => {
    it('returns a snapshot suitable for dumpState', () => {
        const cache = new AccountIdentityCache();
        cache.noteCurrentIdentity(creds());
        cache.setResolvedWebOrgId('web-org-1', { name: 'Alice', email: 'a@x.com' });

        const diag = cache.toDiagnostics();
        expect(diag.currentIdentity.accountUuid).toBe('acc-uuid-1');
        expect(diag.resolvedWebOrgId).toBe('web-org-1');
        expect(diag.accountInfo.name).toBe('Alice');
    });
});
