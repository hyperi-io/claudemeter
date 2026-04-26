// Project:   Claudemeter v2 (Streamlined)
// File:      extension.js
// Purpose:   VS Code extension entry point and lifecycle management
// Language:  JavaScript (CommonJS)
//
// v2 replaces Puppeteer browser automation with streamlined HTTP cookie-based
// fetching. The legacy browser scraper is retained as an opt-in fallback via
// the "claudemeter.useLegacyScraper" setting.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { ClaudeHttpFetcher } = require('./src/httpFetcher');

// Legacy scraper is lazy-loaded only when useLegacyScraper is enabled.
// This avoids loading puppeteer-core (an external dependency not bundled in the VSIX)
// at startup when it's not needed.
let _scraperModule = null;
function getScraperModule() {
    if (!_scraperModule) {
        _scraperModule = require('./src/scraper');
    }
    return _scraperModule;
}
function getLegacyBrowserState() {
    return getScraperModule().BrowserState;
}
const { createStatusBarItem, updateStatusBar, startSpinner, stopSpinner, refreshServiceStatus } = require('./src/statusBar');
const { getStats: getActivityStats } = require('./src/activityMonitor');
const { SessionTracker } = require('./src/sessionTracker');
const { ClaudeDataLoader } = require('./src/claudeDataLoader');
const { CONFIG_NAMESPACE, COMMANDS, PATHS, getTokenLimit, resolveTokenLimit, setDevMode, isDebugEnabled, getDebugChannel, disposeDebugChannel, initFileLogger, fileLog, getDefaultDebugLogPath } = require('./src/utils');
const {
    CREDENTIALS_PATH,
    readCredentials,
    formatSubscriptionType,
    formatRateLimitTier,
    getIdentityKey,
    identityChanged,
} = require('./src/credentialsReader');
const {
    CLAUDE_CONFIG_PATH,
    getOAuthAccount,
    hasMaxContextAccess,
    findSessionForWorkspace,
    getLiveSessions,
} = require('./src/claudeConfigReader');

let statusBarItem;
let httpFetcher;
let scraper; // Legacy browser-based scraper
let usageData = null;
let credentialsInfo = null;
let autoRefreshTimer;
let localRefreshTimer;
let serviceStatusTimer;
let sessionTracker;
let claudeDataLoader;
let jsonlWatcher;
let jsonlUpdateTimer = null;
let credentialsWatcher;
let claudeConfigWatcher;
let currentWorkspacePath = null;

// Prevents auto-retry after user closes login browser
let loginWasCancelled = false;

let tokenDiagnosticChannel = null;

function getTokenDiagnosticChannel() {
    if (!tokenDiagnosticChannel) {
        tokenDiagnosticChannel = vscode.window.createOutputChannel('Claudemeter - Token Monitor');
    }
    return tokenDiagnosticChannel;
}

function debugLog(message) {
    if (isDebugEnabled()) {
        getTokenDiagnosticChannel().appendLine(message);
        // Mirror to the rolling debug.log file so JSONL/token-monitoring
        // diagnostics (init, watcher events, session updates) are visible
        // post-hoc — the Output channel is in-memory only.
        fileLog(message);
    }
}

function isLegacyMode() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return config.get('useLegacyScraper', false);
}

// Fetch with spinner, error handling, and login state management
async function performFetch(isManualRetry = false) {
    let webError = null;
    let tokenError = null;
    let wasLoginCancelled = false;

    // Skip web fetch if user previously cancelled login (unless they clicked to retry)
    if (loginWasCancelled && !isManualRetry) {
        console.log('Claudemeter: Skipping web fetch (login was cancelled). Click status bar to retry.');
        const sessionData = sessionTracker ? await sessionTracker.getCurrentSession() : null;
        if (!sessionData || !sessionData.tokenUsage) {
            tokenError = new Error('No token data available');
        }
        await updateStatusBarWithAllData();
        return { webError: new Error('Login cancelled. Click status bar to retry.'), tokenError, loginCancelled: true };
    }

    // Don't prompt for login on auto-refresh - only when user explicitly clicks
    const fetcher = isLegacyMode() ? scraper : httpFetcher;
    if (!isManualRetry && fetcher && !fetcher.hasExistingSession()) {
        console.log('Claudemeter: No session exists, skipping auto-refresh web fetch. Click status bar to login.');
        const sessionData = sessionTracker ? await sessionTracker.getCurrentSession() : null;
        if (!sessionData || !sessionData.tokenUsage) {
            tokenError = new Error('No token data available');
        }
        await updateStatusBarWithAllData();
        return { webError: new Error('No session. Click status bar to login.'), tokenError, loginCancelled: false };
    }

    try {
        startSpinner();

        if (isManualRetry && loginWasCancelled) {
            console.log('Claudemeter: Manual retry - attempting login again');
            loginWasCancelled = false;
        }

        const result = await fetchUsage(isManualRetry);
        webError = result.webError;
        wasLoginCancelled = result.loginCancelled || false;

        if (wasLoginCancelled) {
            loginWasCancelled = true;
        }

        const sessionData = sessionTracker ? await sessionTracker.getCurrentSession() : null;
        if (!sessionData || !sessionData.tokenUsage) {
            tokenError = new Error('No token data available');
        }
    } catch (error) {
        webError = webError || error;
        console.error('Failed to fetch usage:', error);
    } finally {
        stopSpinner(webError, tokenError);
        await updateStatusBarWithAllData();
    }

    return { webError, tokenError, loginCancelled: wasLoginCancelled };
}

