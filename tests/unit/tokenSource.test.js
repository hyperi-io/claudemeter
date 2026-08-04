// Tests for tokenSource.chooseToken - the file (npm CLI) vs Keychain (native
// install) credential precedence that issue #50 exercised on macOS: a stale,
// expired ~/.claude/.credentials.json must not shadow a valid Keychain token.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { createHash } = require('crypto');
const {
    chooseToken,
    hasUsableToken,
    classifyEmptyRead,
    keychainServiceName,
    KEYCHAIN_SERVICE,
} = require('../../src/tokenSource');

const valid = (source) => ({ ok: true, token: `${source}-tok`, source, expired: false });
const stale = (source) => ({ ok: true, token: `${source}-tok`, source, expired: true });

describe('tokenSource.chooseToken - npm(file) vs native(Keychain) precedence (#50)', () => {
    it('prefers a valid Keychain token over a stale expired file token', () => {
        expect(chooseToken(stale('file'), valid('keychain')).source).toBe('keychain');
    });

    it('uses the file token when there is no Keychain token (Linux/Windows, opted-out macOS)', () => {
        expect(chooseToken(valid('file'), null).source).toBe('file');
    });

    it('prefers the Keychain when both stores hold valid tokens (native live store)', () => {
        expect(chooseToken(valid('file'), valid('keychain')).source).toBe('keychain');
    });

    it('prefers a valid file token when only the Keychain token is expired', () => {
        expect(chooseToken(valid('file'), stale('keychain')).source).toBe('file');
    });

    it('falls back to an expired file token when the Keychain has none', () => {
        expect(chooseToken(stale('file'), null).source).toBe('file');
    });

    it('prefers the Keychain when both tokens are expired', () => {
        expect(chooseToken(stale('file'), stale('keychain')).source).toBe('keychain');
    });

    it('returns null when neither store has a token', () => {
        expect(chooseToken(null, null)).toBeNull();
    });
});

// Claude Code can persist a credential item whose tokens are empty strings
// after a successful OAuth (#57, anthropics/claude-code#83345). It parses
// fine, so presence alone is not evidence of a login.
describe('tokenSource.hasUsableToken - a store can exist and hold nothing', () => {
    it('rejects an empty-string access token', () => {
        expect(hasUsableToken({ accessToken: '' })).toBe(false);
    });

    it('rejects a missing or non-string access token', () => {
        expect(hasUsableToken({})).toBe(false);
        expect(hasUsableToken({ accessToken: null })).toBe(false);
        expect(hasUsableToken({ accessToken: 12345 })).toBe(false);
    });

    it('rejects an absent blob', () => {
        expect(hasUsableToken(null)).toBe(false);
    });

    it('rejects a whitespace-only token rather than sending it as a Bearer', () => {
        expect(hasUsableToken({ accessToken: '   ' })).toBe(false);
    });

    it('accepts a real token', () => {
        expect(hasUsableToken({ accessToken: 'sk-ant-oat-x' })).toBe(true);
    });
});

describe('tokenSource.classifyEmptyRead - blank store vs no store', () => {
    it('reports a blank store as TOKEN_BLANK, naming which one', () => {
        expect(classifyEmptyRead(null, { accessToken: '' }))
            .toEqual({ reason: 'TOKEN_BLANK', source: 'keychain' });
        expect(classifyEmptyRead({ accessToken: '' }, null))
            .toEqual({ reason: 'TOKEN_BLANK', source: 'file' });
    });

    it('reports NO_TOKEN only when neither store exists', () => {
        expect(classifyEmptyRead(null, null)).toEqual({ reason: 'NO_TOKEN' });
    });

    // A store that is merely unparseable or some other shape is not the
    // blank-token state, and must keep the login offer that would fix it.
    it('does not call a non-oauth store blank', () => {
        for (const shape of [{}, [], { mcpOAuth: {} }, { refreshToken: 'x' }]) {
            expect(classifyEmptyRead(shape, null)).toEqual({ reason: 'NO_TOKEN' });
        }
    });

    // Only an empty STRING is the failed-persist state. Any other type under
    // that key is a store of some other shape and must not inherit the
    // "logging in again will not help" advice.
    it('does not call a non-string accessToken blank', () => {
        for (const value of [null, undefined, 12345, {}, [], false]) {
            expect(classifyEmptyRead({ accessToken: value }, null))
                .toEqual({ reason: 'NO_TOKEN' });
        }
    });

    it('treats a whitespace-only token as the blank state', () => {
        expect(classifyEmptyRead({ accessToken: '  ' }, null).reason).toBe('TOKEN_BLANK');
    });

    it('prefers the Keychain when both stores are blank', () => {
        const both = classifyEmptyRead({ accessToken: '' }, { accessToken: '' });
        expect(both.source).toBe('keychain');
    });
});

