// Project:   Claudemeter
// File:      extension.js
// Purpose:   VS Code extension entry point and lifecycle management
// Language:  JavaScript (CommonJS)
//
// The browserless build drops all browser automation. Web usage
// (session / weekly / opus / sonnet / credits) is fetched from the
// first-party api.anthropic.com OAuth endpoints using the SAME token
// Claude Code stores -- CLI or the VS Code extension, they share one
// credential store per config dir. No
// Playwright, no sessionKey cookie, no Google-SSO login block (#49). See
// src/oauthFetcher.js and src/tokenSource.js.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const oauthFetcher = require('./src/oauthFetcher');
const { cachedFetchUsage } = require('./src/usageCache');
const { readToken, watchToken, detectAuthOverride } = require('./src/tokenSource');
const { createStatusBarItem, updateStatusBar, startSpinner, stopSpinner, refreshServiceStatus } = require('./src/statusBar');
const { getStats: getActivityStats } = require('./src/activityMonitor');
const { SessionTracker } = require('./src/sessionTracker');
const { ClaudeDataLoader } = require('./src/claudeDataLoader');
const { CONFIG_NAMESPACE, COMMANDS, getTokenLimit, resolveTokenLimit, setDevMode, isDebugEnabled, getDebugChannel, disposeDebugChannel, initFileLogger, fileLog, getDefaultDebugLogPath } = require('./src/utils');
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
// The two independent data streams the status bar renders:
//   usageData          - web usage (Se/Wk/Opus/Sonnet/Credits). Account-global,
//                        shown in ANY window whenever a fetch has succeeded.
//   currentSessionData - the LIVE Tk context for THIS window's workspace, or
//                        null when there is no workspace or no active session.
//                        Set only by updateTokensFromJsonl. NEVER the global
//                        sessionTracker.getCurrentSession() (that returns the
//                        most-recent session from ANY project and leaks another
//                        project's Tk into an empty/other window).
let usageData = null;
let currentSessionData = null;
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
let tokenWatcherDispose = null;
let awaitTokenTimer = null;
let currentWorkspacePath = null;

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
        // post-hoc - the Output channel is in-memory only.
        fileLog(message);
    }
}

// Locate the `claude` CLI. VS Code (GUI-launched) often has a stunted PATH,
// so we check common install locations first, then fall back to which/where.
// Returns an absolute path, or null if not found.
function resolveClaudeCli() {
    const isWin = process.platform === 'win32';
    const home = os.homedir();
    const candidates = isWin ? [
        path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
        path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
        path.join(home, '.local', 'bin', 'claude.exe'),
    ] : [
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.claude', 'local', 'claude'),
        path.join(home, '.npm-global', 'bin', 'claude'),
    ];
    for (const c of candidates) {
        try { if (c && fs.existsSync(c)) return c; } catch { /* keep looking */ }
    }
    try {
        const out = execFileSync(isWin ? 'where' : 'which', ['claude'], { encoding: 'utf-8', timeout: 3000 })
            .trim().split(/\r?\n/)[0];
        if (out && fs.existsSync(out)) return out;
    } catch { /* not on PATH the extension host can see */ }
    return null;
}

// Claude Code install docs, opened when the CLI isn't present.
const CLAUDE_CODE_INSTALL_URL = 'https://code.claude.com/docs/en/setup';

// No usable token: either launch `claude auth login`, or -- if Claude Code
// isn't installed at all -- tell the user this extension needs it. Anthropic's
// own login uses the user's REAL browser, so SSO works there (unlike our old
// sandboxed Playwright popup, #49).
async function beginLoginOrInstall() {
    const cli = resolveClaudeCli();
    if (!cli) {
        fileLog('claude CLI not found - prompting install');
        const pick = await vscode.window.showWarningMessage(
            'Claudemeter needs Claude Code installed - it reads Claude Code\'s login to show your usage. Install Claude Code, then log in.',
            'Install Claude Code',
            'Later'
        );
        if (pick === 'Install Claude Code') {
            vscode.env.openExternal(vscode.Uri.parse(CLAUDE_CODE_INSTALL_URL));
        }
        return;
    }
    const action = await vscode.window.showInformationMessage(
        'Claudemeter: log into Claude Code to see your usage limits.',
        'Log in',
        'Later'
    );
    if (action === 'Log in') launchClaudeLogin(cli);
}

