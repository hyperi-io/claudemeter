import { describe, it, expect } from 'vitest';

// Smoke test for the playwright-core migration. Catches:
//   1. `require('playwright-core')` failing at module load (the
//      chromium-bidi resolution issue we worked around by pinning to
//      ^15.0.0 — see TODO.md).
//   2. Renamed / removed Playwright APIs (launchPersistentContext,
//      connectOverCDP) that the login flow + legacy scraper depend on.
//   3. The shared `BROWSER_LAUNCH_ARGS(port)` factory drifting.
//
// Does NOT launch a real browser — that's an integration test the
// extension host runs via F5. This test only verifies module surface.

const { chromium } = require('playwright-core');
const { BROWSER_UA, BROWSER_LAUNCH_ARGS } = require('../../src/utils');

describe('playwright-core surface — migration smoke', () => {
    it('exposes the chromium namespace', () => {
        expect(chromium).toBeDefined();
        expect(typeof chromium).toBe('object');
    });

    it('exposes launchPersistentContext (used by login flow + legacy scraper)', () => {
        expect(typeof chromium.launchPersistentContext).toBe('function');
    });

    it('exposes connectOverCDP (used by legacy scraper for shared-browser attach)', () => {
        expect(typeof chromium.connectOverCDP).toBe('function');
    });

    it('exposes launch (sanity-check the standard entry point)', () => {
        expect(typeof chromium.launch).toBe('function');
    });
});

describe('BROWSER_UA + BROWSER_LAUNCH_ARGS factory', () => {
    it('BROWSER_UA looks like a Chrome desktop UA', () => {
        expect(BROWSER_UA).toMatch(/Mozilla\/5\.0/);
        expect(BROWSER_UA).toMatch(/Chrome\/\d{2,3}\.0\.0\.0/);
        expect(BROWSER_UA).toMatch(/Safari\/537\.36/);
    });

    it('BROWSER_LAUNCH_ARGS injects the port and is independent per call', () => {
        const a = BROWSER_LAUNCH_ARGS(9001);
        const b = BROWSER_LAUNCH_ARGS(9002);
        expect(a).toContain('--remote-debugging-port=9001');
        expect(b).toContain('--remote-debugging-port=9002');
        // Returned arrays are independent — mutating one doesn't affect the other.
        a.push('--mutation-canary');
        expect(b).not.toContain('--mutation-canary');
    });

    it('BROWSER_LAUNCH_ARGS includes the load-bearing flags', () => {
        const args = BROWSER_LAUNCH_ARGS(0);
        // The flags that justify a shared factory: explicit window size (so
        // Chrome doesn't open tiny), shared-memory fallback, quiet first-run UX.
        expect(args).toContain('--disable-dev-shm-usage');
        expect(args).toContain('--no-first-run');
        expect(args.some(a => a.startsWith('--window-size='))).toBe(true);
    });

    it('BROWSER_LAUNCH_ARGS does not pass the AutomationControlled bad-flag', () => {
        const args = BROWSER_LAUNCH_ARGS(0);
        // It tripped Chromium's "unsupported command-line flag" banner.
        // webdriver masking moved to context.addInitScript in the login flow.
        expect(args).not.toContain('--disable-blink-features=AutomationControlled');
    });

    it('BROWSER_LAUNCH_ARGS no longer disables the Chrome sandbox', () => {
        const args = BROWSER_LAUNCH_ARGS(0);
        // Issue #37: the desktop extension does not run in a container,
        // so --no-sandbox / --disable-setuid-sandbox just triggered the
        // visible "Stability and security will suffer" Chrome warning
        // without any benefit. If they ever come back, this fails.
        expect(args).not.toContain('--no-sandbox');
        expect(args).not.toContain('--disable-setuid-sandbox');
    });
});
