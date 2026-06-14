// selectDeviceCookies picks the device/anti-abuse cookies we carry between
// logins so a repeated login looks like a returning device. It MUST keep only
// device/IP-scoped cookies (never account/session-scoped) and MUST drop expired
// ones (hygiene, not session-expiry enforcement).

import { describe, it, expect } from 'vitest';
const { selectDeviceCookies } = require('../../src/httpFetcher');

const NOW = 1_000_000; // arbitrary "now" in unix seconds

const deviceId = { name: 'anthropic-device-id', value: 'dev-123', expires: NOW + 99999, domain: '.claude.ai', path: '/' };
const cfClearance = { name: 'cf_clearance', value: 'cf-abc', expires: NOW + 1800, domain: '.claude.ai', path: '/' };
const cfBm = { name: '__cf_bm', value: 'bm-xyz', expires: -1, domain: '.claude.ai', path: '/' }; // session cookie
const sessionKey = { name: 'sessionKey', value: 'sk-ant-sid02-secret', expires: NOW + 99999, domain: '.claude.ai', path: '/' };
const sessionKeyLC = { name: 'sessionKeyLC', value: 'lc-secret', expires: NOW + 99999, domain: '.claude.ai', path: '/' };
const lastActiveOrg = { name: 'lastActiveOrg', value: 'org-uuid', expires: NOW + 99999, domain: '.claude.ai', path: '/' };

describe('selectDeviceCookies', () => {
    it('returns [] for non-array input', () => {
        expect(selectDeviceCookies(null, NOW)).toEqual([]);
        expect(selectDeviceCookies(undefined, NOW)).toEqual([]);
    });

    it('returns [] for an empty cookie jar', () => {
        expect(selectDeviceCookies([], NOW)).toEqual([]);
    });

    it('keeps allowlisted device cookies', () => {
        const out = selectDeviceCookies([deviceId, cfClearance], NOW);
        expect(out.map(c => c.name).sort()).toEqual(['anthropic-device-id', 'cf_clearance']);
    });

    it('NEVER keeps account/session-scoped cookies', () => {
        const out = selectDeviceCookies([sessionKey, sessionKeyLC, lastActiveOrg, deviceId], NOW);
        const names = out.map(c => c.name);
        expect(names).toContain('anthropic-device-id');
        expect(names).not.toContain('sessionKey');
        expect(names).not.toContain('sessionKeyLC');
        expect(names).not.toContain('lastActiveOrg');
    });

    it('drops expired device cookies but keeps live ones', () => {
        const expiredCf = { ...cfClearance, expires: NOW - 1 };
        const out = selectDeviceCookies([deviceId, expiredCf], NOW);
        expect(out.map(c => c.name)).toEqual(['anthropic-device-id']);
    });

    it('keeps session cookies (expires -1) and zero-expiry as non-expiring', () => {
        const zeroExp = { ...cfClearance, name: '_cfuvid', expires: 0 };
        const out = selectDeviceCookies([cfBm, zeroExp], NOW);
        expect(out.map(c => c.name).sort()).toEqual(['__cf_bm', '_cfuvid']);
    });

    it('preserves the full cookie object for faithful re-injection', () => {
        const [out] = selectDeviceCookies([deviceId], NOW);
        expect(out).toEqual(deviceId);
    });
});
