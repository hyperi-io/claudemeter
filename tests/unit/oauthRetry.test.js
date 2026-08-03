// Tests for retry-candidate selection after a rejected token. A rejection in
// the preferred store must not dead-end while the other store holds a good
// token (#50), and the retry must not spend a second round of requests
// re-sending a token the first round already proved bad.

import { describe, it, expect } from 'vitest';
const { pickRetryCandidates } = require('../../src/oauthFetcher');

const tok = (source, token, expired = false) => ({ ok: true, token, source, expired });

describe('oauthFetcher.pickRetryCandidates', () => {
    it('never retries the token that was just refused', () => {
        const stores = { keychain: tok('keychain', 'A'), file: tok('file', 'B') };
        expect(pickRetryCandidates('A', stores).map((c) => c.token)).toEqual(['B']);
    });

    it('sends nothing when both stores hold the refused token', () => {
        const stores = { keychain: tok('keychain', 'A'), file: tok('file', 'A') };
        expect(pickRetryCandidates('A', stores)).toEqual([]);
    });

    it('de-duplicates when both stores hold the same replacement token', () => {
        const stores = { keychain: tok('keychain', 'NEW'), file: tok('file', 'NEW') };
        expect(pickRetryCandidates('OLD', stores)).toHaveLength(1);
    });

    it('skips an expired candidate rather than spending a request on it', () => {
        const stores = { keychain: tok('keychain', 'B', true), file: tok('file', 'C') };
        expect(pickRetryCandidates('A', stores).map((c) => c.token)).toEqual(['C']);
    });

    it('tries the Keychain before the file, matching read precedence', () => {
        const stores = { keychain: tok('keychain', 'K'), file: tok('file', 'F') };
        expect(pickRetryCandidates('A', stores).map((c) => c.source)).toEqual(['keychain', 'file']);
    });

    it('handles a store being absent', () => {
        expect(pickRetryCandidates('A', { keychain: null, file: tok('file', 'B') })).toHaveLength(1);
        expect(pickRetryCandidates('A', { keychain: null, file: null })).toEqual([]);
    });

    it('caps the work at one attempt per store', () => {
        const stores = { keychain: tok('keychain', 'K'), file: tok('file', 'F') };
        expect(pickRetryCandidates('A', stores).length).toBeLessThanOrEqual(2);
    });
});