// Run `claude auth login` in an integrated terminal (real shell PATH), then
// poll for the token so we refresh as soon as it lands.
function launchClaudeLogin(cli) {
    let bin = cli || resolveClaudeCli() || 'claude';
    // The which/where branch of resolveClaudeCli resolves via PATH, which an
    // attacker could seed with a directory whose name contains shell
    // metacharacters. Only a conservative path charset is allowed into the
    // terminal command; anything else falls back to the bare command name
    // (resolved safely by the shell's own PATH). With metacharacters excluded,
    // quoting for spaces is sufficient.
    if (!/^[\w./\\: -]+$/.test(bin)) {
        fileLog('Resolved claude path had unsafe characters - falling back to bare `claude`');
        bin = 'claude';
    }
    const quoted = bin.includes(' ') ? `"${bin}"` : bin;
    const term = vscode.window.createTerminal('Claude Code Login');
    term.show();
    term.sendText(`${quoted} auth login`);
    fileLog('Launched `claude auth login` in a terminal');
    awaitTokenThenFetch();
}

// Poll the credential store after a login launch so we refresh as soon as
// the token lands (the macOS Keychain can't be fs.watched). Best-effort,
// self-limiting: ~90s at 3s intervals. Held in a module var so a second
// login launch replaces (not stacks) the poll, and deactivate() can clear it.
function awaitTokenThenFetch() {
    if (awaitTokenTimer) clearInterval(awaitTokenTimer);
    let elapsed = 0;
    awaitTokenTimer = setInterval(async () => {
        elapsed += 3000;
        if (readToken().ok) {
            clearInterval(awaitTokenTimer);
            awaitTokenTimer = null;
            fileLog('Token appeared after login - fetching');
            await performFetch(true);
        } else if (elapsed >= 90000) {
            clearInterval(awaitTokenTimer);
            awaitTokenTimer = null;
        }
    }, 3000);
}

// Prompt to log into Claude Code (or to install it if the CLI is missing).
// Called only on an explicit user action (status-bar click / first startup) --
// auto-refresh passes isManual=false and never reaches here, so no throttle is
// needed. Every explicit click re-offers login, keeping the "click to log in"
// tooltip honest.
async function promptClaudeLogin() {
    await beginLoginOrInstall();
}

// Single-flight guard. performFetch is triggered by the auto-refresh timer,
// the credential-store watcher, the post-login poll, account-switch, and
// manual commands -- these overlap and would race the global usageData and
// the spinner (an early finisher hides the spinner while a later fetch is
// still running). Coalesce concurrent runs into one promise; a manual caller
// waits for any in-flight run then does its own, so the no-token login prompt
// still fires on demand.
let fetchInFlight = null;
async function performFetch(isManual = false) {
    if (fetchInFlight) {
        if (!isManual) return fetchInFlight;
        try { await fetchInFlight; } catch { /* the in-flight run handled its own error */ }
    }
    const run = performFetchInner(isManual);
    fetchInFlight = run;
    try {
        return await run;
    } finally {
        if (fetchInFlight === run) fetchInFlight = null;
    }
}

