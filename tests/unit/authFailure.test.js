// Tests for the auth-failure vocabulary (#57). One message and one remedy for
// every failure was the dead end: a login that succeeds but persists a blank
// token must not be answered with "click to log in", because following that
// advice reproduces the state.

import { describe, it, expect } from 'vitest';
const {
    AUTH_FAILURES,
    AUTH_REASONS,
    describeAuthFailure,
    summariseAuthFailure,
    classifyRejection,
} = require('../../src/authFailure');

describe('authFailure - the prompt is gated on whether login can help', () => {
    it('offers login when there is simply no token', () => {
        expect(describeAuthFailure(AUTH_REASONS.NO_TOKEN).canRelogin).toBe(true);
    });

    it('withholds it for a stored blank token, which re-login reproduces', () => {
        expect(describeAuthFailure(AUTH_REASONS.TOKEN_BLANK).canRelogin).toBe(false);
    });

    it('withholds it when an env credential is displacing the store', () => {
        expect(describeAuthFailure(AUTH_REASONS.ENV_OVERRIDE).canRelogin).toBe(false);
    });

    it('tells the blank-token user what to try instead of logging in', () => {
        const { lines } = describeAuthFailure(AUTH_REASONS.TOKEN_BLANK);
        expect(lines.join(' ')).toContain('claude auth logout');
    });

    it('degrades an unknown reason to not-logged-in rather than throwing', () => {
        const described = describeAuthFailure('SOMETHING_NEW');
        expect(described.reason).toBe(AUTH_REASONS.NO_TOKEN);
        expect(described.canRelogin).toBe(true);
    });
});

// The three context kinds render differently. Sharing one field rendered an
// HTTP cause as a directory ("Looked in: token rejected").
describe('authFailure - context renders by kind, not position', () => {
    it('names the displacing credential first for an override', () => {
        const { lines } = describeAuthFailure(AUTH_REASONS.ENV_OVERRIDE, { override: 'ANTHROPIC_API_KEY' });
        expect(lines[0]).toContain('ANTHROPIC_API_KEY');
    });

    it('reports the directory it searched', () => {
        const { lines } = describeAuthFailure(AUTH_REASONS.NO_TOKEN, { lookedIn: '/home/u/.claude' });
        expect(lines).toContain('Looked in: /home/u/.claude');
    });

    it('never renders an error cause as a directory', () => {
        for (const cause of ['token rejected', 'API_ERROR_429', 'FETCH_TIMEOUT', 'HTTP 403']) {
            const { lines } = describeAuthFailure(AUTH_REASONS.TOKEN_EXPIRED, { cause });
            expect(lines.some((l) => l.startsWith('Looked in:'))).toBe(false);
            expect(lines.join(' ')).toContain(cause);
        }
    });

    it('omits both lines when there is no context', () => {
        const { lines } = describeAuthFailure(AUTH_REASONS.NO_TOKEN);
        expect(lines.some((l) => l.startsWith('Looked in:'))).toBe(false);
        expect(lines.some((l) => l.startsWith('Reported by Claude:'))).toBe(false);
    });

    it('still accepts a bare string as the directory, for older callers', () => {
        const { lines } = describeAuthFailure(AUTH_REASONS.NO_TOKEN, '/x/.claude');
        expect(lines).toContain('Looked in: /x/.claude');
    });
});

describe('authFailure - one-line summary', () => {
    it('appends the click-to-log-in call only where login helps', () => {
        expect(summariseAuthFailure(AUTH_REASONS.NO_TOKEN)).toContain('Click to log in.');
        expect(summariseAuthFailure(AUTH_REASONS.TOKEN_BLANK)).not.toContain('Click to log in.');
    });
});

// A producer emitting a name with no entry degrades to the not-logged-in
// wording, which is the failure this module exists to end.
describe('authFailure - the vocabulary has one owner', () => {
    it('has an entry for every reason a producer can emit', () => {
        for (const name of Object.values(AUTH_REASONS)) {
            expect(AUTH_FAILURES[name]).toBeDefined();
        }
    });

    it('only ever returns reasons that resolve', () => {
        const emitted = [
            classifyRejection(403, false),
            classifyRejection(401, false),
            classifyRejection(401, true),
        ];
        for (const reason of emitted) {
            expect(describeAuthFailure(reason).reason).toBe(reason);
        }
    });
});

describe('authFailure.classifyRejection', () => {
    it('reads a 403 as a missing scope, which a token refresh can drop', () => {
        expect(classifyRejection(403, false)).toBe(AUTH_REASONS.SCOPE_MISSING);
        expect(classifyRejection(403, true)).toBe(AUTH_REASONS.SCOPE_MISSING);
    });

    it('reads a 401 on a live token as a rejected token', () => {
        expect(classifyRejection(401, false)).toBe(AUTH_REASONS.TOKEN_REJECTED);
    });

    it('reads a 401 on an already-expired token as stale rather than wrong', () => {
        expect(classifyRejection(401, true)).toBe(AUTH_REASONS.TOKEN_EXPIRED);
    });

    it('sends a scope failure and a rejection to different advice', () => {
        const scope = describeAuthFailure(classifyRejection(403, false));
        const rejected = describeAuthFailure(classifyRejection(401, false));
        expect(scope.title).not.toBe(rejected.title);
    });
});