// Fetch usage data from Claude.ai
async function fetchUsage(isManualRetry = false) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const tokenOnlyMode = config.get('tokenOnlyMode', false);

    fileLog(`fetchUsage() called (isManualRetry=${isManualRetry}, tokenOnlyMode=${tokenOnlyMode}, legacy=${isLegacyMode()})`);

    if (tokenOnlyMode) {
        console.log('Claudemeter: Token-only mode enabled, skipping web fetch');
        fileLog('Skipping web fetch - tokenOnlyMode enabled');
        return { webError: null, loginCancelled: false };
    }

    if (isLegacyMode()) {
        return fetchUsageLegacy(isManualRetry);
    }

    return fetchUsageHttp(isManualRetry);
}

// v2 default: HTTP cookie-based fetching
async function fetchUsageHttp(isManualRetry = false) {
    if (!httpFetcher) {
        httpFetcher = new ClaudeHttpFetcher();
        fileLog('Created new ClaudeHttpFetcher instance');
    }

    try {
        fileLog('Calling fetchUsageData()...');
        usageData = await httpFetcher.fetchUsageData();
        fileLog('fetchUsageData() completed successfully');
        return { webError: null, loginCancelled: false };
    } catch (error) {
        fileLog(`fetchUsageHttp() error: ${error.message}`);

        if (error.message === 'NO_SESSION' || error.message === 'SESSION_EXPIRED' || error.message === 'NO_ORG_ID') {
            if (!isManualRetry) {
                const msg = error.message === 'NO_ORG_ID'
                    ? 'No Claude Code credentials found. Install and run Claude Code first.'
                    : 'No session. Click status bar to login.';
                return { webError: new Error(msg), loginCancelled: false };
            }

            // Manual retry: trigger login flow
            try {
                fileLog('Triggering login flow...');
                await httpFetcher.login();
                fileLog('Login completed, retrying fetch...');
                usageData = await httpFetcher.fetchUsageData();
                fileLog('Post-login fetch successful');
                return { webError: null, loginCancelled: false };
            } catch (loginError) {
                fileLog(`Login/fetch error: ${loginError.message}`);
                if (loginError.message === 'LOGIN_CANCELLED') {
                    return { webError: new Error('Login cancelled. Running in token-only mode. Click status bar to retry.'), loginCancelled: true };
                } else if (loginError.message === 'LOGIN_IN_PROGRESS') {
                    return { webError: null, loginCancelled: false };
                } else if (loginError.message === 'LOGIN_TIMEOUT') {
                    return { webError: new Error('Login timed out. Click status bar to retry.'), loginCancelled: false };
                } else if (loginError.message === 'CHROME_NOT_FOUND') {
                    return { webError: new Error('Chromium-based browser required. Install Chrome, Chromium, Brave, or Edge to fetch Claude.ai usage stats.'), loginCancelled: false };
                }
                return { webError: loginError, loginCancelled: false };
            }
        }

        if (error.message === 'LOGIN_IN_PROGRESS') {
            console.log('Claudemeter: Another instance is logging in, skipping this fetch');
            return { webError: null, loginCancelled: false };
        }

        console.error('Web fetch failed:', error);
        return { webError: error, loginCancelled: false };
    }
}

// Legacy: browser-based scraping (fallback if HTTP method breaks)
async function fetchUsageLegacy(isManualRetry = false) {
    if (!scraper) {
        scraper = new (getScraperModule().ClaudeUsageScraper)();
        fileLog('Created new ClaudeUsageScraper instance (legacy mode)');
    }

    try {
        const hasSession = scraper.hasExistingSession();
        fileLog(`Legacy: hasExistingSession() = ${hasSession}`);

        if (hasSession) {
            fileLog('Legacy: Initializing scraper (headless)...');
            await scraper.initialize(false);
        }

        if (isManualRetry) {
            getLegacyBrowserState().clear();
        }

        fileLog('Legacy: Calling ensureLoggedIn()...');
        await scraper.ensureLoggedIn();
        fileLog('Legacy: ensureLoggedIn() completed');

        fileLog('Legacy: Calling fetchUsageData()...');
        usageData = await scraper.fetchUsageData();
        fileLog('Legacy: fetchUsageData() completed successfully');

        return { webError: null, loginCancelled: false };
    } catch (error) {
        fileLog(`Legacy: fetchUsage() error: ${error.message}`);
        if (error.message === 'CHROME_NOT_FOUND') {
            return { webError: new Error('Chromium-based browser required. Install Chrome, Chromium, Brave, or Edge to fetch Claude.ai usage stats.'), loginCancelled: false };
        } else if (error.message === 'LOGIN_CANCELLED') {
            return { webError: new Error('Login cancelled. Running in token-only mode. Click status bar to retry.'), loginCancelled: true };
        } else if (error.message === 'LOGIN_FAILED_SHARED') {
            return { webError: new Error('Login failed in another window. Running in token-only mode.'), loginCancelled: true };
        } else if (error.message === 'LOGIN_IN_PROGRESS') {
            return { webError: null, loginCancelled: false };
        } else if (error.message === 'LOGIN_TIMEOUT') {
            return { webError: new Error('Login timed out. Click status bar to retry.'), loginCancelled: false };
        } else if (error.message.includes('Browser busy')) {
            return { webError: new Error('Another Claudemeter is logging in. Please wait and retry.'), loginCancelled: false };
        }
        return { webError: error, loginCancelled: false };
    } finally {
        if (scraper) {
            fileLog('Legacy: Closing scraper...');
            await scraper.close();
            fileLog('Legacy: Scraper closed');
        }
    }
}