// Fetch web usage via the OAuth endpoints, with spinner + error handling.
// isManual is true for explicit user actions (status-bar click, command,
// first startup) -- only then do we surface the login prompt.
async function performFetchInner(isManual = false) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    let webError = null;
    let tokenError = null;
    // handled = this branch already showed its own UX (login prompt / info),
    // so a caller like FETCH_NOW should not also show a generic error toast.
    let handled = false;

    // tokenOnlyMode: user opted out of web usage, just the local Tk gauge.
    if (config.get('tokenOnlyMode', false)) {
        fileLog('Skipping web fetch - tokenOnlyMode enabled');
        if (!currentSessionData?.tokenUsage) tokenError = new Error('No token data available');
        updateStatusBarWithAllData();
        return { webError: null, tokenError, handled: true };
    }

    try {
        startSpinner();
        // Share the account-global usage across windows: fetch at most once per
        // usageRefreshSeconds, others read the cache. Avoids N windows tripping
        // the api.anthropic.com rate limit (429). Floor 30s.
        const maxAgeMs = Math.max(30, config.get('usageRefreshSeconds', 120)) * 1000;
        const res = await cachedFetchUsage(() => oauthFetcher.fetchUsageData(), maxAgeMs);
        usageData = res.usageData;
        applyProfileSignals(usageData.accountInfo);
        if (res.fromCache) {
            fileLog(res.error
                ? `Web usage from cache (live fetch failed: ${res.error.message})`
                : 'Web usage from shared cache');
        } else {
            fileLog('OAuth usage fetch OK');
        }
    } catch (error) {
        webError = error;
        if (error.message === 'NO_OAUTH_TOKEN') {
            webError = new Error('Not logged into Claude Code. Click to log in.');
            if (isManual) { await promptClaudeLogin(); handled = true; }
        } else if (error.message === 'AUTH_OVERRIDE') {
            // API key / Bedrock / Vertex user -- no subscription usage to show.
            // Informational, not an error toast; the state shows in the tooltip.
            webError = new Error(`Using ${error.detail} - subscription usage unavailable.`);
            fileLog(`Auth override active (${error.detail}); web usage unavailable`);
            handled = true;
        } else {
            fileLog(`OAuth usage fetch failed: ${error.message}`);
            console.error('Claudemeter web fetch failed:', error);
        }
    } finally {
        if (!currentSessionData?.tokenUsage) tokenError = new Error('No token data available');
        stopSpinner(webError, tokenError);
        updateStatusBarWithAllData();
    }

    return { webError, tokenError, handled };
}

// Seed the Tk profile signals (subscriptionType, rateLimitTier) from the
// stored token. On macOS the .credentials.json FILE is absent (the token
// lives in the Keychain), so readCredentials() returns null for these and
// the Tk gauge would fall back to the 'unknown' profile. tokenSource reads
// the Keychain, and the blob carries the SAME verbatim Anthropic strings
// profileSelector compares against ('max', 'default_claude_max_20x'). Safe
// to call before any web fetch and in tokenOnlyMode -- keeps the offline Tk
// gauge on the correct thresholds.
function seedTierFromToken() {
    const tok = readToken();
    if (!tok.ok) return;
    if (!credentialsInfo) credentialsInfo = {};
    if (!credentialsInfo.subscriptionType) credentialsInfo.subscriptionType = tok.subscriptionType;
    if (!credentialsInfo.rateLimitTier) credentialsInfo.rateLimitTier = tok.rateLimitTier;
}

// After a web fetch, refine those signals with the authoritative OAuth
// /profile response (rate_limit_tier is the org's, more accurate than the
// token blob's), and fill in display identity.
function applyProfileSignals(accountInfo) {
    seedTierFromToken();
    if (!accountInfo) return;
    if (!credentialsInfo) credentialsInfo = {};
    if (accountInfo.rateLimitTier) credentialsInfo.rateLimitTier = accountInfo.rateLimitTier;
    if (accountInfo.name && !credentialsInfo.displayName) credentialsInfo.displayName = accountInfo.name;
    if (accountInfo.email && !credentialsInfo.email) credentialsInfo.email = accountInfo.email;
    if (accountInfo.orgName && !credentialsInfo.organizationName) credentialsInfo.organizationName = accountInfo.orgName;
}

function updateStatusBarWithAllData() {
    const activityStats = getActivityStats(usageData, currentSessionData);
    updateStatusBar(statusBarItem, usageData, activityStats, currentSessionData, credentialsInfo);
}

