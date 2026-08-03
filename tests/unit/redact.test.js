// SECURITY.md commits the state dump to carrying no account name and no email,
// and calls a change that adds identifying data to it a defect. These tests
// hold that as an executable invariant rather than a promise in a document.

import { describe, it, expect } from 'vitest';
const { redactIdentity, describeOrgNameShape, IDENTITY_FIELDS } = require('../../src/redact');

const REAL_ACCOUNT = {
    accountUuid: 'e1f2a3b4-0000-0000-0000-000000000000',
    organizationUuid: '9c8d7e6f-0000-0000-0000-000000000000',
    emailAddress: 'someone@example.com',
    displayName: 'Some One',
    organizationName: "someone@example.com's Organization",
    organizationRole: 'admin',
    organizationType: 'claude_max',
    rateLimitTier: 'default_claude_max_20x',
};

describe('redactIdentity - nothing identifying survives', () => {
    it('removes every identity value from a real-shaped account', () => {
        const serialised = JSON.stringify(redactIdentity(REAL_ACCOUNT));
        for (const leak of ['someone@example.com', 'Some One', 'e1f2a3b4', '9c8d7e6f']) {
            expect(serialised).not.toContain(leak);
        }
    });

    it('reports presence instead, so a report is still diagnosable', () => {
        const out = redactIdentity(REAL_ACCOUNT);
        expect(out.hasEmailAddress).toBe(true);
        expect(out.hasDisplayName).toBe(true);
        expect(out.hasAccountUuid).toBe(true);
    });

    it('keeps the non-identifying descriptors the tier resolver needs', () => {
        const out = redactIdentity(REAL_ACCOUNT);
        expect(out.organizationType).toBe('claude_max');
        expect(out.rateLimitTier).toBe('default_claude_max_20x');
        expect(out.organizationRole).toBe('admin');
    });

    it('distinguishes a personal org from a named one without naming it', () => {
        expect(redactIdentity(REAL_ACCOUNT).organizationNameShape).toBe('personal-pattern');
        expect(redactIdentity({ organizationName: 'Acme Pty Ltd' }).organizationNameShape).toBe('custom');
    });

    it('reports absence as false rather than dropping the key', () => {
        const out = redactIdentity({ emailAddress: null, organizationType: 'claude_pro' });
        expect(out.hasEmailAddress).toBe(false);
    });

    it('handles a missing or non-object account', () => {
        expect(redactIdentity(null)).toBeNull();
        expect(redactIdentity(undefined)).toBeNull();
        expect(redactIdentity('nope')).toBeNull();
    });

    it('covers both spellings of the account and org name fields', () => {
        const out = redactIdentity({ email: 'a@b.c', orgName: 'Acme', name: 'A B' });
        expect(JSON.stringify(out)).not.toContain('a@b.c');
        expect(JSON.stringify(out)).not.toContain('Acme');
        expect(JSON.stringify(out)).not.toContain('A B');
    });

    it('leaves no identity field name in the output', () => {
        const out = redactIdentity(REAL_ACCOUNT);
        for (const field of IDENTITY_FIELDS) {
            expect(Object.prototype.hasOwnProperty.call(out, field)).toBe(false);
        }
    });
});

describe('describeOrgNameShape', () => {
    it('matches both the s and z spellings Anthropic emits', () => {
        expect(describeOrgNameShape("x@y.z's Organization")).toBe('personal-pattern');
        expect(describeOrgNameShape("x@y.z's Organisation")).toBe('personal-pattern');
    });

    it('returns null for an absent name', () => {
        expect(describeOrgNameShape(null)).toBeNull();
        expect(describeOrgNameShape('')).toBeNull();
    });
});