async function updateStatusBarWithAllData() {
    const sessionData = sessionTracker ? await sessionTracker.getCurrentSession() : null;
    const activityStats = getActivityStats(usageData, sessionData);
    updateStatusBar(statusBarItem, usageData, activityStats, sessionData, credentialsInfo);
}

function createAutoRefreshTimer(minutes) {
    const clampedMinutes = Math.max(1, Math.min(60, minutes));

    if (clampedMinutes <= 0) return null;

    console.log(`Web auto-refresh enabled: fetching Claude.ai usage every ${clampedMinutes} minutes`);

    return setInterval(async () => {
        await performFetch();
    }, clampedMinutes * 60 * 1000);
}

function createLocalRefreshTimer(seconds) {
    const clampedSeconds = Math.max(5, Math.min(60, seconds));

    console.log(`Local refresh enabled: polling token data every ${clampedSeconds} seconds`);

    return setInterval(async () => {
        await updateTokensFromJsonl(true);
    }, clampedSeconds * 1000);
}

// Monitor Claude Code token usage via JSONL files in ~/.config/claude/projects/
async function setupTokenMonitoring(context) {
    context.subscriptions.push({
        dispose: () => {
            if (tokenDiagnosticChannel) {
                tokenDiagnosticChannel.dispose();
                tokenDiagnosticChannel = null;
            }
        }
    });

    currentWorkspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;

    // Initialise file logger with workspace path for instance identification
    initFileLogger(currentWorkspacePath);

    if (currentWorkspacePath) {
        debugLog(`Workspace path: ${currentWorkspacePath}`);
        fileLog(`Extension activated for workspace: ${currentWorkspacePath}`);
    } else {
        debugLog('No workspace folder open - will use global token search');
        fileLog('Extension activated (no workspace)');
    }

    claudeDataLoader = new ClaudeDataLoader(currentWorkspacePath, debugLog);

    const claudeDir = await claudeDataLoader.findClaudeDataDirectory();
    if (!claudeDir) {
        debugLog('Claude data directory not found');
        debugLog('Checked locations:');
        claudeDataLoader.claudeConfigPaths.forEach(p => debugLog(`  - ${p}`));
        debugLog('Token monitoring will not be available.');
        return;
    }

    debugLog(`Found Claude data directory: ${claudeDir}`);

    // Only watch project-specific directory to prevent cross-project contamination
    const projectDir = await claudeDataLoader.getProjectDataDirectory();

    if (!projectDir) {
        debugLog(`Project directory not found for workspace: ${currentWorkspacePath}`);
        debugLog(`   Expected: ${claudeDataLoader.projectDirName}`);
        debugLog('   Token monitoring will only work once Claude Code creates data for this project.');
        debugLog('   Will retry on next refresh cycle.');
        await updateTokensFromJsonl(false);
        return;
    }

    debugLog(`Watching project-specific directory ONLY: ${projectDir}`);

    await updateTokensFromJsonl(false);

    if (fs.existsSync(projectDir)) {
        jsonlWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(projectDir, '*.jsonl')
        );

        jsonlWatcher.onDidChange((uri) => {
            debugLog(`JSONL file changed: ${uri.fsPath}`);
            scheduleJsonlUpdate();
        });

        jsonlWatcher.onDidCreate((uri) => {
            debugLog(`New JSONL file created: ${uri.fsPath}`);
            scheduleJsonlUpdate();
        });

        context.subscriptions.push(jsonlWatcher);
        debugLog('File watcher active for project JSONL changes');
    }

    debugLog('Token monitoring initialised');
    debugLog(`   Watching: ${projectDir}/*.jsonl`);
}