// Web-usage refresh cadence, in seconds. Also the shared-cache max-age (see
// usageRefreshSeconds), so the timer and the cache agree: a tick fetches only
// when the shared cache has gone stale, and only one window actually hits the
// network. Floor 30s.
function createAutoRefreshTimer(seconds) {
    const clamped = Math.max(30, Math.min(3600, seconds));
    console.log(`Web auto-refresh enabled: every ${clamped}s (shared across windows)`);
    return setInterval(async () => {
        await performFetch();
    }, clamped * 1000);
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
        debugLog('No workspace folder open - Tk gauge stays blank (no project session)');
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
// deliberately omit the OAuth access/refresh tokens themselves - only
// presence booleans, source, scopes and expiry are reported).
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

    // Token state (no secrets - only presence, source, expiry, scopes).
    const tokenState = (() => {
        try {
            const t = readToken();
            if (!t.ok) return { ok: false, reason: t.reason, authOverride: detectAuthOverride() };
            return {
                ok: true,
                source: t.source,
                expiresAt: t.expiresAt,
                expired: t.expired,
                scopes: t.scopes,
                subscriptionType: t.subscriptionType,
                rateLimitTier: t.rateLimitTier,
            };
        } catch { return null; }
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
        mode: 'oauth',
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
        token: tokenState,
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
    // Read credentials on startup, then seed tier signals from the token so
    // the Tk gauge has the correct profile even on macOS (Keychain) before
    // the first web fetch.
    credentialsInfo = readCredentials();
    seedTierFromToken();
    if (credentialsInfo) {
        fileLog(`Credentials loaded: ${formatSubscriptionType(credentialsInfo.subscriptionType)} (${formatRateLimitTier(credentialsInfo.rateLimitTier)})`);
    } else {
        fileLog('No Claude Code credentials found');
    }

    // Account identity lives in TWO files:
    //   - ~/.claude/.credentials.json - OAuth tokens (legacy identity fallback)
    //   - ~/.claude.json              - oauthAccount block (new source of truth)
    //
    // Claude Code writes both on login, but only .claude.json's oauthAccount
    // is guaranteed to contain orgId/accountUuid/email on newer builds.
    // We watch both so an account swap is detected no matter which file the
    // current Claude Code version rewrites.
    //
    // Account-switch detection uses the identity tuple (accountUuid, email,
    // orgId). ANY field differing counts as a switch - this catches:
    //   - personal -> personal (same email missing from .credentials.json
    //     historically, but accountUuid differs in oauthAccount)
    //   - personal -> org (orgId transition)
    //   - org -> org (different orgId)
    //
    // Token fields are NOT used - OAuth rotates refresh tokens during normal
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

        // No session to clear -- the OAuth token in the store already belongs
        // to the new account (that's what changed). Just re-fetch; the new
        // account's usage comes back automatically.
        performFetch(false).catch(err => {
            fileLog(`Post-switch fetch failed: ${err.message}`);
        });
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
                // Feed the resolver the authoritative live signals when a web
                // fetch has completed. accountInfo comes from the OAuth /profile
                // response (usageData); it's null on tokenOnlyMode or before the
                // first fetch, and the resolver falls back to local creds then.
                const liveAccountInfo = usageData?.accountInfo || null;
                const resolved = resolveTokenLimit({
                    modelIds: usage.modelIds,
                    observedFloor: usage.totalTokens,
                    capabilities: liveAccountInfo?.capabilities || null,
                    subscriptionType: liveAccountInfo?.subscriptionType || credentialsInfo?.subscriptionType || null,
                });
                if (!silent) {
                    debugLog(`Context window resolved: ${resolved.limit.toLocaleString()} (source=${resolved.source}, confidence=${resolved.confidence})`);
                }
                if (sessionTracker) {
                    // Persist for history; this window owns its own session so
                    // this never reads another project's data.
                    let s = await sessionTracker.getCurrentSession();
                    if (!s) {
                        s = await sessionTracker.startSession('Claude Code session (auto-created)');
                        debugLog(`Created new session: ${s.sessionId}`);
                    }
                    await sessionTracker.updateTokens(usage.totalTokens, resolved.limit, resolved);
                }

                // The Tk display value is built straight from THIS window's live
                // read - not the global tracker - so it can never show another
                // project's context.
                currentSessionData = {
                    tokenUsage: {
                        current: usage.totalTokens,
                        limit: resolved.limit,
                        remaining: resolved.limit - usage.totalTokens,
                        lastUpdate: new Date().toISOString(),
                        limitSource: resolved.source,
                        limitConfidence: resolved.confidence,
                    },
                };
            } else {
                // No active session for this workspace (or no workspace at all).
                currentSessionData = null;
            }
            const activityStats = getActivityStats(usageData, currentSessionData);
            updateStatusBar(statusBarItem, usageData, activityStats, currentSessionData, credentialsInfo);
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

// One-shot migration of legacy percent-threshold settings to the new
// profile-driven token-runway model. Runs every activation; idempotent
// (no-ops once a user's keys are migrated and legacy keys are gone).
// See src/tk/migrate.js for the conversion math and edge cases.
//
// Uses resolveTokenLimit() which is self-contained (reads credentials,
// model IDs, etc. internally), so this is safe to call pre-first-fetch.
// Profile selection uses credentials signals only (orgType is not yet
// available - that requires a successful usageData fetch). The selector
// handles missing orgType gracefully and falls through to 'unknown'.
async function runLegacySettingsMigration() {
    try {
        const { migrateLegacySettings } = require('./src/tk/migrate');
        const { selectProfile } = require('./src/tk/profileSelector');

        // No credentials -> no profile -> nothing to migrate against
        if (!credentialsInfo) {
            return;
        }

        const profile = selectProfile({
            subscriptionType: credentialsInfo.subscriptionType,
            rateLimitTier: credentialsInfo.rateLimitTier,
            // orgType omitted - not yet available pre-first-fetch, selector
            // falls through gracefully and uses subscription/tier signals alone
        });

        // resolveTokenLimit() is self-contained: reads vscode settings,
        // model aliases, s1mAccessCache and credentials internally.
        const { limit: contextWindow } = resolveTokenLimit();
        if (!contextWindow || typeof contextWindow !== 'number') {
            return;
        }

        // Logger adapter - proxy to fileLog (already set up by this point)
        const logger = {
            appendLine: (msg) => fileLog(msg),
        };

        await migrateLegacySettings(vscode, contextWindow, profile, logger);
    } catch (err) {
        // Migration failures must never block extension activation
        try { fileLog(`[claudemeter] migration error: ${err.message}`); } catch {}
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

    // One-shot migration of legacy %-threshold settings to the new
    // profile-driven token-runway model. Runs after credentials are loaded;
    // idempotent on every activation once migration is complete.
    await runLegacySettingsMigration();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.FETCH_NOW, async () => {
            const { webError, handled } = await performFetch(true);
            if (webError && !handled) {
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
            debugChannel.appendLine('Mode: OAuth (browserless)');

            const tok = readToken();
            debugChannel.appendLine('Token State:');
            if (tok.ok) {
                debugChannel.appendLine(`  Source: ${tok.source}`);
                debugChannel.appendLine(`  Expires: ${tok.expiresAt ? new Date(tok.expiresAt).toISOString() : 'N/A'} (expired=${tok.expired})`);
                debugChannel.appendLine(`  Subscription: ${tok.subscriptionType || 'unknown'}`);
                debugChannel.appendLine(`  Rate Limit Tier: ${tok.rateLimitTier || 'unknown'}`);
                debugChannel.appendLine(`  Scopes: ${(tok.scopes || []).join(', ') || 'none'}`);
            } else {
                debugChannel.appendLine(`  No usable token (${tok.reason})`);
                const override = detectAuthOverride();
                if (override) debugChannel.appendLine(`  Auth override active: ${override}`);
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

    // Log into Claude Code. Runs `claude auth login` in a terminal --
    // Anthropic's own OAuth in the user's real browser (SSO works). When it
    // finishes, Claude Code writes the token to the shared store and we pick
    // it up. Replaces the old browser-login / paste-cookie / resync commands.
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.LOGIN_CLI, async () => {
            const override = detectAuthOverride();
            if (override) {
                vscode.window.showInformationMessage(
                    `Claudemeter reads Claude Code's subscription token, but ${override} is set - Claude Code is using that instead. Subscription usage is unavailable while it's set.`
                );
                return;
            }
            if (readToken().ok) {
                // Already have a token -- just refetch rather than re-login.
                const { webError } = await performFetch(true);
                if (webError) vscode.window.showErrorMessage(webError.message);
                return;
            }
            await beginLoginOrInstall();
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

    // Dev-only: inject a fake platform status so each indicator level
    // can be eyeballed in the status bar without waiting for a real
    // outage. Selecting "Clear" returns to live API fetches.
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SIMULATE_STATUS, async () => {
            const choice = await vscode.window.showQuickPick(
                [
                    { label: 'Clear (use real API)',           value: 'clear' },
                    { label: 'Operational',                    value: 'none' },
                    { label: 'Minor — Degraded',               value: 'minor' },
                    { label: 'Major — Partial Outage',         value: 'major' },
                    { label: 'Critical — Major Outage (dead)', value: 'critical' },
                ],
                { placeHolder: 'Simulate Claude service status (dev)' }
            );
            if (!choice) return;
            const { setSimulatedStatus } = require('./src/serviceStatus');
            setSimulatedStatus(choice.value);
            await refreshServiceStatus();
            updateStatusBarWithAllData();
        })
    );

    // Dev-only simulator commands - see src/commands/simulator.js.
    // All 12 are gated by `config.claudemeter.debug` in package.json
    // (enablement clause) so they only appear when claudemeter.debug=true.
    const { registerSimulatorCommands } = require('./src/commands/simulator');
    registerSimulatorCommands(context, performFetch);

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    if (config.get('fetchOnStartup', true) && !config.get('tokenOnlyMode', false)) {
        console.log('Claudemeter: Scheduling fetch on startup...');
        setTimeout(async () => {
            // isManual=true on startup so a first-run user with no token gets
            // the one-time login prompt. With a token it just fetches quietly.
            try {
                const result = await performFetch(true);
                if (result.webError) {
                    fileLog(`Startup fetch web note: ${result.webError.message}`);
                }
            } catch (error) {
                console.error('Claudemeter: Fetch on startup failed:', error);
            }
        }, 2000);
    }

    // Watch the credential store so a Claude Code token rotation / fresh
    // login is picked up instantly (file platforms; macOS Keychain relies
    // on the per-fetch re-read + post-login poll). Skip in tokenOnlyMode.
    if (!config.get('tokenOnlyMode', false)) {
        tokenWatcherDispose = watchToken(() => {
            fileLog('Credential store changed - refetching');
            performFetch(false).catch((err) => fileLog(`Watcher refetch failed: ${err.message}`));
        });
        context.subscriptions.push({ dispose: () => { if (tokenWatcherDispose) tokenWatcherDispose(); } });
    }

    autoRefreshTimer = createAutoRefreshTimer(config.get('usageRefreshSeconds', 120));

    const localRefreshSeconds = config.get('localRefreshSeconds', 15);
    localRefreshTimer = createLocalRefreshTimer(localRefreshSeconds);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration(`${CONFIG_NAMESPACE}.usageRefreshSeconds`)) {
                if (autoRefreshTimer) {
                    clearInterval(autoRefreshTimer);
                    autoRefreshTimer = null;
                }
                const newConfig = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
                autoRefreshTimer = createAutoRefreshTimer(newConfig.get('usageRefreshSeconds', 120));
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

    if (awaitTokenTimer) {
        clearInterval(awaitTokenTimer);
        awaitTokenTimer = null;
    }

    if (tokenWatcherDispose) {
        try { tokenWatcherDispose(); } catch { /* already gone */ }
        tokenWatcherDispose = null;
    }
}

module.exports = {
    activate,
    deactivate
};
