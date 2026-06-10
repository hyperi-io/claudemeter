// isSessionCandidate decides when the login wait spends a bootstrap call.
// It's the local gate; bootstrap is the authoritative check. See issue #42:
// the old code treated cookie presence as login success, so a pre-injected
// stale cookie closed the window before the user could log in.

import { describe, it, expect } from 'vitest';
const { isSessionCandidate } = require('../../src/httpFetcher');

describe('isSessionCandidate', () => {
    it('no sessionKey -> never a candidate', () => {
        expect(isSessionCandidate({ sessionKeyValue: null, baselineValue: 'x', requireValueChange: false, onAppPage: true })).toBe(false);
    });

    it('stale pre-injected cookie still on /login -> not a candidate (#42)', () => {
        // value unchanged, not on app -> we keep waiting, no bootstrap.
        expect(isSessionCandidate({ sessionKeyValue: 'stale', baselineValue: 'stale', requireValueChange: false, onAppPage: false })).toBe(false);
    });

    it('valid pre-injected cookie that redirected to the app -> candidate', () => {
        // value unchanged but on the app -> short-circuit; bootstrap confirms.
        expect(isSessionCandidate({ sessionKeyValue: 'valid', baselineValue: 'valid', requireValueChange: false, onAppPage: true })).toBe(true);
    });

    it('new cookie value -> candidate even if the URL still looks like login', () => {
        // robust to an SSO/callback URL we misjudge -- a changed cookie triggers it.
        expect(isSessionCandidate({ sessionKeyValue: 'fresh', baselineValue: 'stale', requireValueChange: false, onAppPage: false })).toBe(true);
    });

    it('retry: wrong-account cookie unchanged on the app -> not a candidate', () => {
        // the old cookie is valid and would re-validate instantly; demand a new one.
        expect(isSessionCandidate({ sessionKeyValue: 'wrong', baselineValue: 'wrong', requireValueChange: true, onAppPage: true })).toBe(false);
    });

    it('retry: a genuinely new cookie -> candidate', () => {
        expect(isSessionCandidate({ sessionKeyValue: 'right', baselineValue: 'wrong', requireValueChange: true, onAppPage: false })).toBe(true);
    });
});