// Build a full diagnostic state dump for bug reports. No secrets (we
// deliberately omit the OAuth access/refresh tokens and the sessionKey
// cookie value itself — only boolean "has" and expiry are reported).
//
// The dump is the single source of truth for "what does claudemeter see
// right now?". Reports with a dump attached are triagable; reports without
// one typically require a round trip to reproduce.
function buildStateDump() {
    const creds = (() => {
        try { return readCredentials(); } catch { return null; }
    })();

    const oauthAccount = (() => {
        try { return getOAuthAccount(); } catch { return null; }
    })();

    const s1mAccess = (() => {
        try { return hasMaxContextAccess(); } catch { return null; }
    })();

    const liveSessions = (() => {
        try { return getLiveSessions(); } catch { return []; }
    })();

    const workspaceSession = (() => {
        try { return findSessionForWorkspace(currentWorkspacePath); } catch { return null; }
    })();

    const fetcherDiag = (() => {
        try {
            if (httpFetcher && typeof httpFetcher.getDiagnostics === 'function') {
                return httpFetcher.getDiagnostics();
            }
        } catch { /* ignore */ }
        return null;
    })();

    // Redact anything that looks sensitive. The dump is safe to paste into
    // public issue trackers.
    const safeCreds = creds ? {
        orgId: creds.orgId,
        accountUuid: creds.accountUuid,
        email: creds.email,
        displayName: creds.displayName,
        organizationName: creds.organizationName,
        organizationRole: creds.organizationRole,
        billingType: creds.billingType,
        hasAvailableSubscription: creds.hasAvailableSubscription,
        subscriptionType: creds.subscriptionType,
        rateLimitTier: creds.rateLimitTier,
        hasAccessToken: !!creds.accessToken,
        hasRefreshToken: !!creds.refreshToken,
    } : null;

    const tokenLimitResolved = (() => {
        try { return getTokenLimit(); } catch { return null; }
    })();

    return {
        timestamp: new Date().toISOString(),
        version: getExtensionVersion(),
        mode: isLegacyMode() ? 'legacy-scraper' : 'http-fetcher',
        workspacePath: currentWorkspacePath,
        identity: getIdentityKey(creds),
        credentials: safeCreds,
        oauthAccount,
        s1mAccessCacheForCurrentOrg: s1mAccess,
        tokenLimit: tokenLimitResolved,
        liveSessionsCount: liveSessions.length,
        workspaceSession: workspaceSession ? {
            pid: workspaceSession.pid,
            sessionId: workspaceSession.sessionId,
            cwd: workspaceSession.cwd,
            startedAt: workspaceSession.startedAt,
            kind: workspaceSession.kind,
            entrypoint: workspaceSession.entrypoint,
        } : null,
        fetcher: fetcherDiag,
        usage: usageData ? {
            timestamp: usageData.timestamp,
            usagePercent: usageData.usagePercent,
            usagePercentWeek: usageData.usagePercentWeek,
            hasMonthlyCredits: !!usageData.monthlyCredits,
        } : null,
    };
}

function getExtensionVersion() {
    try {
        const pkg = require('./package.json');
        return pkg.version;
    } catch {
        return 'unknown';
    }
}

function setupCredentialsMonitoring(context) {
    // Read credentials on startup
    credentialsInfo = readCredentials();
    if (credentialsInfo) {
        fileLog(`Credentials loaded: ${formatSubscriptionType(credentialsInfo.subscriptionType)} (${formatRateLimitTier(credentialsInfo.rateLimitTier)})`);
    } else {
        fileLog('No Claude Code credentials found');
    }

    // Account identity lives in TWO files:
    //   - ~/.claude/.credentials.json — OAuth tokens (legacy identity fallback)
    //   - ~/.claude.json              — oauthAccount block (new source of truth)
    //
    // Claude Code writes both on login, but only .claude.json's oauthAccount
    // is guaranteed to contain orgId/accountUuid/email on newer builds.
    // We watch both so an account swap is detected no matter which file the
    // current Claude Code version rewrites.
    //
    // Account-switch detection uses the identity tuple (accountUuid, email,
    // orgId). ANY field differing counts as a switch — this catches:
    //   - personal → personal (same email missing from .credentials.json
    //     historically, but accountUuid differs in oauthAccount)
    //   - personal → org (orgId transition)
    //   - org → org (different orgId)
    //
    // Token fields are NOT used — OAuth rotates refresh tokens during normal
    // refresh cycles, which would cause false positives.

    const handleIdentityMaybeChanged = async (sourceLabel) => {
        const previous = credentialsInfo;
        credentialsInfo = readCredentials();

        if (!credentialsInfo) return;

        const previousKey = getIdentityKey(previous);
        const currentKey = getIdentityKey(credentialsInfo);
        const hadPrevious = previousKey !== null;
        const switched = hadPrevious && identityChanged(previousKey, currentKey);

        if (!switched) {
            await updateStatusBarWithAllData();
            return;
        }

        const fmt = (key) => {
            if (!key) return '(none)';
            const id = key.accountUuid || key.email || key.orgId;
            return id ? `${String(id).slice(0, 8)}...` : '(none)';
        };
        fileLog(`Account switched via ${sourceLabel} (${fmt(previousKey)} → ${fmt(currentKey)})`);
        fileLog(`New plan: ${formatSubscriptionType(credentialsInfo.subscriptionType)} (${formatRateLimitTier(credentialsInfo.rateLimitTier)})`);

        // Clear session so next fetch uses the new account
        if (isLegacyMode()) {
            getLegacyBrowserState().clear();
            if (fs.existsSync(PATHS.BROWSER_SESSION_DIR)) {
                try {
                    fs.rmSync(PATHS.BROWSER_SESSION_DIR, { recursive: true, force: true });
                    fileLog('Browser session cleared for account switch');
                } catch (e) {
                    fileLog(`Failed to clear browser session: ${e.message}`);
                }
            }
        } else if (httpFetcher) {
            // Clear login browser cache so the browser opens fresh for the
            // new account rather than auto-logging in as the old one
            httpFetcher.clearSession({ clearLoginBrowserCache: true });
        }
        loginWasCancelled = false;

        // Prompt user to log in for the new account
        const action = await vscode.window.showInformationMessage(
            'Claudemeter: Account switched. Log in to refresh usage data.',
            'Log In Again',
            'Later'
        );
        if (action === 'Log In Again') {
            performFetch(true).catch(err => {
                fileLog(`Post-switch fetch failed: ${err.message}`);
            });
        }
    };

    // Watcher 1: ~/.claude/.credentials.json
    const credentialsDir = path.dirname(CREDENTIALS_PATH);
    if (fs.existsSync(credentialsDir)) {
        credentialsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(credentialsDir, '.credentials.json')
        );
        const handler = () => handleIdentityMaybeChanged('.credentials.json');
        credentialsWatcher.onDidChange(handler);
        credentialsWatcher.onDidCreate(handler);
        context.subscriptions.push(credentialsWatcher);
        fileLog('Watching ~/.claude/.credentials.json for account changes');
    }

    // Watcher 2: ~/.claude.json (new source of truth for account identity)
    const claudeConfigDir = path.dirname(CLAUDE_CONFIG_PATH);
    const claudeConfigName = path.basename(CLAUDE_CONFIG_PATH);
    if (fs.existsSync(claudeConfigDir)) {
        claudeConfigWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(claudeConfigDir, claudeConfigName)
        );
        const handler = () => handleIdentityMaybeChanged('.claude.json');
        claudeConfigWatcher.onDidChange(handler);
        claudeConfigWatcher.onDidCreate(handler);
        context.subscriptions.push(claudeConfigWatcher);
        fileLog('Watching ~/.claude.json for account changes');
    }
}

