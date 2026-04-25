// Project:   Claudemeter v2 (Streamlined)
// File:      httpFetcher.js
// Purpose:   HTTP-based Claude.ai usage data fetching (replaces browser automation)
// Language:  JavaScript (CommonJS)
//
// v2 default fetch engine. Uses native fetch() with a stored sessionKey cookie
// and browser-like headers to call Claude.ai API endpoints directly. A browser
// (via puppeteer-core) is only launched once for the initial login to obtain
// the cookie. Subsequent fetches complete in 1-3 seconds with no browser.
//
// Why puppeteer-core is retained (not removed entirely):
//
// 1. LOGIN FLOW: Claude.ai's login involves OAuth redirects, CAPTCHAs, and
//    Cloudflare challenges that cannot be replicated with plain HTTP requests.
//    A real browser is required to obtain the sessionKey cookie. puppeteer-core
//    (~2MB) drives the user's existing system browser for this — no bundled
//    Chromium needed (unlike puppeteer which ships ~200MB of Chromium).
//
// 2. UNDOCUMENTED API RISK: The three endpoints we fetch (/usage, /prepaid/credits,
//    /overage_spend_limit) are internal Claude.ai APIs with no public documentation
//    or stability guarantees. Anthropic could change, gate, or remove them at any
//    time. The legacy browser scraper (src/scraper.js) is retained as an opt-in
//    fallback that can adapt to page-level changes even if the API contract breaks.
//
// 3. MINIMAL COST: puppeteer-core adds ~2MB to the extension (vs ~200MB for full
//    puppeteer). It is lazy-loaded only when login() is called, so it has zero
//    runtime cost during normal HTTP fetch cycles.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const vscode = require('vscode');

const {
    processApiResponse,
    getSchemaInfo,
} = require('./apiSchema');

const {
    PATHS,
    TIMEOUTS,
    CLAUDE_URLS,
    isDebugEnabled,
    getDebugChannel,
    sleep,
    fileLog,
    findAvailablePort,
} = require('./utils');

const { readCredentials } = require('./credentialsReader');
const { AccountIdentityCache } = require('./accountIdentityCache');

// Browser-like headers to pass Cloudflare challenge
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Chromium";v="146", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Referer': 'https://claude.ai/settings/usage',
    'Origin': 'https://claude.ai',
};

// Chromium-based browser paths by platform (for login flow)
const CHROMIUM_BROWSERS = {
    linux: {
        'google-chrome.desktop': ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/google-chrome'],
        'chromium-browser.desktop': ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium'],
        'chromium.desktop': ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/snap/bin/chromium'],
        'brave-browser.desktop': ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave', '/opt/brave.com/brave/brave-browser'],
        'microsoft-edge.desktop': ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
        'vivaldi-stable.desktop': ['/usr/bin/vivaldi-stable', '/usr/bin/vivaldi'],
        'opera.desktop': ['/usr/bin/opera'],
    },
    darwin: {
        'com.google.chrome': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'org.chromium.chromium': '/Applications/Chromium.app/Contents/MacOS/Chromium',
        'com.brave.browser': '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        'com.microsoft.edgemac': '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        'company.thebrowser.browser': '/Applications/Arc.app/Contents/MacOS/Arc',
        'com.vivaldi.vivaldi': '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
        'com.operasoftware.opera': '/Applications/Opera.app/Contents/MacOS/Opera',
    },
    win32: {
        'chrome': 'Google\\Chrome\\Application\\chrome.exe',
        'chromium': 'Chromium\\Application\\chrome.exe',
        'brave': 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'msedge': 'Microsoft\\Edge\\Application\\msedge.exe',
        'vivaldi': 'Vivaldi\\Application\\vivaldi.exe',
        'opera': 'Opera\\launcher.exe',
    }
};

// Pick the right org membership for fetching claude.ai usage data.
//
// When a user has both an Anthropic Console (API) org and a claude.ai
// subscription (Free/Pro/Max/Team/Enterprise), /api/bootstrap returns
// multiple memberships. The API-only org has capabilities=['api'] and
// does NOT expose /api/organizations/{id}/usage — fetching from it
// returns 401, which our error heuristic misclassifies as SESSION_EXPIRED,
// triggering a pointless login flow.
//
// Selection priority:
//   1. Filter to memberships with a claude.ai capability ('chat' or any
//      'claude_*' plan token). If capabilities is missing entirely, keep
//      the membership (permissive for unknown API shapes).
//   2. Among the filtered pool, prefer a uuid exact-match against the
//      CLI creds orgId — honours the user's explicit /login choice.
//   3. Otherwise return the first filtered membership.
//   4. If the filter yields nothing (every org is API-only or empty),
//      fall back to credsOrgId match or memberships[0] — same as legacy
//      behaviour, so we don't regress edge cases.
function hasClaudeAiCapability(membership) {
    const caps = membership?.organization?.capabilities;
    // Unknown shape: keep it. Some legacy bootstrap responses may omit
    // capabilities entirely; better to try than to drop the only entry.
    if (!Array.isArray(caps)) return true;
    return caps.some(c =>
        c === 'chat' ||
        (typeof c === 'string' && c.startsWith('claude_'))
    );
}

