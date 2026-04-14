// Tests for selectMembership — picks the right org for claude.ai usage
// fetching when a user has multiple memberships.
//
// The bug this guards against: /api/bootstrap returns an account with
// multiple memberships (e.g. an Anthropic Console API org AND a
// personal claude.ai Max subscription). The old code picked
// memberships[0] blindly, which was the API-only org for many users,
// causing /api/organizations/{apiOrgId}/usage to 401 and get misclassified
// as SESSION_EXPIRED — triggering a pointless login flow.

import { describe, it, expect } from 'vitest';
const { selectMembership } = require('../../src/httpFetcher');

const apiOnlyOrg = {
    organization: {
        uuid: 'api-org-uuid',
        name: 'HyperSec',
        capabilities: ['api'],
    },
};

const maxPersonalOrg = {
    organization: {
        uuid: 'max-personal-uuid',
        name: "Derek's Organization",
        capabilities: ['chat', 'claude_max'],
    },
};

const proOrg = {
    organization: {
        uuid: 'pro-uuid',
        name: "Jane's Organization",
        capabilities: ['chat', 'claude_pro'],
    },
};

const teamOrg = {
    organization: {
        uuid: 'team-uuid',
        name: 'Acme Inc',
        capabilities: ['chat', 'claude_team'],
    },
};

const freeOrg = {
    organization: {
        uuid: 'free-uuid',
        name: "Alex's Organization",
        capabilities: ['chat'],
    },
};

const legacyOrgNoCapabilities = {
    organization: {
        uuid: 'legacy-uuid',
        name: "Legacy Org",
        // No capabilities field — older bootstrap shape
    },
};

describe('selectMembership', () => {
    describe('empty / invalid input', () => {
        it('returns null for empty array', () => {
            expect(selectMembership([])).toBeNull();
        });

        it('returns null for null input', () => {
            expect(selectMembership(null)).toBeNull();
        });

        it('returns null for undefined input', () => {
            expect(selectMembership(undefined)).toBeNull();
        });

        it('returns null for non-array input', () => {
            expect(selectMembership({})).toBeNull();
        });
    });

    describe('single membership', () => {
        it('returns the only membership when it is claude.ai', () => {
            expect(selectMembership([maxPersonalOrg])).toBe(maxPersonalOrg);
        });

        it('returns the only membership even if it is API-only', () => {
            expect(selectMembership([apiOnlyOrg])).toBe(apiOnlyOrg);
        });

        it('returns the only membership if capabilities missing', () => {
            expect(selectMembership([legacyOrgNoCapabilities])).toBe(legacyOrgNoCapabilities);
        });
    });

    describe('API org + claude.ai org — the primary bug case', () => {
        it('prefers claude.ai org over API-only when API is first', () => {
            expect(selectMembership([apiOnlyOrg, maxPersonalOrg])).toBe(maxPersonalOrg);
        });

        it('prefers claude.ai org over API-only when claude.ai is first', () => {
            expect(selectMembership([maxPersonalOrg, apiOnlyOrg])).toBe(maxPersonalOrg);
        });

        it('prefers Pro subscription over API-only', () => {
            expect(selectMembership([apiOnlyOrg, proOrg])).toBe(proOrg);
        });

        it('prefers Team subscription over API-only', () => {
            expect(selectMembership([apiOnlyOrg, teamOrg])).toBe(teamOrg);
        });

        it('prefers Free subscription over API-only', () => {
            expect(selectMembership([apiOnlyOrg, freeOrg])).toBe(freeOrg);
        });
    });

    describe('all memberships API-only', () => {
        it('falls back to first membership when no claude.ai org exists', () => {
            const m1 = { organization: { uuid: 'api-1', capabilities: ['api'] } };
            const m2 = { organization: { uuid: 'api-2', capabilities: ['api'] } };
            expect(selectMembership([m1, m2])).toBe(m1);
        });
    });

    describe('credsOrgId priority', () => {
        it('picks the membership matching credsOrgId when claude.ai-capable', () => {
            const result = selectMembership([apiOnlyOrg, maxPersonalOrg, proOrg], 'pro-uuid');
            expect(result).toBe(proOrg);
        });

        it('ignores credsOrgId when it matches API-only org and claude.ai alternatives exist', () => {
            // Even if CLI is on API org, we can't fetch usage there — use claude.ai alternative
            const result = selectMembership([apiOnlyOrg, maxPersonalOrg], 'api-org-uuid');
            expect(result).toBe(maxPersonalOrg);
        });

        it('ignores credsOrgId when it does not match any membership', () => {
            const result = selectMembership([apiOnlyOrg, maxPersonalOrg], 'unknown-uuid');
            expect(result).toBe(maxPersonalOrg);
        });

        it('accepts credsOrgId when all memberships are API-only', () => {
            const m1 = { organization: { uuid: 'api-1', capabilities: ['api'] } };
            const m2 = { organization: { uuid: 'api-2', capabilities: ['api'] } };
            expect(selectMembership([m1, m2], 'api-2')).toBe(m2);
        });
    });

    describe('unknown shapes', () => {
        it('treats missing capabilities field as claude.ai (permissive)', () => {
            // If API shape changes and drops capabilities, don't break existing users
            expect(selectMembership([apiOnlyOrg, legacyOrgNoCapabilities])).toBe(legacyOrgNoCapabilities);
        });

        it('handles malformed membership entries gracefully', () => {
            const garbage = { organization: null };
            // Garbage has null organization, which means capabilities read is null
            // (not Array), so we treat it as claude.ai. That's safe — the bug it
            // prevents (API-only misclassification) does not apply to malformed
            // entries, and the fetch will fail later with a clear error.
            expect(selectMembership([apiOnlyOrg, garbage])).toBe(garbage);
        });

        it('does not pick membership whose capabilities is empty array', () => {
            const emptyCaps = { organization: { uuid: 'empty-uuid', capabilities: [] } };
            // Empty capabilities array — not claude.ai, falls back to first
            expect(selectMembership([emptyCaps, maxPersonalOrg])).toBe(maxPersonalOrg);
        });

        it('handles claude_* tokens that do not end in a known plan name', () => {
            // Future-proof: if Anthropic ships claude_studio or similar
            const future = { organization: { uuid: 'future-uuid', capabilities: ['claude_studio'] } };
            expect(selectMembership([apiOnlyOrg, future])).toBe(future);
        });
    });

    describe('multiple claude.ai memberships', () => {
        it('returns first claude.ai membership when no credsOrgId', () => {
            expect(selectMembership([apiOnlyOrg, maxPersonalOrg, proOrg])).toBe(maxPersonalOrg);
        });

        it('picks credsOrgId match among multiple claude.ai memberships', () => {
            expect(
                selectMembership([apiOnlyOrg, maxPersonalOrg, proOrg], 'pro-uuid')
            ).toBe(proOrg);
        });
    });
});