// Coalesce a burst of JSONL filesystem events into a single update.
// Claude Code writes a line per turn (and Windows' ReadDirectoryChangesW
// fires multiple events per single write), so an active conversation
// can produce many fs events per second. Without this debounce each one
// re-parses every JSONL file in the project dir, which on Windows is
// CPU-heavy enough to trigger VS Code's "extension causes high CPU"
// warning.
//
// 500ms was chosen as the longest delay that still feels live for the Tk
// indicator while comfortably covering a single turn's burst of writes.
const JSONL_UPDATE_DEBOUNCE_MS = 500;

function scheduleJsonlUpdate() {
    if (jsonlUpdateTimer) clearTimeout(jsonlUpdateTimer);
    jsonlUpdateTimer = setTimeout(() => {
        jsonlUpdateTimer = null;
        updateTokensFromJsonl(false);
    }, JSONL_UPDATE_DEBOUNCE_MS);
}

async function updateTokensFromJsonl(silent = false) {
    try {
        const usage = await claudeDataLoader.getCurrentSessionUsage();

        if (!silent) {
            if (usage.isActive) {
                debugLog(`Active session: ${usage.totalTokens.toLocaleString()} tokens (${usage.messageCount} messages)`);
                debugLog(`   Cache read: ${usage.cacheReadTokens.toLocaleString()}, Cache creation: ${usage.cacheCreationTokens.toLocaleString()}`);
            } else {
                debugLog(`No active session detected (no recent JSONL activity)`);
            }
        }

        if (statusBarItem) {
            if (usage.isActive && usage.totalTokens > 0) {
                if (sessionTracker) {
                    let currentSession = await sessionTracker.getCurrentSession();
                    if (!currentSession) {
                        currentSession = await sessionTracker.startSession('Claude Code session (auto-created)');
                        debugLog(`Created new session: ${currentSession.sessionId}`);
                    }
                    // Build the full signal context so the resolver can use
                    // the authoritative live API signals when available.
                    // capabilities + webRateLimitTier come from the most
                    // recent /api/bootstrap response via the identity cache;
                    // they'll be null on tokenOnlyMode or before the first
                    // fetch completes, and the resolver falls back to local
                    // credentials in that case.
                    const liveAccountInfo = httpFetcher?.accountInfo || null;
                    const resolved = resolveTokenLimit({
                        modelIds: usage.modelIds,
                        observedFloor: usage.totalTokens,
                        capabilities: liveAccountInfo?.capabilities || null,
                        subscriptionType: credentialsInfo?.subscriptionType || null,
                    });
                    if (!silent) {
                        debugLog(`Context window resolved: ${resolved.limit.toLocaleString()} (source=${resolved.source}, confidence=${resolved.confidence})`);
                    }
                    await sessionTracker.updateTokens(usage.totalTokens, resolved.limit, resolved);
                }

                const sessionData = await sessionTracker.getCurrentSession();
                const activityStats = getActivityStats(usageData, sessionData);
                updateStatusBar(statusBarItem, usageData, activityStats, sessionData, credentialsInfo);
            } else {
                const activityStats = getActivityStats(usageData, null);
                updateStatusBar(statusBarItem, usageData, activityStats, null, credentialsInfo);
            }
        }
    } catch (error) {
        debugLog(`Error updating tokens: ${error.message}`);
    }
}

