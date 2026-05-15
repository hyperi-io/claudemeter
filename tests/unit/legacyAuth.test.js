import { describe, it, expect, beforeEach } from 'vitest';

const { ClaudeAuth } = require('../../src/legacyAuth');

// _isAlive() duck-types its handle param — scraper.js passes either a
// Playwright Browser (CDP-connect path, has isConnected()) or a
// BrowserContext (persistent-context path, has pages() but no
// isConnected()). Both must register as alive when healthy and dead
// when closed.

describe('legacyAuth._isAlive — duck-typed handle liveness', () => {
    let auth;
    beforeEach(() => { auth = new ClaudeAuth(); });

    it('returns false when no handle is set', () => {
        expect(auth._isAlive()).toBe(false);
    });

    it('uses isConnected() when the handle exposes it (Browser shape)', () => {
        const fakeBrowser = { isConnected: () => true };
        auth.setPageAndBrowser({}, fakeBrowser);
        expect(auth._isAlive()).toBe(true);

        // Flip the return value — simulates a disconnect
        fakeBrowser.isConnected = () => false;
        expect(auth._isAlive()).toBe(false);
    });

    it('probes pages() when handle has no isConnected (BrowserContext shape)', () => {
        const fakeContext = { pages: () => [] };
        auth.setPageAndBrowser({}, fakeContext);
        expect(auth._isAlive()).toBe(true);
    });

    it('treats pages() throwing as dead context', () => {
        const closedContext = {
            pages: () => { throw new Error('Target page, context or browser has been closed'); },
        };
        auth.setPageAndBrowser({}, closedContext);
        expect(auth._isAlive()).toBe(false);
    });

    it('prefers isConnected() over pages() when both exist', () => {
        // A handle that has both — isConnected() should win.
        let pagesCalled = false;
        const dualShape = {
            isConnected: () => true,
            pages: () => { pagesCalled = true; return []; },
        };
        auth.setPageAndBrowser({}, dualShape);
        expect(auth._isAlive()).toBe(true);
        expect(pagesCalled).toBe(false);
    });
});

describe('legacyAuth.setPageAndBrowser', () => {
    let auth;
    beforeEach(() => { auth = new ClaudeAuth(); });

    it('stores the page and handle as-is', () => {
        const page = { url: () => 'https://claude.ai' };
        const handle = { isConnected: () => true };
        auth.setPageAndBrowser(page, handle);
        expect(auth.page).toBe(page);
        expect(auth.browser).toBe(handle);
    });

    it('accepts either Browser or BrowserContext at the handle slot', () => {
        // Browser shape
        auth.setPageAndBrowser({}, { isConnected: () => true });
        expect(auth._isAlive()).toBe(true);
        // Replace with BrowserContext shape
        auth.setPageAndBrowser({}, { pages: () => [{}] });
        expect(auth._isAlive()).toBe(true);
    });
});

describe('legacyAuth.getDiagnostics', () => {
    it('reports hasPage / hasBrowser truthiness', () => {
        const auth = new ClaudeAuth();
        let diag = auth.getDiagnostics();
        expect(diag.hasPage).toBe(false);
        expect(diag.hasBrowser).toBe(false);

        auth.setPageAndBrowser({}, { isConnected: () => true });
        diag = auth.getDiagnostics();
        expect(diag.hasPage).toBe(true);
        expect(diag.hasBrowser).toBe(true);
    });
});
