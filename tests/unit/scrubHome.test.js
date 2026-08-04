// SECURITY.md and README both promise the state dump and the debug log carry
// no OS username. scrubHome is what delivers that, and it had no tests, which
// is how a Windows leak survived: JSON.stringify escapes backslashes, so a
// serialised Windows home never matched the raw one.

import { describe, it, expect } from 'vitest';
const os = require('os');
const { scrubHome } = require('../../src/utils');

const HOME = os.homedir();
const USER = (() => {
    try { return os.userInfo().username; } catch { return null; }
})();

describe('scrubHome - the home directory', () => {
    it('replaces a home-prefixed path with ~', () => {
        expect(scrubHome(`${HOME}/projects/thing`)).toBe('~/projects/thing');
    });

    it('replaces every occurrence, not just the first', () => {
        const out = scrubHome(`${HOME}/a and ${HOME}/b`);
        expect(out).toBe('~/a and ~/b');
    });

    it('passes through a non-string unchanged', () => {
        expect(scrubHome(null)).toBeNull();
        expect(scrubHome(42)).toBe(42);
    });

    it('leaves text with no home path alone', () => {
        expect(scrubHome('nothing to see')).toBe('nothing to see');
    });
});

// The state dump is scrubbed AFTER JSON.stringify, which escapes each
// backslash, so the serialised form of a Windows path is what has to be
// covered rather than the raw one.
describe('scrubHome - the JSON-escaped form', () => {
    it('strips the username from a serialised Windows-shaped path', () => {
        const winHome = 'C:\\Users\\jsmith';
        const serialised = JSON.stringify({ p: `${winHome}\\.claude\\.credentials.json` });
        const out = scrubHome(serialised.split('jsmith').join(USER || 'jsmith'));
        expect(out).not.toContain(USER || 'jsmith');
    });

    it('strips the real home from a serialised POSIX path', () => {
        const serialised = JSON.stringify({ workspacePath: `${HOME}/dev/proj` });
        expect(scrubHome(serialised)).not.toContain(HOME);
    });
});

describe('scrubHome - the username outside the home prefix', () => {
    it('strips a username that appears outside the home directory', () => {
        if (!USER) return;
        expect(scrubHome(`/mnt/c/Users/${USER}/dev`)).not.toContain(USER);
    });

    it('strips it case-insensitively', () => {
        if (!USER) return;
        expect(scrubHome(`/NET/HOME/${USER.toUpperCase()}/x`)).not.toContain(USER.toUpperCase());
    });

    // The replacement is word-bounded so a username that is also a common
    // substring cannot corrupt unrelated text.
    it('does not strip the username out of a longer word', () => {
        if (!USER) return;
        const embedded = `${USER}ology`;
        expect(scrubHome(`a ${embedded} b`)).toContain(embedded);
    });
});

// split/join is literal rather than a regex, and the username replacement
// escapes its input, so a home path containing regex metacharacters is safe.
describe('scrubHome - metacharacters are literal', () => {
    it('does not treat the home path as a pattern', () => {
        expect(scrubHome(`${HOME}/a+b(c)/d.e`)).toBe('~/a+b(c)/d.e');
    });

    it('does not corrupt text that merely resembles the home path', () => {
        expect(scrubHome('/some/other/place')).toBe('/some/other/place');
    });
});