// Auto-populate debugLogFile setting on first run
async function initializeDebugLogPath() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const currentPath = config.get('debugLogFile', '');

    if (!currentPath || !currentPath.trim()) {
        const defaultPath = getDefaultDebugLogPath();
        try {
            await config.update('debugLogFile', defaultPath, vscode.ConfigurationTarget.Global);
            console.log(`Claudemeter: Initialized debugLogFile to ${defaultPath}`);
        } catch (error) {
            console.error('Failed to initialize debugLogFile setting:', error);
        }
    }
}

// Migrate deprecated boolean settings to new enum settings
async function migrateDeprecatedSettings() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    // Migrate use24HourTime (boolean) -> timeFormat (enum)
    const use24Hour = config.inspect('statusBar.use24HourTime');
    if (use24Hour?.globalValue === true) {
        await config.update('statusBar.timeFormat', '24hour', vscode.ConfigurationTarget.Global);
        await config.update('statusBar.use24HourTime', undefined, vscode.ConfigurationTarget.Global);
        console.log('Claudemeter: Migrated use24HourTime=true -> timeFormat=24hour');
    }
    if (use24Hour?.workspaceValue === true) {
        await config.update('statusBar.timeFormat', '24hour', vscode.ConfigurationTarget.Workspace);
        await config.update('statusBar.use24HourTime', undefined, vscode.ConfigurationTarget.Workspace);
    }

    // Migrate useCountdownTimer (boolean) -> timeFormat (enum)
    const useCountdown = config.inspect('statusBar.useCountdownTimer');
    if (useCountdown?.globalValue === true) {
        await config.update('statusBar.timeFormat', 'countdown', vscode.ConfigurationTarget.Global);
        await config.update('statusBar.useCountdownTimer', undefined, vscode.ConfigurationTarget.Global);
        console.log('Claudemeter: Migrated useCountdownTimer=true -> timeFormat=countdown');
    }
    if (useCountdown?.workspaceValue === true) {
        await config.update('statusBar.timeFormat', 'countdown', vscode.ConfigurationTarget.Workspace);
        await config.update('statusBar.useCountdownTimer', undefined, vscode.ConfigurationTarget.Workspace);
    }

    // Migrate useProgressBars (boolean) -> usageFormat (enum)
    const useProgressBars = config.inspect('statusBar.useProgressBars');
    if (useProgressBars?.globalValue === true) {
        await config.update('statusBar.usageFormat', 'barLight', vscode.ConfigurationTarget.Global);
        await config.update('statusBar.useProgressBars', undefined, vscode.ConfigurationTarget.Global);
        console.log('Claudemeter: Migrated useProgressBars=true -> usageFormat=barLight');
    }
    if (useProgressBars?.workspaceValue === true) {
        await config.update('statusBar.usageFormat', 'barLight', vscode.ConfigurationTarget.Workspace);
        await config.update('statusBar.useProgressBars', undefined, vscode.ConfigurationTarget.Workspace);
    }

    // Migrate tokensDisplay='both' (the old pre-2.3.3 default) to 'extended'.
    // 'both' was renamed when the enum gained 'value' / 'limit' variants so
    // that enum values describe what content shows, not a layout mode.
    // 'extended' produces the same rendering as the old 'both'.
    const tokensDisplay = config.inspect('statusBar.tokensDisplay');
    if (tokensDisplay?.globalValue === 'both') {
        await config.update('statusBar.tokensDisplay', 'extended', vscode.ConfigurationTarget.Global);
        console.log('Claudemeter: Migrated tokensDisplay=both -> extended');
    }
    if (tokensDisplay?.workspaceValue === 'both') {
        await config.update('statusBar.tokensDisplay', 'extended', vscode.ConfigurationTarget.Workspace);
    }
}