function selectMembership(memberships, credsOrgId = null) {
    if (!Array.isArray(memberships) || memberships.length === 0) {
        return null;
    }

    const claudeAi = memberships.filter(hasClaudeAiCapability);
    const pool = claudeAi.length > 0 ? claudeAi : memberships;

    if (credsOrgId) {
        const match = pool.find(m => m?.organization?.uuid === credsOrgId);
        if (match) return match;
    }

    return pool[0];
}

// Detect organization type from bootstrap data.
// Personal accounts have org names like "Derek's Organization".
// Team/Enterprise accounts have custom org names and may expose explicit type fields.
function detectOrgType(orgName, orgObj) {
    if (orgName && /'s Organi[sz]ation$/.test(orgName)) {
        return 'Personal';
    }
    // Probe for explicit type fields (field names are speculative —
    // we don't have team/enterprise accounts to verify against)
    if (orgObj) {
        for (const key of ['organization_type', 'type', 'plan_type', 'billing_type', 'account_type']) {
            const val = orgObj[key];
            if (typeof val === 'string') {
                if (/enterprise/i.test(val)) return 'Enterprise';
                if (/team/i.test(val)) return 'Team';
                if (/personal|individual/i.test(val)) return 'Personal';
            }
        }
    }
    return null;
}

// Login lock: simple file-based mutex to prevent multiple login windows
const LOGIN_LOCK_FILE = path.join(PATHS.CONFIG_DIR, 'login-in-progress.lock');
const LOGIN_LOCK_TTL = 5 * 60 * 1000; // 5 minutes

class ClaudeHttpFetcher {
    constructor() {
        this._identityCache = new AccountIdentityCache();
        // Prime the cache from current credentials so the first fetch has a
        // baseline to detect switches against. If credentials are missing
        // (fresh install), the cache stays empty and no switch fires.
        try {
            this._identityCache.noteCurrentIdentity(readCredentials());
        } catch (err) {
            // Identity stays unknown until first successful credential read.
            // Surface the underlying reason so a credentials-file issue at
            // cold start doesn't disappear silently.
            fileLog(`Identity cache prime skipped: ${err.message}`);
        }
    }

    // Back-compat accessor: some legacy call sites and diagnostics expect
    // this.accountInfo to work as a plain property. Delegate to the cache.
    get accountInfo() {
        return this._identityCache.getAccountInfo();
    }
    set accountInfo(value) {
        this._identityCache.setResolvedWebOrgId(
            this._identityCache.getResolvedWebOrgId(),
            value
        );
    }

    // --- Cookie Management ---

    _readCookie() {
        try {
            if (!fs.existsSync(PATHS.SESSION_COOKIE_FILE)) {
                return null;
            }
            const data = JSON.parse(fs.readFileSync(PATHS.SESSION_COOKIE_FILE, 'utf-8'));
            if (!data.sessionKey) return null;
            return data;
        } catch (error) {
            fileLog(`Error reading session cookie: ${error.message}`);
            return null;
        }
    }

