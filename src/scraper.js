// Project:   Claudemeter
// File:      scraper.js
// Purpose:   Browser automation for fetching Claude.ai usage data
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

const puppeteer = require('puppeteer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const vscode = require('vscode');

const lockfile = require('proper-lockfile');
const { ClaudeAuth } = require('./auth');
const {
    CONFIG_NAMESPACE,
    PATHS,
    TIMEOUTS,
    VIEWPORT,
    CLAUDE_URLS,
    isDebugEnabled,
    getDebugChannel,
    setDevMode,
    sleep,
    fileLog
} = require('./utils');

// Browser lock configuration
// Stale after 6 minutes (login timeout is 5 min, add buffer)
// Poll every 1 second for up to 90 seconds - covers typical fetch (30-45s) with buffer
const BROWSER_LOCK_OPTIONS = {
    stale: 360000,
    retries: {
        retries: 90,
        factor: 1,
        minTimeout: 1000,
        maxTimeout: 1000
    },
    onCompromised: (err) => {
        console.warn('Claudemeter: Browser lock was compromised:', err.message);
    }
};

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
    USAGE_API_SCHEMA,
    API_ENDPOINTS,
    extractFromSchema,
    matchesEndpoint,
    processOverageData,
    processPrepaidData,
    getSchemaInfo,
} = require('./apiSchema');

// Chromium-based browser paths by platform
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

class ClaudeUsageScraper {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isInitialized = false;
        this.browserPort = null;
        this.isConnectedBrowser = false;

        this.apiEndpoint = null;
        this.apiHeaders = null;
        this.creditsEndpoint = null;
        this.overageEndpoint = null;
        this.capturedEndpoints = [];

