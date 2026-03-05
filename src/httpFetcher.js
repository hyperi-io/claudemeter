// Project:   Claudemeter v2 (Lightweight)
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
// Copyright: (c) 2026 HyperSec

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const vscode = require('vscode');

const {
    USAGE_API_SCHEMA,
    extractFromSchema,
    processOverageData,
    processPrepaidData,
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
} = require('./utils');

const { readCredentials } = require('./credentialsReader');

// Browser-like headers to pass Cloudflare challenge
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
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

// Login lock: simple file-based mutex to prevent multiple login windows
const LOGIN_LOCK_FILE = path.join(PATHS.CONFIG_DIR, 'login-in-progress.lock');
const LOGIN_LOCK_TTL = 5 * 60 * 1000; // 5 minutes

class ClaudeHttpFetcher {
    constructor() {
        this.accountInfo = null;
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
        fs.writeFileSync(PATHS.SESSION_COOKIE_FILE, JSON.stringify(data, null, 2));
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

    clearSession() {
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
            return { success: true, message: 'Session cleared. Next fetch will prompt for login.' };
        } catch (error) {
            fileLog(`Error clearing session: ${error.message}`);
            return { success: false, message: `Failed to clear session: ${error.message}` };
        }
    }

    // --- HTTP Fetching ---

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

    async fetchUsageData() {
        const debug = isDebugEnabled();
        const debugChannel = getDebugChannel();

        // Get org ID from credentials or stored cookie
        const creds = readCredentials();
        const cookie = this._readCookie();
        const orgId = creds?.orgId || cookie?.orgId;

        if (!orgId) {
            throw new Error('NO_ORG_ID');
        }

        if (!cookie || !cookie.sessionKey) {
            throw new Error('NO_SESSION');
        }

        // Check cookie expiry
        if (cookie.expires && cookie.expires <= Date.now() / 1000) {
            throw new Error('SESSION_EXPIRED');
        }

        const baseUrl = `${CLAUDE_URLS.BASE}/api/organizations/${orgId}`;
        const usageUrl = `${baseUrl}/usage`;
        const creditsUrl = `${baseUrl}/prepaid/credits`;
        const overageUrl = `${baseUrl}/overage_spend_limit`;

        if (debug) {
            debugChannel.appendLine(`\n=== HTTP FETCH (${new Date().toLocaleString()}) ===`);
            debugChannel.appendLine(`Org ID: ${orgId}`);
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

        return this._processApiResponse(usageData, creditsData, overageData);
    }

    _calculateResetTime(isoTimestamp) {
        if (!isoTimestamp) return 'Unknown';

        try {
            const resetDate = new Date(isoTimestamp);
            const now = new Date();
            const diffMs = resetDate - now;

            if (diffMs <= 0) return 'Soon';

            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

            if (hours > 24) {
                const days = Math.floor(hours / 24);
                const remainingHours = hours % 24;
                return `${days}d ${remainingHours}h`;
            } else if (hours > 0) {
                return `${hours}h ${minutes}m`;
            } else {
                return `${minutes}m`;
            }
        } catch (error) {
            console.error('Error calculating reset time:', error);
            return 'Unknown';
        }
    }

    _processApiResponse(apiResponse, creditsData = null, overageData = null) {
        try {
            const data = extractFromSchema(apiResponse, USAGE_API_SCHEMA);
            const monthlyCredits = processOverageData(overageData);
            const prepaidCredits = processPrepaidData(creditsData);

            return {
                usagePercent: data.fiveHour.utilization,
                resetTime: this._calculateResetTime(data.fiveHour.resetsAt),
                usagePercentWeek: data.sevenDay.utilization,
                resetTimeWeek: this._calculateResetTime(data.sevenDay.resetsAt),
                usagePercentSonnet: data.sevenDaySonnet.utilization,
                resetTimeSonnet: this._calculateResetTime(data.sevenDaySonnet.resetsAt),
                usagePercentOpus: data.sevenDayOpus.utilization,
                resetTimeOpus: this._calculateResetTime(data.sevenDayOpus.resetsAt),
                extraUsage: data.extraUsage.value,
                prepaidCredits: prepaidCredits,
                monthlyCredits: monthlyCredits,
                accountInfo: this.accountInfo,
                timestamp: new Date(),
                rawData: apiResponse,
                schemaVersion: getSchemaInfo().version,
            };
        } catch (error) {
            console.error('Error processing API response:', error);
            throw new Error('Failed to process API response data');
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
        } catch {
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
        } catch {
            // Ignore
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

        let browser = null;
        let page = null;

        try {
            // Lazy-load puppeteer-core
            const puppeteer = require('puppeteer-core');

            const chromePath = findChrome();
            if (!chromePath) {
                throw new Error('CHROME_NOT_FOUND');
            }

            if (debug) {
                debugChannel.appendLine(`\n=== LOGIN FLOW (${new Date().toLocaleString()}) ===`);
                debugChannel.appendLine(`Browser: ${chromePath}`);
            }

            const port = await this._findAvailablePort();
            const userDataDir = path.join(PATHS.CONFIG_DIR, 'login-session');

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

            await page.goto(CLAUDE_URLS.LOGIN, {
                waitUntil: 'networkidle2',
                timeout: TIMEOUTS.PAGE_LOAD,
            });

            if (debug) {
                debugChannel.appendLine('Browser opened - awaiting login');
            }

            // Wait for login with progress notification
            const loginResult = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Login required. Please log in to Claude.ai in the browser window...',
                    cancellable: false,
                },
                async () => {
                    return await this._waitForSessionKey(page, browser);
                }
            );

            if (loginResult.success) {
                // Extract and save the sessionKey cookie
                const cookies = await page.cookies(CLAUDE_URLS.BASE);
                const sessionCookie = cookies.find(c => c.name === 'sessionKey');

                if (sessionCookie) {
                    const creds = readCredentials();
                    this._saveCookie(sessionCookie.value, sessionCookie.expires, creds?.orgId);

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
                } else {
                    throw new Error('Login appeared successful but no sessionKey cookie found');
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
                    } catch {
                        if (browserProcess) {
                            try { browserProcess.kill('SIGKILL'); } catch { /* ignore */ }
                        }
                        await sleep(1000);
                    }
                } catch {
                    // Ignore close errors
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
        const net = require('net');
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.unref();
            server.on('error', reject);
            server.listen(0, () => {
                const port = server.address().port;
                server.close(() => resolve(port));
            });
        });
    }

    // --- Diagnostics ---

    getDiagnostics() {
        const cookie = this._readCookie();
        const creds = readCredentials();
        const schemaInfo = getSchemaInfo();

        return {
            hasCookie: !!cookie,
            cookieExpires: cookie?.expires ? new Date(cookie.expires * 1000).toISOString() : null,
            cookieSavedAt: cookie?.savedAt || null,
            orgId: creds?.orgId || cookie?.orgId || null,
            subscriptionType: creds?.subscriptionType || null,
            rateLimitTier: creds?.rateLimitTier || null,
            accountName: this.accountInfo?.name || null,
            accountEmail: this.accountInfo?.email || null,
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
        } catch {
            // Continue to next path
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
};