    _saveCookie(sessionKey, expires, orgId) {
        const dir = path.dirname(PATHS.SESSION_COOKIE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = {
            sessionKey,
            expires,
            savedAt: new Date().toISOString(),
            orgId: orgId || null,
        };
        fs.writeFileSync(PATHS.SESSION_COOKIE_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
        fileLog('Session cookie saved');
    }

    hasExistingSession() {
        const cookie = this._readCookie();
        if (!cookie) return false;
        // Check expiry if available
        if (cookie.expires && cookie.expires <= Date.now() / 1000) {
            fileLog('Session cookie expired');
            return false;
        }
        return true;
    }

    clearSession({ clearLoginBrowserCache = false } = {}) {
        try {
            if (fs.existsSync(PATHS.SESSION_COOKIE_FILE)) {
                fs.unlinkSync(PATHS.SESSION_COOKIE_FILE);
                fileLog('Session cookie deleted');
            }
            // Also clean up old browser-session dir if it exists (v1 migration)
            const oldSessionDir = path.join(PATHS.CONFIG_DIR, 'browser-session');
            if (fs.existsSync(oldSessionDir)) {
                fs.rmSync(oldSessionDir, { recursive: true, force: true });
                fileLog('Cleaned up old browser-session directory');
            }
            // On account switch, clear the login browser's cached session so the
            // browser opens fresh for the new account instead of auto-logging in
            // as the previous account.
            if (clearLoginBrowserCache) {
                const loginSessionDir = path.join(PATHS.CONFIG_DIR, 'login-session');
                if (fs.existsSync(loginSessionDir)) {
                    fs.rmSync(loginSessionDir, { recursive: true, force: true });
                    fileLog('Cleared login browser cache for account switch');
                }
            }
            this._identityCache.clear();
            return { success: true, message: 'Session cleared. Next fetch will prompt for login.' };
        } catch (error) {
            fileLog(`Error clearing session: ${error.message}`);
            return { success: false, message: `Failed to clear session: ${error.message}` };
        }
    }

    // --- HTTP Fetching ---

    // Fetch bootstrap using an explicit sessionKey (before it's saved to disk).
    async _fetchBootstrapWithKey(sessionKey) {
        const response = await fetch(`${CLAUDE_URLS.BASE}/api/bootstrap`, {
            method: 'GET',
            headers: {
                ...BROWSER_HEADERS,
                'Cookie': `sessionKey=${sessionKey}`,
            },
        });
        if (!response.ok) return null;
        return response.json();
    }

    // Fetch bootstrap using the CLI OAuth access token as a Bearer token.
    // Returns the account email if successful, null if the token doesn't work.
    async _fetchBootstrapWithCliToken() {
        const creds = readCredentials();
        if (!creds?.accessToken) return null;
        try {
            const response = await fetch(`${CLAUDE_URLS.BASE}/api/bootstrap`, {
                method: 'GET',
                headers: {
                    ...BROWSER_HEADERS,
                    'Authorization': `Bearer ${creds.accessToken}`,
                },
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data?.account?.email_address || null;
        } catch (err) {
            fileLog(`Account-email lookup failed: ${err.message}`);
            return null;
        }
    }

    async _fetchEndpoint(url) {
        const cookie = this._readCookie();
        if (!cookie) throw new Error('NO_SESSION');

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                ...BROWSER_HEADERS,
                'Cookie': `sessionKey=${cookie.sessionKey}`,
            },
        });

        if (response.status === 401 || response.status === 403) {
            // Check if it's a Cloudflare challenge vs actual auth failure
            const text = await response.text();
            if (text.includes('permission_error') || text.includes('account_session_invalid') || text.includes('"type":"error"')) {
                throw new Error('SESSION_EXPIRED');
            }
            // Cloudflare challenge or other issue
            throw new Error(`API_ERROR_${response.status}`);
        }

        if (!response.ok) {
            throw new Error(`API_ERROR_${response.status}`);
        }

        return response.json();
    }

    // Resolve the correct web org UUID via /api/bootstrap.
    // The CLI credentials orgId differs from the web session orgId.
    //
    // Before hitting the network, refresh the identity cache against the
    // current on-disk credentials. If the user switched accounts out of
    // band (another terminal, another VS Code window), this flushes the
    // stale cached web org UUID so we re-resolve against /api/bootstrap.
    async _resolveOrgId() {
        const { changed } = this._identityCache.noteCurrentIdentity(readCredentials());
        if (changed) {
            fileLog('Identity change detected before fetch — invalidating cached web org UUID');
        }

        const cached = this._identityCache.getResolvedWebOrgId();
        if (cached) return cached;

        fileLog('Resolving web org UUID via /api/bootstrap...');
        const data = await this._fetchEndpoint(`${CLAUDE_URLS.BASE}/api/bootstrap`);
        const memberships = data?.account?.memberships;
        if (!memberships || memberships.length === 0) {
            throw new Error('NO_ORG_ID');
        }

        // Pick the right membership. Falls back to memberships[0] only when
        // no claude.ai-capable org exists (all API-only) — preserves legacy
        // behaviour for edge cases without breaking the common multi-org case.
        const creds = readCredentials();
        const picked = selectMembership(memberships, creds?.orgId || null);
        const org = picked.organization;
        const orgUuid = org.uuid;
        const orgName = org.name;

        const orgType = detectOrgType(orgName, org);

        // Extract the authoritative plan signals from the org object so
        // the context-window resolver can use them. `capabilities` is
        // the clean plan-token list (e.g. ['claude_max', 'chat'] for Max,
        // ['chat'] for Free). `rate_limit_tier` carries the multiplier
        // variant (e.g. 'default_claude_max_20x') as a secondary signal.
        // Both are optional — if the API ever stops returning them the
        // resolver falls back to local credentials.
        const capabilities = Array.isArray(org.capabilities) ? org.capabilities.slice() : null;
        const webRateLimitTier = typeof org.rate_limit_tier === 'string' ? org.rate_limit_tier : null;

        const accountInfo = {
            name: data.account?.display_name || data.account?.full_name,
            email: data.account?.email_address,
            orgName,
            orgType,
            capabilities,
            webRateLimitTier,
        };
        this._identityCache.setResolvedWebOrgId(orgUuid, accountInfo);

        // Log full org object for debugging — helps discover team/enterprise fields
        const orgFields = Object.keys(org).filter(k => k !== 'uuid').join(', ');
        const capSummary = capabilities ? capabilities.join(',') : 'none';
        fileLog(`Resolved org: ${orgUuid.slice(0, 8)}... (${orgName}) type=${orgType || 'unknown'} capabilities=[${capSummary}] rate_limit_tier=${webRateLimitTier || 'none'} fields=[${orgFields}]`);
        return orgUuid;
    }

    async fetchUsageData() {
        const debug = isDebugEnabled();
        const debugChannel = getDebugChannel();

        const cookie = this._readCookie();
        if (!cookie || !cookie.sessionKey) {
            throw new Error('NO_SESSION');
        }

        // Check cookie expiry
        if (cookie.expires && cookie.expires <= Date.now() / 1000) {
            throw new Error('SESSION_EXPIRED');
        }

        // One retry on SESSION_EXPIRED: if the first attempt fails with
        // SESSION_EXPIRED, the cached web org UUID may be stale against a
        // just-switched account. Invalidate it and re-resolve once. If the
        // second attempt also fails, escalate — that's a real auth problem
        // that the user needs to resolve via login flow.
        try {
            return await this._fetchUsageDataOnce(cookie, debug, debugChannel);
        } catch (err) {
            if (err.message !== 'SESSION_EXPIRED') {
                throw err;
            }
            fileLog('SESSION_EXPIRED on first attempt — invalidating resolved org UUID and retrying once');
            this._identityCache.invalidateResolved();
            return this._fetchUsageDataOnce(cookie, debug, debugChannel);
        }
    }

    async _fetchUsageDataOnce(cookie, debug, debugChannel) {
        const orgId = await this._resolveOrgId();
        const baseUrl = `${CLAUDE_URLS.BASE}/api/organizations/${orgId}`;
        const usageUrl = `${baseUrl}/usage`;
        const creditsUrl = `${baseUrl}/prepaid/credits`;
        const overageUrl = `${baseUrl}/overage_spend_limit`;

        if (debug) {
            debugChannel.appendLine(`\n=== HTTP FETCH (${new Date().toLocaleString()}) ===`);
            debugChannel.appendLine(`Org ID: ${orgId}`);
            debugChannel.appendLine(`Account: ${this.accountInfo?.name || 'unknown'}`);
            debugChannel.appendLine(`Fetching: ${usageUrl}`);
        }

        fileLog(`Fetching usage data for org ${orgId.slice(0, 8)}...`);

        // Fetch all 3 endpoints in parallel
        const [usageResult, creditsResult, overageResult] = await Promise.allSettled([
            this._fetchEndpoint(usageUrl),
            this._fetchEndpoint(creditsUrl),
            this._fetchEndpoint(overageUrl),
        ]);

        if (usageResult.status === 'rejected') {
            const err = usageResult.reason;
            if (debug) {
                debugChannel.appendLine(`Usage fetch FAILED: ${err.message}`);
            }
            throw err;
        }

        const usageData = usageResult.value;
        const creditsData = creditsResult.status === 'fulfilled' ? creditsResult.value : null;
        const overageData = overageResult.status === 'fulfilled' ? overageResult.value : null;

        if (debug) {
            debugChannel.appendLine('Usage fetch SUCCESS');
            debugChannel.appendLine(JSON.stringify(usageData, null, 2));
            if (creditsData) debugChannel.appendLine(`Credits: ${JSON.stringify(creditsData)}`);
            if (overageData) debugChannel.appendLine(`Overage: ${JSON.stringify(overageData)}`);
        }

        fileLog('Usage data fetched successfully');

        return processApiResponse(usageData, creditsData, overageData, this.accountInfo);
    }

    // Called externally (e.g. by the watcher in extension.js) to notify the
    // fetcher that the on-disk identity may have changed. If the identity
    // tuple differs from the cached one, the fetcher's resolved-org cache
    // is cleared so the next fetch re-resolves against the new account.
    //
    // Returns { changed, previous, current } — the caller can use `changed`
    // to decide whether to also clear the session cookie (account switch)
    // or leave it alone (personal↔personal on the same device typically
    // still requires a cookie reset too, but that's the caller's call).
    notifyIdentityMaybeChanged() {
        try {
            return this._identityCache.noteCurrentIdentity(readCredentials());
        } catch (err) {
            fileLog(`Identity-change check failed (credentials unreadable): ${err.message}`);
            return { changed: false, previous: null, current: null };
        }
    }

    // --- Login Flow (puppeteer-core, lazy loaded) ---

    _isLoginInProgress() {
        try {
            if (!fs.existsSync(LOGIN_LOCK_FILE)) return false;
            const data = JSON.parse(fs.readFileSync(LOGIN_LOCK_FILE, 'utf-8'));
            if (Date.now() - data.timestamp < LOGIN_LOCK_TTL) {
                return true;
            }
            // Stale lock, remove it
            fs.unlinkSync(LOGIN_LOCK_FILE);
            return false;
        } catch (err) {
            // Malformed lock file or unexpected fs error — treat as
            // "no login in progress" so we don't deadlock the user, but
            // log it so a corrupted lock or disk issue is visible.
            fileLog(`Login-lock read failed (treating as no lock): ${err.message}`);
            return false;
        }
    }

    _acquireLoginLock() {
        if (this._isLoginInProgress()) {
            throw new Error('LOGIN_IN_PROGRESS');
        }
        const dir = path.dirname(LOGIN_LOCK_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(LOGIN_LOCK_FILE, JSON.stringify({ timestamp: Date.now(), pid: process.pid }));
    }

    _releaseLoginLock() {
        try {
            if (fs.existsSync(LOGIN_LOCK_FILE)) {
                fs.unlinkSync(LOGIN_LOCK_FILE);
            }
        } catch (err) {
            // A failed unlink is usually benign (another process or a
            // crash already removed the file) but log so we'd see a
            // pattern of fs failures instead of just shrugging.
            fileLog(`Login-lock release failed: ${err.message}`);
        }
    }

    async login() {
        const debug = isDebugEnabled();
        const debugChannel = getDebugChannel();

        if (this._isLoginInProgress()) {
            fileLog('Another instance is logging in, skipping');
            throw new Error('LOGIN_IN_PROGRESS');
        }

        this._acquireLoginLock();
        fileLog('Login flow started');

        // Get CLI account email upfront so we can verify the user logs into the correct account.
        const cliEmail = await this._fetchBootstrapWithCliToken();
        if (cliEmail) {
            fileLog(`CLI account email: ${cliEmail} — will verify after login`);
        } else {
            fileLog('CLI token auth unavailable — account verification skipped');
        }

        let browser = null;
        let page = null;
        let userDataDir = null;

        try {
            // Lazy-load puppeteer-core
            const puppeteer = require('puppeteer-core');

            // Migrate: older builds kept a persistent ~/.config/claudemeter/login-session
            // dir. We now use an ephemeral tempdir per login, so delete the legacy
            // directory if present.
            const legacyLoginDir = path.join(PATHS.CONFIG_DIR, 'login-session');
            if (fs.existsSync(legacyLoginDir)) {
                try {
                    fs.rmSync(legacyLoginDir, { recursive: true, force: true });
                    fileLog('Removed legacy persistent login-session dir');
                } catch (err) {
                    fileLog(`Could not remove legacy login-session: ${err.message}`);
                }
            }

            const chromePath = findChrome();
            if (!chromePath) {
                throw new Error('CHROME_NOT_FOUND');
            }

            if (debug) {
                debugChannel.appendLine(`\n=== LOGIN FLOW (${new Date().toLocaleString()}) ===`);
                debugChannel.appendLine(`Browser: ${chromePath}`);
            }

            const port = await this._findAvailablePort();
            // Fresh tempdir per login so the browser has no tab history,
            // cache, or cookies between runs. The sessionKey cookie we need
            // is extracted via page.cookies() before the dir is cleaned up.
            userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-login-'));

            browser = await puppeteer.launch({
                headless: false,
                userDataDir,
                executablePath: chromePath,
                timeout: 60000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-session-crashed-bubble',
                    '--disable-infobars',
                    '--noerrdialogs',
                    '--hide-crash-restore-bubble',
                    '--no-first-run',
                    '--no-default-browser-check',
                    `--remote-debugging-port=${port}`
                ],
                defaultViewport: { width: 1280, height: 800 },
            });

            page = await browser.newPage();
            await page.setUserAgent(BROWSER_HEADERS['User-Agent']);

            // Pre-inject the saved sessionKey cookie if we have one. When the
            // cookie is still valid (common case: misclassified SESSION_EXPIRED,
            // transient server glitch) Claude's login page redirects straight
            // to the dashboard and _waitForSessionKey finds the cookie without
            // any user interaction. If the cookie is actually dead, the server
            // ignores it and the user logs in as normal.
            const existingCookie = this._readCookie();
            if (existingCookie?.sessionKey) {
                try {
                    await page.setCookie({
                        url: CLAUDE_URLS.BASE,
                        name: 'sessionKey',
                        value: existingCookie.sessionKey,
                        httpOnly: true,
                        secure: true,
                    });
                    fileLog('Pre-injected saved sessionKey — skipping login if still valid');
                } catch (err) {
                    fileLog(`Cookie pre-injection failed: ${err.message}`);
                }
            }

            await page.goto(CLAUDE_URLS.LOGIN, {
                waitUntil: 'networkidle2',
                timeout: TIMEOUTS.PAGE_LOAD,
            });

            if (debug) {
                debugChannel.appendLine('Browser opened - awaiting login');
            }

            const loginTitle = cliEmail
                ? `Log in to Claude.ai as ${cliEmail}...`
                : 'Login required. Please log in to Claude.ai in the browser window...';

            // Wait for login with progress notification
            const loginResult = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: loginTitle,
                    cancellable: false,
                },
                async () => {
                    return await this._waitForSessionKey(page, browser);
                }
            );

            if (loginResult.success) {
                // Extract and verify the sessionKey cookie before saving
                const cookies = await page.cookies(CLAUDE_URLS.BASE);
                const sessionCookie = cookies.find(c => c.name === 'sessionKey');

                if (!sessionCookie) {
                    throw new Error('Login appeared successful but no sessionKey cookie found');
                }

                // Verify the logged-in account matches the CLI account
                fileLog('Verifying browser account matches CLI account...');
                const bootstrapData = await this._fetchBootstrapWithKey(sessionCookie.value);
                const browserEmail = bootstrapData?.account?.email_address || null;

                if (cliEmail && browserEmail && cliEmail.toLowerCase() !== browserEmail.toLowerCase()) {
                    // Wrong account — prompt user to log in as the correct account
                    // in the same browser window. The tempdir is always wiped after
                    // this flow, so no cached browser state carries over.
                    fileLog(`Account mismatch: browser=${browserEmail}, CLI=${cliEmail}`);
                    await vscode.window.showErrorMessage(
                        `Wrong account. Browser is signed in as ${browserEmail} but Claude Code is using ${cliEmail}. Please log in with the correct account.`,
                        { modal: false }
                    );
                    // Navigate back to login page for another attempt
                    await page.goto(CLAUDE_URLS.LOGIN, { waitUntil: 'networkidle2', timeout: TIMEOUTS.PAGE_LOAD });
                    const retryResult = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Log in as ${cliEmail} in the browser window...`,
                            cancellable: false,
                        },
                        async () => {
                            return await this._waitForSessionKey(page, browser);
                        }
                    );
                    if (!retryResult.success) {
                        throw new Error(retryResult.cancelled ? 'LOGIN_CANCELLED' : 'LOGIN_TIMEOUT');
                    }
                    const retryCookies = await page.cookies(CLAUDE_URLS.BASE);
                    const retrySessionCookie = retryCookies.find(c => c.name === 'sessionKey');
                    if (!retrySessionCookie) {
                        throw new Error('No sessionKey cookie after retry');
                    }
                    // Re-verify after retry
                    const retryBootstrap = await this._fetchBootstrapWithKey(retrySessionCookie.value);
                    const retryBrowserEmail = retryBootstrap?.account?.email_address || null;
                    if (cliEmail && retryBrowserEmail && cliEmail.toLowerCase() !== retryBrowserEmail.toLowerCase()) {
                        fileLog(`Account mismatch on retry: browser=${retryBrowserEmail}, CLI=${cliEmail}`);
                        throw new Error('WRONG_ACCOUNT');
                    }
                    const creds = readCredentials();
                    this._saveCookie(retrySessionCookie.value, retrySessionCookie.expires, creds?.orgId);
                } else {
                    if (!cliEmail) {
                        fileLog('CLI token auth not supported for verification — skipping account check');
                    } else {
                        fileLog(`Account verified: ${browserEmail}`);
                    }
                    const creds = readCredentials();
                    this._saveCookie(sessionCookie.value, sessionCookie.expires, creds?.orgId);
                }

                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Login successful! Session saved.',
                        cancellable: false,
                    },
                    () => new Promise(resolve => setTimeout(resolve, 3000))
                );

                fileLog('Login successful, cookie saved');
                if (debug) {
                    debugChannel.appendLine('Login successful - sessionKey cookie extracted and saved');
                }
            } else if (loginResult.cancelled) {
                fileLog('Login cancelled by user');
                throw new Error('LOGIN_CANCELLED');
            } else {
                fileLog('Login timed out');
                throw new Error('LOGIN_TIMEOUT');
            }
        } finally {
            // Close the login browser
            if (browser) {
                try {
                    const browserProcess = browser.process();
                    const closePromise = browser.close();
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('timeout')), 5000)
                    );
                    try {
                        await Promise.race([closePromise, timeoutPromise]);
                    } catch (err) {
                        fileLog(`Browser close timed out, falling back to SIGKILL: ${err.message}`);
                        if (browserProcess) {
                            try {
                                browserProcess.kill('SIGKILL');
                            } catch (killErr) {
                                // Process is likely already dead — that's the
                                // common case. Log so we'd notice if SIGKILL
                                // is consistently failing for a real reason.
                                fileLog(`SIGKILL on login browser process failed (likely already exited): ${killErr.message}`);
                            }
                        }
                        await sleep(1000);
                    }
                } catch (err) {
                    fileLog(`Login browser close path failed unexpectedly: ${err.message}`);
                }
            }
            // Remove the per-login tempdir so no tab history, cache, or cookies
            // persist between runs. The sessionKey we care about is already
            // saved in our own session-cookie.json at this point.
            if (userDataDir && fs.existsSync(userDataDir)) {
                try {
                    fs.rmSync(userDataDir, { recursive: true, force: true });
                } catch (err) {
                    fileLog(`Failed to clean login tempdir ${userDataDir}: ${err.message}`);
                }
            }
            this._releaseLoginLock();
        }
    }

    async _waitForSessionKey(page, browser, maxWaitMs = TIMEOUTS.LOGIN_WAIT, pollIntervalMs = TIMEOUTS.LOGIN_POLL) {
        const debug = isDebugEnabled();
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            await sleep(pollIntervalMs);

            try {
                if (!browser || !browser.isConnected()) {
                    if (debug) {
                        getDebugChannel().appendLine('Auth: Browser disconnected - login cancelled');
                    }
                    return { success: false, cancelled: true };
                }

                const cookies = await page.cookies(CLAUDE_URLS.BASE);
                const hasSessionKey = cookies.some(c => c.name === 'sessionKey');

                if (hasSessionKey) {
                    if (debug) {
                        getDebugChannel().appendLine('Auth: sessionKey cookie detected');
                    }
                    return { success: true, cancelled: false };
                }
            } catch (error) {
                if (error.message.includes('Target closed') ||
                    error.message.includes('Protocol error') ||
                    error.message.includes('Session closed') ||
                    error.message.includes('Connection closed')) {
                    return { success: false, cancelled: true };
                }
                console.log('Cookie check error:', error.message);
            }
        }

        return { success: false, cancelled: false };
    }

    async _findAvailablePort() {
        return findAvailablePort();
    }

    // --- Diagnostics ---

    getDiagnostics() {
        const cookie = this._readCookie();
        const creds = readCredentials();
        const schemaInfo = getSchemaInfo();
        const identity = this._identityCache.toDiagnostics();

        return {
            hasCookie: !!cookie,
            cookieExpires: cookie?.expires ? new Date(cookie.expires * 1000).toISOString() : null,
            cookieSavedAt: cookie?.savedAt || null,
            orgId: creds?.orgId || cookie?.orgId || null,
            subscriptionType: creds?.subscriptionType || null,
            rateLimitTier: creds?.rateLimitTier || null,
            accountName: this.accountInfo?.name || null,
            accountEmail: this.accountInfo?.email || null,
            identityCache: identity,
            schemaVersion: schemaInfo.version,
            schemaFields: schemaInfo.usageFields,
            schemaEndpoints: schemaInfo.endpoints,
        };
    }
}

// --- Browser Detection (static, used only for login) ---

function findChrome() {
    const defaultBrowser = getDefaultBrowser();
    if (defaultBrowser) {
        console.log(`Using default browser: ${defaultBrowser}`);
        return defaultBrowser;
    }

    console.log('Default browser not Chromium-based, searching for installed browsers...');

    const browserPaths = [];

    if (process.platform === 'win32') {
        browserPaths.push(
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            'C:\\AppInstall\\scoop\\apps\\googlechrome\\current\\chrome.exe',
            path.join(os.homedir(), 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
            'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        );
    } else if (process.platform === 'darwin') {
        browserPaths.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            path.join(os.homedir(), 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            path.join(os.homedir(), 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'),
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            path.join(os.homedir(), 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
            '/Applications/Arc.app/Contents/MacOS/Arc',
            path.join(os.homedir(), 'Applications', 'Arc.app', 'Contents', 'MacOS', 'Arc'),
            '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
            path.join(os.homedir(), 'Applications', 'Vivaldi.app', 'Contents', 'MacOS', 'Vivaldi'),
            '/Applications/Opera.app/Contents/MacOS/Opera',
            path.join(os.homedir(), 'Applications', 'Opera.app', 'Contents', 'MacOS', 'Opera')
        );
    } else {
        browserPaths.push(
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/snap/bin/google-chrome',
            '/var/lib/flatpak/app/com.google.Chrome/current/active/export/bin/com.google.Chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
            '/var/lib/flatpak/app/org.chromium.Chromium/current/active/export/bin/org.chromium.Chromium',
            '/usr/bin/brave-browser',
            '/usr/bin/brave',
            '/snap/bin/brave',
            '/opt/brave.com/brave/brave-browser',
            '/var/lib/flatpak/app/com.brave.Browser/current/active/export/bin/com.brave.Browser',
            '/usr/bin/microsoft-edge',
            '/usr/bin/microsoft-edge-stable'
        );
    }

    for (const browserPath of browserPaths) {
        try {
            if (fs.existsSync(browserPath)) {
                console.log(`Found browser at: ${browserPath}`);
                return browserPath;
            }
        } catch (err) {
            // Permission-denied or non-existent parent dir while probing
            // — fine to skip, but log so a permission-config issue
            // doesn't masquerade as "no browser installed".
            fileLog(`Browser-path probe failed for ${browserPath}: ${err.message}`);
        }
    }

    return null;
}

function getDefaultBrowser() {
    try {
        if (process.platform === 'linux') {
            return getDefaultBrowserLinux();
        } else if (process.platform === 'darwin') {
            return getDefaultBrowserMacOS();
        } else if (process.platform === 'win32') {
            return getDefaultBrowserWindows();
        }
    } catch (err) {
        console.log('Default browser detection failed:', err.message);
    }
    return null;
}

function getDefaultBrowserLinux() {
    try {
        const desktopFile = execSync('xdg-mime query default x-scheme-handler/http', {
            encoding: 'utf8',
            timeout: 5000
        }).trim().toLowerCase();

        const browserMap = CHROMIUM_BROWSERS.linux;
        for (const [pattern, paths] of Object.entries(browserMap)) {
            if (desktopFile.includes(pattern.replace('.desktop', '')) || desktopFile === pattern) {
                for (const browserPath of paths) {
                    if (fs.existsSync(browserPath)) {
                        return browserPath;
                    }
                }
            }
        }
    } catch (err) {
        console.log('xdg-mime query failed:', err.message);
    }
    return null;
}

function getDefaultBrowserMacOS() {
    try {
        const bundleId = execSync(
            'defaults read ~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers | grep -B1 "https" | grep "LSHandlerRoleAll" | head -1 | sed \'s/.*= "\\(.*\\)";/\\1/\'',
            { encoding: 'utf8', timeout: 5000, shell: '/bin/bash' }
        ).trim().toLowerCase();

        const browserMap = CHROMIUM_BROWSERS.darwin;
        for (const [pattern, appPath] of Object.entries(browserMap)) {
            if (bundleId.includes(pattern.toLowerCase())) {
                const systemPath = appPath;
                const userPath = appPath.replace('/Applications/', path.join(os.homedir(), 'Applications') + '/');

                if (fs.existsSync(systemPath)) return systemPath;
                if (fs.existsSync(userPath)) return userPath;
            }
        }
    } catch (err) {
        console.log('macOS default browser detection failed:', err.message);
    }
    return null;
}

function getDefaultBrowserWindows() {
    try {
        const progId = execSync(
            'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
            { encoding: 'utf8', timeout: 5000 }
        );

        const match = progId.match(/ProgId\s+REG_SZ\s+(\S+)/i);
        if (!match) return null;

        const progIdValue = match[1].toLowerCase();

        const browserMap = CHROMIUM_BROWSERS.win32;
        for (const [pattern, relativePath] of Object.entries(browserMap)) {
            if (progIdValue.includes(pattern)) {
                const possiblePaths = [
                    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', relativePath),
                    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', relativePath),
                    path.join(os.homedir(), 'AppData', 'Local', relativePath),
                ];

                for (const browserPath of possiblePaths) {
                    if (fs.existsSync(browserPath)) return browserPath;
                }
            }
        }
    } catch (err) {
        console.log('Windows registry query failed:', err.message);
    }
    return null;
}

module.exports = {
    ClaudeHttpFetcher,
    findChrome,
    selectMembership,
};