        this.auth = new ClaudeAuth();
        this.releaseBrowserLock = null;
    }

    get sessionDir() {
        return this.auth.getSessionDir();
    }

    // Acquire exclusive lock for browser operations (login, headed browser launch)
    // Other instances wait until lock is released or times out
    async acquireBrowserLock() {
        // Skip if we already hold the lock
        if (this.releaseBrowserLock) {
            fileLog('Already holding browser lock, skipping acquire');
            return true;
        }

        const debug = isDebugEnabled();
        const lockFile = PATHS.BROWSER_LOCK_FILE;

        // Ensure lock file exists (proper-lockfile requires it)
        if (!fs.existsSync(lockFile)) {
            const dir = path.dirname(lockFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(lockFile, '');
        }

        if (debug) {
            getDebugChannel().appendLine('Acquiring browser lock...');
        }
        fileLog('Attempting to acquire browser lock...');

        try {
            this.releaseBrowserLock = await lockfile.lock(lockFile, BROWSER_LOCK_OPTIONS);
            if (debug) {
                getDebugChannel().appendLine('Browser lock acquired');
            }
            fileLog('Browser lock acquired');
            return true;
        } catch (error) {
            if (debug) {
                getDebugChannel().appendLine(`Failed to acquire browser lock: ${error.message}`);
            }
            fileLog(`Failed to acquire browser lock: ${error.message}`);
            throw new Error(`Browser busy (another Claudemeter instance is using the browser). Please wait and retry.`);
        }
    }

    async releaseBrowserLockIfHeld() {
        if (this.releaseBrowserLock) {
            const debug = isDebugEnabled();
            try {
                await this.releaseBrowserLock();
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

    getDefaultBrowser() {
        try {
            if (process.platform === 'linux') {
                return this.getDefaultBrowserLinux();
            } else if (process.platform === 'darwin') {
                return this.getDefaultBrowserMacOS();
            } else if (process.platform === 'win32') {
                return this.getDefaultBrowserWindows();
            }
        } catch (err) {
            console.log('Default browser detection failed:', err.message);
        }
        return null;
    }

    getDefaultBrowserLinux() {
        try {
            const desktopFile = execSync('xdg-mime query default x-scheme-handler/http', {
                encoding: 'utf8',
                timeout: 5000
            }).trim().toLowerCase();

            console.log(`Linux default browser desktop file: ${desktopFile}`);

            const browserMap = CHROMIUM_BROWSERS.linux;
            for (const [pattern, paths] of Object.entries(browserMap)) {
                if (desktopFile.includes(pattern.replace('.desktop', '')) || desktopFile === pattern) {
                    for (const browserPath of paths) {
                        if (fs.existsSync(browserPath)) {
                            console.log(`Default browser is Chromium-based: ${browserPath}`);
                            return browserPath;
                        }
                    }
                }
            }

            console.log(`Default browser (${desktopFile}) is not Chromium-based or not recognised`);
        } catch (err) {
            console.log('xdg-mime query failed:', err.message);
        }
        return null;
    }

    getDefaultBrowserMacOS() {
        try {
            const bundleId = execSync(
                'defaults read ~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers | grep -B1 "https" | grep "LSHandlerRoleAll" | head -1 | sed \'s/.*= "\\(.*\\)";/\\1/\'',
                { encoding: 'utf8', timeout: 5000, shell: '/bin/bash' }
            ).trim().toLowerCase();

            console.log(`macOS default browser bundle ID: ${bundleId}`);

            const browserMap = CHROMIUM_BROWSERS.darwin;
            for (const [pattern, appPath] of Object.entries(browserMap)) {
                if (bundleId.includes(pattern.toLowerCase())) {
                    const systemPath = appPath;
                    const userPath = appPath.replace('/Applications/', path.join(os.homedir(), 'Applications') + '/');

                    if (fs.existsSync(systemPath)) {
                        console.log(`Default browser is Chromium-based: ${systemPath}`);
                        return systemPath;
                    }
                    if (fs.existsSync(userPath)) {
                        console.log(`Default browser is Chromium-based: ${userPath}`);
                        return userPath;
                    }
                }
            }

            console.log(`Default browser (${bundleId}) is not Chromium-based or not recognised`);
        } catch (err) {
            console.log('macOS default browser detection failed:', err.message);
        }
        return null;
    }

    getDefaultBrowserWindows() {
        try {
            const progId = execSync(
                'reg query "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice" /v ProgId',
                { encoding: 'utf8', timeout: 5000 }
            );

            const match = progId.match(/ProgId\s+REG_SZ\s+(\S+)/i);
            if (!match) return null;

            const progIdValue = match[1].toLowerCase();
            console.log(`Windows default browser ProgId: ${progIdValue}`);

            const browserMap = CHROMIUM_BROWSERS.win32;
            for (const [pattern, relativePath] of Object.entries(browserMap)) {
                if (progIdValue.includes(pattern)) {
                    const possiblePaths = [
                        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', relativePath),
                        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', relativePath),
                        path.join(os.homedir(), 'AppData', 'Local', relativePath),
                    ];

                    for (const browserPath of possiblePaths) {
                        if (fs.existsSync(browserPath)) {
                            console.log(`Default browser is Chromium-based: ${browserPath}`);
                            return browserPath;
                        }
                    }
                }
            }

            console.log(`Default browser (${progIdValue}) is not Chromium-based or not recognised`);
        } catch (err) {
            console.log('Windows registry query failed:', err.message);
        }
        return null;
    }

    // Priority: default browser (if Chromium), then known browser paths
    findChrome() {
        const defaultBrowser = this.getDefaultBrowser();
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
                // Continue to next path
            }
        }

        return null;
    }

    async tryConnectToExisting() {
        try {
            const browserURL = `http://127.0.0.1:${this.browserPort}`;
            this.browser = await puppeteer.connect({
                browserURL,
                defaultViewport: null
            });

            const pages = await this.browser.pages();
            if (pages.length > 0) {
                for (const page of pages) {
                    const url = page.url();
                    if (url.includes(CLAUDE_URLS.BASE)) {
                        this.page = page;
                        break;
                    }
                }
                if (!this.page) {
                    this.page = pages[0];
                }
            } else {
                this.page = await this.browser.newPage();
            }

            await this.page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            );

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
        if (this.isInitialized && this.browser) {
            try {
                await this.browser.version();
                return;
            } catch (error) {
                this.browser = null;
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
                headless: headless ? 'new' : false,
                userDataDir: this.sessionDir,
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
                    `--remote-debugging-port=${this.browserPort}`
                ],
                defaultViewport: { width: VIEWPORT.WIDTH, height: VIEWPORT.HEIGHT }
            };

            console.log(`Launching Chrome on port ${this.browserPort}`);
            this.browser = await puppeteer.launch(launchOptions);
            this.page = await this.browser.newPage();

            await this.page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            );

            await this.setupRequestInterception();

            this.isInitialized = true;
            this.isConnectedBrowser = false;
            this.auth.setPageAndBrowser(this.page, this.browser);

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
                // Clear any previous failed state - session is now valid
                BrowserState.clear();
                await this.page.goto(CLAUDE_URLS.USAGE, {
                    waitUntil: 'networkidle2',
                    timeout: TIMEOUTS.PAGE_LOAD
                });
                return;
            }

            if (debug) {
                getDebugChannel().appendLine(`Auth: Session invalid (${validation.reason}), need login`);
            }

            await this.openLoginBrowser();
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
                    waitUntil: 'networkidle2',
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
            await this.page.setRequestInterception(true);
            this.capturedEndpoints = [];

            this.page.on('request', (request) => {
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

                request.continue();
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

    calculateResetTime(isoTimestamp) {
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

    processApiResponse(apiResponse, creditsData = null, overageData = null) {
        try {
            const data = extractFromSchema(apiResponse, USAGE_API_SCHEMA);
            const monthlyCredits = processOverageData(overageData);
            const prepaidCredits = processPrepaidData(creditsData);

            return {
                usagePercent: data.fiveHour.utilization,
                resetTime: this.calculateResetTime(data.fiveHour.resetsAt),
                usagePercentWeek: data.sevenDay.utilization,
                resetTimeWeek: this.calculateResetTime(data.sevenDay.resetsAt),
                usagePercentSonnet: data.sevenDaySonnet.utilization,
                resetTimeSonnet: this.calculateResetTime(data.sevenDaySonnet.resetsAt),
                usagePercentOpus: data.sevenDayOpus.utilization,
                resetTimeOpus: this.calculateResetTime(data.sevenDayOpus.resetsAt),
                extraUsage: data.extraUsage.value,
                prepaidCredits: prepaidCredits,
                monthlyCredits: monthlyCredits,
                timestamp: new Date(),
                rawData: apiResponse,
                schemaVersion: getSchemaInfo().version,
            };
        } catch (error) {
            console.error('Error processing API response:', error);
            throw new Error('Failed to process API response data');
        }
    }

    async fetchUsageData() {
        const debug = isDebugEnabled();

        try {
            await this.page.goto(CLAUDE_URLS.USAGE, {
                waitUntil: 'networkidle2',
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

                    const cookies = await this.page.cookies();
                    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                    const response = await this.page.evaluate(async (endpoint, headers, cookieStr) => {
                        const resp = await fetch(endpoint, {
                            method: 'GET',
                            headers: { ...headers, 'Cookie': cookieStr }
                        });
                        if (!resp.ok) throw new Error(`API request failed: ${resp.status}`);
                        return await resp.json();
                    }, this.apiEndpoint, this.apiHeaders, cookieString);

                    if (debug) {
                        getDebugChannel().appendLine('Direct API fetch SUCCESS!');
                        getDebugChannel().appendLine(JSON.stringify(response, null, 2));
                    }

                    let creditsData = null;
                    let overageData = null;

                    if (this.creditsEndpoint) {
                        try {
                            creditsData = await this.page.evaluate(async (endpoint, headers, cookieStr) => {
                                const resp = await fetch(endpoint, {
                                    method: 'GET',
                                    headers: { ...headers, 'Cookie': cookieStr }
                                });
                                return resp.ok ? await resp.json() : null;
                            }, this.creditsEndpoint, this.apiHeaders, cookieString);
                            if (debug && creditsData) {
                                getDebugChannel().appendLine(`Prepaid credits response: ${JSON.stringify(creditsData)}`);
                            }
                        } catch (e) {
                            if (debug) getDebugChannel().appendLine(`Credits fetch error: ${e.message}`);
                        }
                    }

                    if (this.overageEndpoint) {
                        try {
                            overageData = await this.page.evaluate(async (endpoint, headers, cookieStr) => {
                                const resp = await fetch(endpoint, {
                                    method: 'GET',
                                    headers: { ...headers, 'Cookie': cookieStr }
                                });
                                return resp.ok ? await resp.json() : null;
                            }, this.overageEndpoint, this.apiHeaders, cookieString);
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
            if (this.browser) {
                if (this.isConnectedBrowser) {
                    await this.browser.disconnect();
                    console.log('Disconnected from shared browser');
                } else {
                    // Try graceful close with timeout, then force kill if needed
                    const browserProcess = this.browser.process();
                    const closePromise = this.browser.close();
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Browser close timeout')), 5000)
                    );

                    try {
                        await Promise.race([closePromise, timeoutPromise]);
                        console.log('Closed browser instance');
                    } catch (e) {
                        // Force kill if graceful close times out
                        fileLog(`Browser close timed out, force killing`);
                        if (browserProcess) {
                            try {
                                browserProcess.kill('SIGKILL');
                            } catch (killErr) {
                                // Process may have already exited
                            }
                        }
                        // Wait for OS to fully release userDataDir resources
                        await sleep(1000);
                    }
                }
                this.browser = null;
                this.page = null;
                this.isInitialized = false;
                this.isConnectedBrowser = false;
            }
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

        if (debug) {
            getDebugChannel().appendLine('Browser connection closed');
            getDebugChannel().appendLine('All captured API endpoints cleared');
        }

        return { success: true, message: 'Connection reset successfully' };
    }

    async clearSession() {
        await this.reset();
        return await this.auth.clearSession();
    }

    async forceOpenBrowser() {
        const debug = isDebugEnabled();
        if (debug) {
            getDebugChannel().appendLine(`\n=== FORCE OPEN BROWSER (${new Date().toLocaleString()}) ===`);
        }

        try {
            if (this.browser) {
                try {
                    if (this.isConnectedBrowser) {
                        await this.browser.disconnect();
                    } else {
                        await this.browser.close();
                    }
                } catch (e) {
                    // Ignore close errors
                }
                this.browser = null;
                this.page = null;
                this.isInitialized = false;
            }

            const chromePath = this.findChrome();

            if (!chromePath) {
                throw new Error('CHROME_NOT_FOUND');
            }

            this.browserPort = await this.findAvailablePort();

            const launchOptions = {
                headless: false,
                userDataDir: this.sessionDir,
                executablePath: chromePath,
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
                    `--remote-debugging-port=${this.browserPort}`
                ],
                defaultViewport: { width: VIEWPORT.WIDTH, height: VIEWPORT.HEIGHT }
            };

            if (debug) {
                getDebugChannel().appendLine(`Launching headed Chrome browser...`);
                getDebugChannel().appendLine(`Executable: ${chromePath}`);
            }

            this.browser = await puppeteer.launch(launchOptions);
            this.page = await this.browser.newPage();

            await this.page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            );

            await this.setupRequestInterception();

            this.isInitialized = true;
            this.isConnectedBrowser = false;
            this.auth.setPageAndBrowser(this.page, this.browser);

            await this.page.goto(CLAUDE_URLS.LOGIN, {
                waitUntil: 'networkidle2',
                timeout: TIMEOUTS.PAGE_LOAD
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