// Claude Code scopes the Keychain item to the config dir by appending the
// first 8 hex of sha256 over it. Derived rather than searched for: a search
// matches on resemblance and would adopt a different config dir's account.
describe('tokenSource.keychainServiceName - derived, never searched', () => {
    const sha8 = (s) => createHash('sha256').update(s).digest('hex').substring(0, 8);
    const saved = {};

    beforeEach(() => {
        saved.dir = process.env.CLAUDE_CONFIG_DIR;
        saved.secure = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
        delete process.env.CLAUDE_CONFIG_DIR;
        delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    });

    afterEach(() => {
        for (const [key, name] of [['dir', 'CLAUDE_CONFIG_DIR'], ['secure', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']]) {
            if (saved[key] === undefined) delete process.env[name];
            else process.env[name] = saved[key];
        }
    });

    it('uses the unsuffixed name for the default config dir', () => {
        expect(keychainServiceName()).toBe(KEYCHAIN_SERVICE);
    });

    // Pinned to a literal rather than recomputed with the implementation's own
    // algorithm, so changing the hash function fails this test.
    it('appends the config dir hash when CLAUDE_CONFIG_DIR is set', () => {
        process.env.CLAUDE_CONFIG_DIR = '/tmp/work-claude';
        expect(keychainServiceName()).toBe('Claude Code-credentials-f58c28f9');
    });

    it('gives two different config dirs two different items', () => {
        process.env.CLAUDE_CONFIG_DIR = '/tmp/a';
        const first = keychainServiceName();
        process.env.CLAUDE_CONFIG_DIR = '/tmp/b';
        expect(keychainServiceName()).not.toBe(first);
    });

    // Claude Code normalises the config dir before hashing it, so a decomposed
    // path and its composed form must resolve to the SAME item. A path copied
    // out of the shell on APFS arrives decomposed.
    it('resolves a decomposed path to the same item as its composed form', () => {
        const composed = '/tmp/café-claude';
        const decomposed = '/tmp/café-claude';
        expect(decomposed).not.toBe(composed);
        process.env.CLAUDE_CONFIG_DIR = composed;
        const fromComposed = keychainServiceName();
        process.env.CLAUDE_CONFIG_DIR = decomposed;
        expect(keychainServiceName()).toBe(fromComposed);
    });

    it('prefers CLAUDE_SECURESTORAGE_CONFIG_DIR over the config dir', () => {
        process.env.CLAUDE_CONFIG_DIR = '/tmp/ignored';
        process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '/tmp/secure';
        expect(keychainServiceName()).toBe(`${KEYCHAIN_SERVICE}-${sha8('/tmp/secure')}`);
    });

    it('normalises the secure-storage dir too', () => {
        process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '/tmp/café';
        expect(keychainServiceName()).toBe(`${KEYCHAIN_SERVICE}-${sha8('/tmp/café')}`);
    });

    // An empty CLAUDE_SECURESTORAGE_CONFIG_DIR means the default store in
    // Claude Code's own resolution, so the unsuffixed item is the right one.
    it('treats an empty secure-storage dir as the default store', () => {
        process.env.CLAUDE_CONFIG_DIR = '/tmp/ignored';
        process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = '';
        expect(keychainServiceName()).toBe(KEYCHAIN_SERVICE);
    });
});