async function activate(context) {
    // Enable debug mode in Extension Development Host (F5)
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        setDevMode(true);
    }

    // Migrate any deprecated boolean settings to new enum settings
    await migrateDeprecatedSettings();

    // Auto-populate debugLogFile setting if empty
    await initializeDebugLogPath();

    // Log version on startup for debugging
    const version = context.extension.packageJSON.version;
    fileLog(`Claudemeter v${version} starting`);

    statusBarItem = createStatusBarItem(context);

    // Fetch service status immediately and set up periodic refresh (every 5 minutes)
    refreshServiceStatus().then(() => updateStatusBarWithAllData()).catch(err => {
        console.log('Claudemeter: Initial service status fetch failed:', err.message);
    });
    serviceStatusTimer = setInterval(() => {
        refreshServiceStatus().then(() => updateStatusBarWithAllData()).catch(err => {
            console.log('Claudemeter: Service status refresh failed:', err.message);
        });
    }, 5 * 60 * 1000);  // 5 minutes

    sessionTracker = new SessionTracker();

    await setupTokenMonitoring(context);
    setupCredentialsMonitoring(context);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.FETCH_NOW, async () => {
            const { webError, loginCancelled } = await performFetch(true);
            if (webError && !loginCancelled) {
                vscode.window.showErrorMessage(`Failed to fetch Claude usage: ${webError.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.OPEN_SETTINGS, async () => {
            await vscode.env.openExternal(vscode.Uri.parse('https://claude.ai/settings'));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.START_SESSION, async () => {
            try {
                const description = await vscode.window.showInputBox({
                    prompt: 'Enter a description for this Claude Code session (optional)',
                    placeHolder: 'e.g., Implementing user authentication feature',
                    value: 'Claude Code development session'
                });

                if (description === undefined) {
                    return;
                }

                const newSession = await sessionTracker.startSession(description);
                await updateStatusBarWithAllData();

                vscode.window.showInformationMessage(
                    `New session started: ${newSession.sessionId}`,
                    { modal: false }
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to start new session: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SHOW_DEBUG, async () => {
            const debugChannel = getDebugChannel();

            debugChannel.appendLine(`\n=== DIAGNOSTICS (${new Date().toLocaleString()}) ===`);
            debugChannel.appendLine(`Mode: ${isLegacyMode() ? 'Legacy (browser scraper)' : 'HTTP (streamlined)'}`);

            if (isLegacyMode() && scraper) {
                const diag = scraper.getDiagnostics();
                debugChannel.appendLine('Scraper State (Legacy):');
                debugChannel.appendLine(`  Initialised: ${diag.isInitialized}`);
                debugChannel.appendLine(`  Has Browser: ${diag.hasBrowser}`);
                debugChannel.appendLine(`  Has API Endpoint: ${diag.hasApiEndpoint}`);
                debugChannel.appendLine(`  Org ID: ${diag.currentOrgId || 'none'}`);
                debugChannel.appendLine(`  Account: ${diag.accountName || 'unknown'}`);
            } else if (httpFetcher) {
                const diag = httpFetcher.getDiagnostics();
                debugChannel.appendLine('Fetcher State:');
                debugChannel.appendLine(`  Has Cookie: ${diag.hasCookie}`);
                debugChannel.appendLine(`  Cookie Expires: ${diag.cookieExpires || 'N/A'}`);
                debugChannel.appendLine(`  Cookie Saved At: ${diag.cookieSavedAt || 'N/A'}`);
                debugChannel.appendLine(`  Org ID: ${diag.orgId || 'none'}`);
                debugChannel.appendLine(`  Subscription: ${diag.subscriptionType || 'unknown'}`);
                debugChannel.appendLine(`  Rate Limit Tier: ${diag.rateLimitTier || 'unknown'}`);
            } else {
                debugChannel.appendLine('Fetcher not initialised');
            }

            debugChannel.appendLine('');
            debugChannel.appendLine('Usage Data State:');
            if (usageData) {
                debugChannel.appendLine(`  Last Updated: ${usageData.timestamp}`);
                debugChannel.appendLine(`  Account: ${usageData.accountInfo?.name || 'unknown'}`);
                debugChannel.appendLine(`  Session Usage: ${usageData.usagePercent}%`);
                debugChannel.appendLine(`  Weekly Usage: ${usageData.usagePercentWeek}%`);
                debugChannel.appendLine(`  Has Monthly Credits: ${!!usageData.monthlyCredits}`);
            } else {
                debugChannel.appendLine('  No usage data available');
            }

            debugChannel.appendLine('=== END DIAGNOSTICS ===');
            debugChannel.show(true);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.RESET_CONNECTION, async () => {
            if (!isLegacyMode()) {
                vscode.window.showInformationMessage('Reset Connection is only available in legacy scraper mode. Use "Clear Session" instead.');
                return;
            }
            try {
                if (scraper) {
                    const result = await scraper.reset();
                    vscode.window.showInformationMessage(result.message);
                } else {
                    vscode.window.showWarningMessage('Scraper not initialised');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Reset failed: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.CLEAR_SESSION, async () => {
            try {
                const confirm = await vscode.window.showWarningMessage(
                    'This will delete your saved session. You will need to log in to Claude.ai again. Continue?',
                    { modal: true },
                    'Yes, Clear Session'
                );
                if (confirm === 'Yes, Clear Session') {
                    if (isLegacyMode()) {
                        if (!scraper) scraper = new (getScraperModule().ClaudeUsageScraper)();
                        const result = await scraper.clearSession();
                        vscode.window.showInformationMessage(result.message);
                    } else {
                        if (!httpFetcher) httpFetcher = new ClaudeHttpFetcher();
                        const result = httpFetcher.clearSession();
                        vscode.window.showInformationMessage(result.message);
                    }
                    loginWasCancelled = false;
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Clear session failed: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.RESYNC_ACCOUNT, async () => {
            // Clears the saved session and triggers a fresh browser login.
            // Use this after running /login in the Claude Code CLI when the
            // automatic account-switch detection didn't fire (e.g. personal → personal).
            try {
                if (!httpFetcher) httpFetcher = new ClaudeHttpFetcher();
                httpFetcher.clearSession({ clearLoginBrowserCache: true });
                loginWasCancelled = false;
                fileLog('Resync Account: session cleared, starting login flow');
                const { webError } = await performFetch(true);
                if (webError) {
                    vscode.window.showErrorMessage(`Login failed: ${webError.message}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Resync failed: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.OPEN_BROWSER, async () => {
            try {
                vscode.window.showInformationMessage('Opening browser for Claude.ai login...');
                if (isLegacyMode()) {
                    if (!scraper) scraper = new (getScraperModule().ClaudeUsageScraper)();
                    const result = await scraper.forceOpenBrowser();
                    if (result.success) {
                        vscode.window.showInformationMessage(result.message);
                    } else {
                        vscode.window.showErrorMessage(result.message);
                    }
                } else {
                    if (!httpFetcher) httpFetcher = new ClaudeHttpFetcher();
                    await httpFetcher.login();
                    const { webError } = await performFetch(true);
                    if (webError) {
                        vscode.window.showErrorMessage(`Fetch failed after login: ${webError.message}`);
                    }
                }
            } catch (error) {
                if (error.message === 'LOGIN_CANCELLED') {
                    vscode.window.showInformationMessage('Login cancelled.');
                } else if (error.message === 'CHROME_NOT_FOUND') {
                    vscode.window.showErrorMessage('Chromium-based browser required. Install Chrome, Chromium, Brave, or Edge.');
                } else {
                    vscode.window.showErrorMessage(`Failed to open browser: ${error.message}`);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.DUMP_STATE, async () => {
            const dump = buildStateDump();
            const channel = vscode.window.createOutputChannel('Claudemeter - State Dump');
            channel.appendLine(`=== CLAUDEMETER STATE DUMP (${new Date().toLocaleString()}) ===`);
            channel.appendLine('');
            channel.appendLine('Copy everything below this line into a bug report:');
            channel.appendLine('----------------------------------------------------');
            channel.appendLine(JSON.stringify(dump, null, 2));
            channel.appendLine('----------------------------------------------------');
            channel.show(true);
        })
    );

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    if (config.get('fetchOnStartup', true) && !config.get('tokenOnlyMode', false)) {
        console.log('Claudemeter: Scheduling fetch on startup...');
        setTimeout(async () => {
            // Check if we have a session before fetching
            const fetcher = isLegacyMode() ? null : new ClaudeHttpFetcher();
            const hasSession = isLegacyMode()
                ? (getScraperModule().ClaudeUsageScraper.prototype.hasExistingSession
                    ? new (getScraperModule().ClaudeUsageScraper)().hasExistingSession()
                    : false)
                : (fetcher && fetcher.hasExistingSession());

            if (!hasSession && !isLegacyMode()) {
                // First v2 run — no session cookie. Prompt user to log in.
                httpFetcher = fetcher;
                fileLog('No session cookie found on startup — prompting user to log in');
                const action = await vscode.window.showInformationMessage(
                    'Claudemeter: Log in to Claude.ai to see your usage limits.',
                    'Log In Now',
                    'Later'
                );
                if (action === 'Log In Now') {
                    await performFetch(true);
                }
                return;
            }

            console.log('Claudemeter: Starting fetch on startup...');
            try {
                if (fetcher && !isLegacyMode()) httpFetcher = fetcher;
                const result = await performFetch();
                if (result.webError) {
                    console.log('Claudemeter: Startup fetch web error:', result.webError.message);
                }
                console.log('Claudemeter: Fetch on startup complete');
            } catch (error) {
                console.error('Claudemeter: Fetch on startup failed:', error);
            }
        }, 2000);
    }

    const autoRefreshMinutes = config.get('autoRefreshMinutes', 5);
    autoRefreshTimer = createAutoRefreshTimer(autoRefreshMinutes);

    const localRefreshSeconds = config.get('localRefreshSeconds', 15);
    localRefreshTimer = createLocalRefreshTimer(localRefreshSeconds);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.autoRefreshMinutes`)) {
                if (autoRefreshTimer) {
                    clearInterval(autoRefreshTimer);
                    autoRefreshTimer = null;
                }

                const newConfig = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
                const newAutoRefresh = newConfig.get('autoRefreshMinutes', 5);
                autoRefreshTimer = createAutoRefreshTimer(newAutoRefresh);
            }

            if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.localRefreshSeconds`)) {
                if (localRefreshTimer) {
                    clearInterval(localRefreshTimer);
                    localRefreshTimer = null;
                }

                const newConfig = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
                const newLocalRefresh = newConfig.get('localRefreshSeconds', 15);
                localRefreshTimer = createLocalRefreshTimer(newLocalRefresh);
            }

            if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.statusBar`)) {
                await updateStatusBarWithAllData();
            }

            if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.thresholds`)) {
                await updateStatusBarWithAllData();
            }
        })
    );

    context.subscriptions.push({
        dispose: () => disposeDebugChannel()
    });
}

async function deactivate() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }

    if (localRefreshTimer) {
        clearInterval(localRefreshTimer);
        localRefreshTimer = null;
    }

    if (serviceStatusTimer) {
        clearInterval(serviceStatusTimer);
        serviceStatusTimer = null;
    }

    if (jsonlUpdateTimer) {
        clearTimeout(jsonlUpdateTimer);
        jsonlUpdateTimer = null;
    }

    if (scraper) {
        try {
            await scraper.close();
        } catch (err) {
            console.error('Error closing scraper:', err);
        }
    }
}

module.exports = {
    activate,
    deactivate
};
