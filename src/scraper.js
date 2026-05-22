// Project:   Claudemeter
// File:      scraper.js
// Purpose:   Legacy browser automation for fetching Claude.ai usage data
// Language:  JavaScript (CommonJS)
//
// LEGACY FALLBACK: This module is retained as an opt-in emergency fallback
// because the HTTP fetcher relies on undocumented, internal Claude.ai API
// endpoints (/usage, /prepaid/credits, /overage_spend_limit) that have no
// public documentation or stability guarantees. Anthropic could change, gate,
// or remove these endpoints at any time without notice. If that happens, this
// browser-based scraper can still extract usage data by intercepting API
// requests or scraping the rendered HTML — adapting to page-level changes that
// would break the direct HTTP approach.
//
// Enable via "claudemeter.useLegacyScraper": true in settings.
// This requires a Chromium-based browser installed on the system.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// playwright-core's chromium namespace is lazy-loaded so the legacy path
// has no runtime cost when claudemeter.useLegacyScraper is unset.
let _chromium = null;
function getChromium() {
    if (!_chromium) _chromium = require('playwright-core').chromium;
    return _chromium;
}
const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

const { ClaudeAuth } = require('./legacyAuth');
const { findChrome } = require('./httpFetcher');
const {
    CONFIG_NAMESPACE,
    PATHS,
    TIMEOUTS,
    VIEWPORT,
    BROWSER_UA,
    BROWSER_LAUNCH_ARGS,
    CLAUDE_URLS,
    isDebugEnabled,
    getDebugChannel,
    setDevMode,
    sleep,
    fileLog,
    findAvailablePort,
} = require('./utils');

// Browser lock: simple file-based mutex (replaces proper-lockfile)
const BROWSER_LOCK_TTL = 360000; // 6 minutes
const BROWSER_LOCK_POLL = 1000;  // 1 second
const BROWSER_LOCK_RETRIES = 90; // 90 seconds max wait

