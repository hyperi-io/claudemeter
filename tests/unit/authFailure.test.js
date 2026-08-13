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

    // A login-less store (#61) is not the blank state: login can still fix it.
    it('offers login for a store with no login entry, plus the delete fallback', () => {
        const described = describeAuthFailure(AUTH_REASONS.STORE_NO_LOGIN);
        expect(described.canRelogin).toBe(true);
        const text = described.lines.join(' ');
        expect(text).toContain('security delete-generic-password');
        expect(text).toContain('~/.claude/.credentials.json');
    });

    it('tells the blank-token user to delete the store, not to log out', () => {
        const { lines } = describeAuthFailure(AUTH_REASONS.TOKEN_BLANK);
        const text = lines.join(' ');
        expect(text).toContain('security delete-generic-password');
        expect(text).toContain('~/.claude/.credentials.json');
        // logout is named only as a thing that does not clear it
        expect(text).toContain('so does `claude auth logout`');
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

    it('degrades on a null context rather than throwing', () => {
        expect(() => describeAuthFailure(AUTH_REASONS.NO_TOKEN, null)).not.toThrow();
    });
});

// These lines are rendered into a trusted MarkdownString, where a `command:`
// link executes on click, and the values come from the environment and from
// network error text.
describe('authFailure - markdown link syntax is neutralised', () => {
    it('escapes a command link planted in the config dir', () => {
        const { lines } = describeAuthFailure(AUTH_REASONS.NO_TOKEN, {
            lookedIn: '/tmp/[PWNED](command:workbench.action.terminal.new)',
        });
        const rendered = lines.join(' ');
        expect(rendered).not.toContain('[PWNED](command:');
        expect(rendered).toContain('\\[PWNED\\]');
    });

    it('escapes link syntax in an error cause and an override name', () => {
        expect(describeAuthFailure(AUTH_REASONS.TOKEN_EXPIRED, { cause: '[x](command:y)' })
            .lines.join(' ')).not.toContain('](command:');
        expect(describeAuthFailure(AUTH_REASONS.ENV_OVERRIDE, { override: '[x](command:y)' })
            .lines.join(' ')).not.toContain('](command:');
    });

    it('leaves an ordinary path readable', () => {
        const { lines } = describeAuthFailure(AUTH_REASONS.NO_TOKEN, { lookedIn: '/home/u/.claude' });
        expect(lines).toContain('Looked in: /home/u/.claude');
    });
});

describe('authFailure - the override is named where it is the whole message', () => {
    it('names the displacing variable in the one-line summary', () => {
        expect(summariseAuthFailure(AUTH_REASONS.ENV_OVERRIDE, { override: 'ANTHROPIC_API_KEY' }))
            .toContain('ANTHROPIC_API_KEY');
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
    // Spelled out rather than iterated over the table, so deleting a reason a
    // producer still emits fails here instead of degrading silently at runtime.
    it('has an entry for every reason the producers emit', () => {
        for (const name of ['NO_TOKEN', 'TOKEN_BLANK', 'STORE_NO_LOGIN', 'TOKEN_REJECTED',
            'SCOPE_MISSING', 'TOKEN_EXPIRED', 'ENV_OVERRIDE']) {
            expect(AUTH_FAILURES[name]).toBeDefined();
            expect(AUTH_REASONS[name]).toBe(name);
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
