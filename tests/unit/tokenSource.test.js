// Tests for tokenSource.chooseToken - the file (npm CLI) vs Keychain (native
// install) credential precedence that issue #50 exercised on macOS: a stale,
// expired ~/.claude/.credentials.json must not shadow a valid Keychain token.

import { describe, it, expect } from 'vitest';
const { chooseToken } = require('../../src/tokenSource');

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