// Shared browser state across all VS Code windows
// States: 'ready' (session valid), 'login_failed' (all go token-only), 'logging_in' (wait)
const BrowserState = {
    read() {
        try {
            if (fs.existsSync(PATHS.BROWSER_STATE_FILE)) {
                const data = JSON.parse(fs.readFileSync(PATHS.BROWSER_STATE_FILE, 'utf-8'));
                // State expires after 5 minutes to allow retry
                if (data.timestamp && Date.now() - data.timestamp < 300000) {
                    return data;
                }
            }
        } catch (e) { /* ignore */ }
        return { state: 'unknown', timestamp: 0 };
    },

    write(state, reason = null) {
        try {
            const dir = path.dirname(PATHS.BROWSER_STATE_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(PATHS.BROWSER_STATE_FILE, JSON.stringify({
                state,
                reason,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('Failed to write browser state:', e.message);
        }
    },

    clear() {
        try {
            if (fs.existsSync(PATHS.BROWSER_STATE_FILE)) {
                fs.unlinkSync(PATHS.BROWSER_STATE_FILE);
            }
        } catch (e) { /* ignore */ }
    }
};
const {
    API_ENDPOINTS,
    matchesEndpoint,
    processApiResponse,
    getSchemaInfo,
} = require('./apiSchema');


class ClaudeUsageScraper {
    constructor() {
        this.browser = null;   // Playwright `Browser` (set only after CDP connect)
        this.context = null;   // Playwright `BrowserContext` (always set when alive)
        this.page = null;
        this.isInitialized = false;
        this.browserPort = null;
        this.isConnectedBrowser = false;

        this.apiEndpoint = null;
        this.apiHeaders = null;
        this.creditsEndpoint = null;
        this.overageEndpoint = null;
        this.capturedEndpoints = [];

        this.currentOrgId = null;
        this.accountInfo = null;

        this.auth = new ClaudeAuth();
        this.releaseBrowserLock = null;
    }

    get sessionDir() {
        return this.auth.getSessionDir();
    }

    // Acquire exclusive lock for browser operations (login, headed browser launch)
    // Other instances wait until lock is released or times out
    async acquireBrowserLock() {
        if (this.releaseBrowserLock) {
            fileLog('Already holding browser lock, skipping acquire');
            return true;
        }

        const debug = isDebugEnabled();
        const lockFile = PATHS.BROWSER_LOCK_FILE;
        const dir = path.dirname(lockFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (debug) {
            getDebugChannel().appendLine('Acquiring browser lock...');
        }
        fileLog('Attempting to acquire browser lock...');

        for (let i = 0; i < BROWSER_LOCK_RETRIES; i++) {
            try {
                if (fs.existsSync(lockFile)) {
                    const data = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
                    if (Date.now() - data.timestamp < BROWSER_LOCK_TTL) {
                        await sleep(BROWSER_LOCK_POLL);
                        continue;
                    }
                }
            } catch {
                // Corrupt lock file, safe to overwrite
            }

            // Acquire the lock
            fs.writeFileSync(lockFile, JSON.stringify({ timestamp: Date.now(), pid: process.pid }));
            this.releaseBrowserLock = () => {
                try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch { /* ignore */ }
            };
            if (debug) {
                getDebugChannel().appendLine('Browser lock acquired');
            }
            fileLog('Browser lock acquired');
            return true;
        }

        fileLog('Failed to acquire browser lock: timeout');
        throw new Error('Browser busy (another Claudemeter instance is using the browser). Please wait and retry.');
    }

    async releaseBrowserLockIfHeld() {
        if (this.releaseBrowserLock) {
            const debug = isDebugEnabled();
            try {
                this.releaseBrowserLock();
                this.releaseBrowserLock = null;
                if (debug) {
                    getDebugChannel().appendLine('Browser lock released');
                }
                fileLog('Browser lock released');
            } catch (error) {
                // Lock may have been compromised or already released
                if (debug) {
                    getDebugChannel().appendLine(`Error releasing browser lock: ${error.message}`);
                }
                fileLog(`Error releasing browser lock: ${error.message}`);
            }
        }
    }

    async findAvailablePort() {
        return findAvailablePort();
    }

    // Delegate to shared browser detection in httpFetcher.js
    findChrome() {
        return findChrome();
    }

    async tryConnectToExisting() {
        try {
            const browserURL = `http://127.0.0.1:${this.browserPort}`;
            this.browser = await getChromium().connectOverCDP(browserURL);
            // CDP-connected browser exposes pre-existing contexts; pick the
            // first one. Playwright auto-attaches to all of them.
            this.context = this.browser.contexts()[0] || await this.browser.newContext();

            const pages = this.context.pages();
            if (pages.length > 0) {
                for (const p of pages) {
                    const url = p.url();
                    if (url.includes(CLAUDE_URLS.BASE)) {
                        this.page = p;
                        break;
                    }
                }
                if (!this.page) {
                    this.page = pages[0];
                }
            } else {
                this.page = await this.context.newPage();
            }

            // User-Agent header for already-running browsers is set at the
            // context level. Cannot be retroactively changed on an existing
            // CDP-attached Chrome instance, so this is best-effort — if the
            // header doesn't stick the captured API endpoints still work.
            try {
                await this.context.setExtraHTTPHeaders({
                    'User-Agent': BROWSER_UA,
                });
            } catch (_uaErr) {
                // not fatal
            }

            await this.setupRequestInterception();

            this.isInitialized = true;
            this.isConnectedBrowser = true;
            this.auth.setPageAndBrowser(this.page, this.browser);

            console.log('Successfully connected to existing browser');
            return true;
        } catch (error) {
            console.log('Could not connect to existing browser:', error.message);
            return false;
        }
    }

    hasExistingSession() {
        return this.auth.hasExistingSession();
    }

    async initialize(forceHeaded = false) {
        if (this.isInitialized && this.context) {
            try {
                // Liveness probe: pages() throws if the context is closed.
                this.context.pages();
                return;
            } catch (error) {
                this.browser = null;
                this.context = null;
                this.page = null;
                this.isInitialized = false;
            }
        }

        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const userHeadless = config.get('headless', true);
        const headless = forceHeaded ? false : userHeadless;

        // Acquire lock before launching browser - only one instance can use the userDataDir at a time
        await this.acquireBrowserLock();
        fileLog('Browser lock acquired for initialize()');

        // Small delay after acquiring lock to ensure previous browser fully terminated
        // This prevents race conditions with userDataDir cleanup
        await sleep(1000);

        try {
            const chromePath = this.findChrome();

            if (!chromePath) {
                throw new Error('CHROME_NOT_FOUND');
            }

            this.browserPort = await this.findAvailablePort();

            const launchOptions = {
                headless,
                executablePath: chromePath,
                timeout: 60000,
                args: BROWSER_LAUNCH_ARGS(this.browserPort),
                viewport: { width: VIEWPORT.WIDTH, height: VIEWPORT.HEIGHT },
                userAgent: BROWSER_UA,
            };

            console.log(`Launching Chrome on port ${this.browserPort}`);
            // launchPersistentContext both spawns the browser AND returns the
            // first context. We treat the context as our primary handle —
            // there is no separate Browser object in this mode.
            this.context = await getChromium().launchPersistentContext(this.sessionDir, launchOptions);
            this.browser = null;
            this.page = this.context.pages()[0] || await this.context.newPage();

            await this.setupRequestInterception();

            this.isInitialized = true;
            this.isConnectedBrowser = false;
            this.auth.setPageAndBrowser(this.page, this.context);

            console.log('Successfully launched new browser');
        } catch (error) {
            // Release lock on failure
            await this.releaseBrowserLockIfHeld();
            if (error.message.includes('already running')) {
                throw new Error('Browser session is locked by another process. Please close all Chrome/Edge windows and try again, or restart VSCode.');
            }
            throw new Error(`Failed to launch browser: ${error.message}. Make sure Chromium is installed.`);
        }
    }

    async ensureLoggedIn() {
        const debug = isDebugEnabled();
        const debugChannel = getDebugChannel();

        debugChannel.appendLine(`\n=== AUTH FLOW (${new Date().toLocaleString()}) ===`);

        // Check shared state first - coordinate with other instances
        const sharedState = BrowserState.read();
        debugChannel.appendLine(`Auth: Shared state: ${sharedState.state} (reason: ${sharedState.reason || 'none'})`);

        if (sharedState.state === 'logging_in') {
            // Another instance is currently logging in - skip this fetch cycle
            // Don't wait/block, just bail and try on next auto-refresh
            debugChannel.appendLine('Auth: Another instance is logging in, skipping this fetch cycle');
            fileLog('Skipping fetch - another instance is logging in');
            throw new Error('LOGIN_IN_PROGRESS');
        }

        if (sharedState.state === 'login_failed') {
            debugChannel.appendLine('Auth: Another instance recently failed login, skipping to token-only mode');
            fileLog('Skipping fetch - login failed in another instance');
            throw new Error('LOGIN_FAILED_SHARED');
        }

        try {
            const hasSession = this.auth.hasExistingSession();
            debugChannel.appendLine(`Auth: Session files exist: ${hasSession}`);

            if (!hasSession) {
                debugChannel.appendLine('Auth: No session files found, opening login browser immediately');
                await this.openLoginBrowser();
                return;
            }

            debugChannel.appendLine('Auth: Starting session validation...');
            const validation = await this.auth.validateSession();
            debugChannel.appendLine(`Auth: Validation result: ${JSON.stringify(validation)}`);

            if (validation.valid) {
                if (debug) {
                    getDebugChannel().appendLine('Auth: Session valid (fast path)');
                }
                if (validation.account) {
                    this.accountInfo = validation.account;
                    if (debug) {
                        getDebugChannel().appendLine(`Auth: Account: ${validation.account.name || 'unknown'}`);
                    }
                }
                // Clear any previous failed state - session is now valid
                BrowserState.clear();
                await this.page.goto(CLAUDE_URLS.USAGE, {
                    waitUntil: 'networkidle',
                    timeout: TIMEOUTS.PAGE_LOAD
                });
                return;
            }

            // Only force login for definite session issues (no cookie or expired)
            // For transient errors (network issues, server errors), try the fetch anyway
            const definitivelyNoSession = ['no_cookie', 'cookie_expired', 'no_page'].includes(validation.reason);

            if (definitivelyNoSession) {
                if (debug) {
                    getDebugChannel().appendLine(`Auth: Session definitely invalid (${validation.reason}), need login`);
                }
                await this.openLoginBrowser();
                return;
            }

            // For server_rejected or validation_error, try fetching anyway - cookies might still work
            if (debug) {
                getDebugChannel().appendLine(`Auth: Validation uncertain (${validation.reason}), attempting fetch anyway`);
            }
            debugChannel.appendLine(`Auth: Validation uncertain (${validation.reason}), trying fetch with existing cookies`);

            try {
                await this.page.goto(CLAUDE_URLS.USAGE, {
                    waitUntil: 'networkidle',
                    timeout: TIMEOUTS.PAGE_LOAD
                });
                // If we get here without error, the session worked
                BrowserState.clear();
                return;
            } catch (fetchError) {
                // Fetch failed - now we need login
                debugChannel.appendLine(`Auth: Fetch with existing cookies failed: ${fetchError.message}`);
                await this.openLoginBrowser();
            }
        } catch (error) {
            debugChannel.appendLine(`Auth: ERROR - ${error.message}`);
            if (error.message.includes('timeout')) {
                throw new Error('Failed to load Claude.ai. Please check your internet connection.');
            }
            throw error;
        }
    }

    async openLoginBrowser() {
        const debugChannel = getDebugChannel();

        // Acquire lock before opening headed browser - other instances will wait
        await this.acquireBrowserLock();

        // Mark that we're attempting login - other instances will see this
        BrowserState.write('logging_in');
        fileLog('Starting login flow - marked state as logging_in');

        try {
            const browserResult = await this.forceOpenBrowser();
            if (!browserResult.success) {
                BrowserState.write('login_failed', 'browser_launch_failed');
                throw new Error(browserResult.message);
            }

            const loginResult = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Login required. Please log in to Claude.ai in the browser window...',
                    cancellable: false
                },
                async () => {
                    return await this.auth.waitForLogin();
                }
            );

            if (loginResult.success) {
                // Clear failed state - all instances can now use the session
                BrowserState.clear();
                fileLog('Login successful - cleared shared state');

                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: '✓ Login successful! Session saved.',
                        cancellable: false
                    },
                    () => new Promise(resolve => setTimeout(resolve, 3000))
                );

                await this.close();
                await this.initialize(false);

                await this.page.goto(CLAUDE_URLS.USAGE, {
                    waitUntil: 'networkidle',
                    timeout: TIMEOUTS.PAGE_LOAD
                });

                debugChannel.appendLine('Auth: Login successful, switched to headless mode');
            } else if (loginResult.cancelled) {
                debugChannel.appendLine('Auth: Login cancelled by user');
                BrowserState.write('login_failed', 'user_cancelled');
                fileLog('Login cancelled by user');
                await this.close();
                throw new Error('LOGIN_CANCELLED');
            } else {
                BrowserState.write('login_failed', 'timeout');
                fileLog('Login timed out');
                await this.close();
                throw new Error('LOGIN_TIMEOUT');
            }
        } catch (error) {
            // Ensure failed state is written for any error
            if (!error.message.includes('LOGIN_CANCELLED') && !error.message.includes('LOGIN_TIMEOUT')) {
                BrowserState.write('login_failed', error.message);
            }
            throw error;
        } finally {
            // Always release lock after login attempt (success or failure)
            await this.releaseBrowserLockIfHeld();
        }
    }

    async setupRequestInterception() {
        try {
            // Playwright's unified routing model: page.route() registers a
            // handler that MUST call route.continue() (or abort/fulfil) for
            // each request, replacing puppeteer's setRequestInterception +
            // request-event pair.
            this.capturedEndpoints = [];

            await this.page.route('**/*', (route) => {
                // Defensive: the body below mostly just observes the
                // request, but `matchesEndpoint`, URL parsing, or
                // `request.headers()` could throw on malformed routes.
                // If the handler errors without calling route.continue()
                // the request hangs forever and the page stalls. Wrap
                // the body in try/finally so the request always
                // continues, even if observation throws.
                try {
                    const request = route.request();
                    const url = request.url();

                    if (url.includes('/api/')) {
                        if (isDebugEnabled()) {
                            getDebugChannel().appendLine(`[REQUEST] ${request.method()} ${url}`);
                        }
                        this.capturedEndpoints.push({ method: request.method(), url });
                    }

                    if (matchesEndpoint(url, API_ENDPOINTS.usage)) {
                        this.apiEndpoint = url;
                        this.apiHeaders = {
                            ...request.headers(),
                            'Content-Type': 'application/json'
                        };

                        const orgMatch = url.match(/\/organizations\/([a-f0-9-]+)\//);
                        if (orgMatch) {
                            const newOrgId = orgMatch[1];
                            if (this.currentOrgId && this.currentOrgId !== newOrgId) {
                                console.log(`Claudemeter: Org changed from ${this.currentOrgId} to ${newOrgId}`);
                                if (isDebugEnabled()) {
                                    getDebugChannel().appendLine(`Account change detected: ${this.currentOrgId} → ${newOrgId}`);
                                }
                            }
                            this.currentOrgId = newOrgId;
                        }

                        console.log('Captured usage endpoint:', this.apiEndpoint);
                    }

                    if (matchesEndpoint(url, API_ENDPOINTS.prepaidCredits)) {
                        this.creditsEndpoint = url;
                        console.log('Captured credits endpoint:', this.creditsEndpoint);
                    }

                    if (matchesEndpoint(url, API_ENDPOINTS.overageSpendLimit)) {
                        this.overageEndpoint = url;
                        console.log('Captured overage endpoint:', this.overageEndpoint);
                    }
                } catch (handlerErr) {
                    if (isDebugEnabled()) {
                        getDebugChannel().appendLine(`Route handler error (continuing anyway): ${handlerErr.message}`);
                    }
                } finally {
                    route.continue();
                }
            });

            this.page.on('response', async (response) => {
                const url = response.url();

                if (isDebugEnabled() && url.includes('/api/') && response.status() === 200) {
                    try {
                        const contentType = response.headers()['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            const data = await response.json();
                            const debugOutput = getDebugChannel();
                            debugOutput.appendLine(`[RESPONSE] ${url}`);
                            debugOutput.appendLine(JSON.stringify(data, null, 2));
                            debugOutput.appendLine('---');
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            });

            console.log('Request interception enabled for API capture');
        } catch (error) {
            console.warn('Failed to set up request interception:', error.message);
        }
    }

    processApiResponse(apiResponse, creditsData = null, overageData = null) {
        return processApiResponse(apiResponse, creditsData, overageData, this.accountInfo);
    }

    async fetchUsageData() {
        const debug = isDebugEnabled();

        try {
            await this.page.goto(CLAUDE_URLS.USAGE, {
                waitUntil: 'networkidle',
                timeout: TIMEOUTS.PAGE_LOAD
            });

            await sleep(TIMEOUTS.API_RETRY_DELAY);

            if (debug) {
                const debugOutput = getDebugChannel();
                debugOutput.appendLine(`\n=== FETCH ATTEMPT (${new Date().toLocaleString()}) ===`);
                debugOutput.appendLine(`API endpoint captured: ${this.apiEndpoint ? 'YES' : 'NO'}`);
                debugOutput.appendLine(`Credits endpoint captured: ${this.creditsEndpoint ? 'YES' : 'NO'}`);
                debugOutput.appendLine(`Overage endpoint captured: ${this.overageEndpoint ? 'YES' : 'NO'}`);
            }

            if (this.apiEndpoint && this.apiHeaders) {
                try {
                    console.log('Using captured API endpoint for direct access');
                    if (debug) getDebugChannel().appendLine('Attempting direct API fetch...');

                    // Cookies are owned by the BrowserContext in Playwright;
                    // page.cookies() doesn't exist. context.cookies() returns
                    // all cookies for the context (no filter argument
                    // required at this call site).
                    const cookies = await this.page.context().cookies();
                    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                    // Playwright's page.evaluate accepts ONE argument (not
                    // a variadic list like puppeteer). Multiple values are
                    // passed as a single object and destructured inside.
                    const response = await this.page.evaluate(async ({ endpoint, headers, cookieStr }) => {
                        const resp = await fetch(endpoint, {
                            method: 'GET',
                            headers: { ...headers, 'Cookie': cookieStr }
                        });
                        if (!resp.ok) throw new Error(`API request failed: ${resp.status}`);
                        return await resp.json();
                    }, { endpoint: this.apiEndpoint, headers: this.apiHeaders, cookieStr: cookieString });

                    if (debug) {
                        getDebugChannel().appendLine('Direct API fetch SUCCESS!');
                        getDebugChannel().appendLine(JSON.stringify(response, null, 2));
                    }

                    let creditsData = null;
                    let overageData = null;

                    if (this.creditsEndpoint) {
                        try {
                            creditsData = await this.page.evaluate(async ({ endpoint, headers, cookieStr }) => {
                                const resp = await fetch(endpoint, {
                                    method: 'GET',
                                    headers: { ...headers, 'Cookie': cookieStr }
                                });
                                return resp.ok ? await resp.json() : null;
                            }, { endpoint: this.creditsEndpoint, headers: this.apiHeaders, cookieStr: cookieString });
                            if (debug && creditsData) {
                                getDebugChannel().appendLine(`Prepaid credits response: ${JSON.stringify(creditsData)}`);
                            }
                        } catch (e) {
                            if (debug) getDebugChannel().appendLine(`Credits fetch error: ${e.message}`);
                        }
                    }

                    if (this.overageEndpoint) {
                        try {
                            overageData = await this.page.evaluate(async ({ endpoint, headers, cookieStr }) => {
                                const resp = await fetch(endpoint, {
                                    method: 'GET',
                                    headers: { ...headers, 'Cookie': cookieStr }
                                });
                                return resp.ok ? await resp.json() : null;
                            }, { endpoint: this.overageEndpoint, headers: this.apiHeaders, cookieStr: cookieString });
                        } catch (e) {
                            if (debug) getDebugChannel().appendLine(`Overage fetch error: ${e.message}`);
                        }
                    }

                    console.log('Successfully fetched data via API');
                    return this.processApiResponse(response, creditsData, overageData);

                } catch (apiError) {
                    console.log('API call failed, falling back to HTML scraping:', apiError.message);
                    if (debug) getDebugChannel().appendLine(`Direct API fetch FAILED: ${apiError.message}`);
                }
            }

            // Fallback: HTML scraping
            console.log('Using HTML scraping method');
            if (debug) getDebugChannel().appendLine('Falling back to HTML scraping...');

            const data = await this.page.evaluate(() => {
                const bodyText = document.body.innerText;
                const usageMatch = bodyText.match(/(\d+)%\s*used/i);
                const resetMatch = bodyText.match(/Resets?\s+in\s+([^\n]+)/i);
                return {
                    usagePercent: usageMatch ? parseInt(usageMatch[1], 10) : null,
                    resetTime: resetMatch ? resetMatch[1].trim() : null
                };
            });

            if (data.usagePercent === null) {
                throw new Error('Could not find usage percentage. Page layout may have changed.');
            }

            return {
                usagePercent: data.usagePercent,
                resetTime: data.resetTime || 'Unknown',
                timestamp: new Date()
            };

        } catch (error) {
            if (error.message.includes('timeout')) {
                throw new Error('Usage page took too long to load. Please try again.');
            }
            throw error;
        }
    }

    async close() {
        try {
            if (this.isConnectedBrowser && this.browser) {
                // Closing a CDP-connected Browser detaches our process from
                // the Chrome instance without killing it — same semantic as
                // puppeteer's disconnect().
                await this.browser.close();
                console.log('Disconnected from shared browser');
            } else if (this.context) {
                // launchPersistentContext owns the browser; context.close()
                // shuts both down. playwright-core doesn't expose the
                // underlying process PID, so SIGKILL fallback is gone —
                // race against a 5s timeout and let the OS handle any
                // orphan Chrome processes (rare in practice).
                const closePromise = this.context.close();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Browser close timeout')), 5000)
                );
                try {
                    await Promise.race([closePromise, timeoutPromise]);
                    console.log('Closed browser instance');
                } catch (e) {
                    fileLog(`Browser close timed out: ${e.message}`);
                    await sleep(1000);
                }
            }
            this.browser = null;
            this.context = null;
            this.page = null;
            this.isInitialized = false;
            this.isConnectedBrowser = false;
        } finally {
            // Always release the lock when closing
            await this.releaseBrowserLockIfHeld();
        }
    }

    async reset() {
        const debug = isDebugEnabled();
        if (debug) {
            getDebugChannel().appendLine(`\n=== RESET CONNECTION (${new Date().toLocaleString()}) ===`);
        }

        await this.close();

        this.apiEndpoint = null;
        this.apiHeaders = null;
        this.creditsEndpoint = null;
        this.overageEndpoint = null;
        this.capturedEndpoints = [];
        this.currentOrgId = null;
        this.accountInfo = null;

        // Clear browser session (cookies) so next fetch forces fresh login
        await this.auth.clearSession();

        if (debug) {
            getDebugChannel().appendLine('Browser connection closed');
            getDebugChannel().appendLine('All captured API endpoints cleared');
            getDebugChannel().appendLine('Browser session cleared');
        }

        return { success: true, message: 'Connection reset and session cleared. Next fetch will require login.' };
    }

    async clearSession() {
        return await this.reset();
    }

    async forceOpenBrowser() {
        const debug = isDebugEnabled();
        if (debug) {
            getDebugChannel().appendLine(`\n=== FORCE OPEN BROWSER (${new Date().toLocaleString()}) ===`);
        }

        try {
            if (this.context || this.browser) {
                try {
                    if (this.isConnectedBrowser && this.browser) {
                        await this.browser.close();  // CDP detach
                    } else if (this.context) {
                        await this.context.close();  // persistent context teardown
                    }
                } catch (e) {
                    // Ignore close errors
                }
                this.browser = null;
                this.context = null;
                this.page = null;
                this.isInitialized = false;
            }

            const chromePath = this.findChrome();

            if (!chromePath) {
                throw new Error('CHROME_NOT_FOUND');
            }

            this.browserPort = await this.findAvailablePort();

            // Use the shared BROWSER_LAUNCH_ARGS so this legacy path
            // stays in lockstep with the v2 login flow. Previously this
            // block hardcoded its own arg list which kept the sandbox-
            // disabling flags around after v2.4.3 stripped them from
            // utils.js -- the leftover surfaced the "Stability and
            // security will suffer" warning in issue #37.
            const launchOptions = {
                headless: false,
                executablePath: chromePath,
                args: BROWSER_LAUNCH_ARGS(this.browserPort),
                viewport: { width: VIEWPORT.WIDTH, height: VIEWPORT.HEIGHT },
                userAgent: BROWSER_UA,
            };

            if (debug) {
                getDebugChannel().appendLine(`Launching headed Chrome browser...`);
                getDebugChannel().appendLine(`Executable: ${chromePath}`);
            }

            this.context = await getChromium().launchPersistentContext(this.sessionDir, launchOptions);
            this.browser = null;
            this.page = this.context.pages()[0] || await this.context.newPage();

            await this.setupRequestInterception();

            this.isInitialized = true;
            this.isConnectedBrowser = false;
            this.auth.setPageAndBrowser(this.page, this.context);

            await this.page.goto(CLAUDE_URLS.LOGIN, {
                waitUntil: 'networkidle',
                timeout: TIMEOUTS.INITIAL_LOGIN_PAGE_LOAD
            });

            if (debug) {
                getDebugChannel().appendLine('Browser opened successfully - awaiting login');
            }

            return { success: true, message: 'Browser opened. Please log in to Claude.ai.' };
        } catch (error) {
            if (debug) {
                getDebugChannel().appendLine(`Failed to open browser: ${error.message}`);
            }
            return { success: false, message: `Failed to open browser: ${error.message}` };
        }
    }

    getDiagnostics() {
        const schemaInfo = getSchemaInfo();
        const authDiag = this.auth.getDiagnostics();

        return {
            isInitialized: this.isInitialized,
            isConnectedBrowser: this.isConnectedBrowser,
            hasBrowser: !!this.browser,
            hasPage: !!this.page,
            hasApiEndpoint: !!this.apiEndpoint,
            hasApiHeaders: !!this.apiHeaders,
            hasCreditsEndpoint: !!this.creditsEndpoint,
            hasOverageEndpoint: !!this.overageEndpoint,
            capturedEndpointsCount: this.capturedEndpoints?.length || 0,
            currentOrgId: this.currentOrgId,
            accountName: this.accountInfo?.name || null,
            accountEmail: this.accountInfo?.email || null,
            ...authDiag,
            schemaVersion: schemaInfo.version,
            schemaFields: schemaInfo.usageFields,
            schemaEndpoints: schemaInfo.endpoints,
        };
    }
}

module.exports = {
    ClaudeUsageScraper,
    BrowserState,
    getDebugChannel,
    setDevMode
};
