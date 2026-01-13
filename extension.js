// Project:   Claudemeter
// File:      extension.js
// Purpose:   VS Code extension entry point and lifecycle management
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

const vscode = require('vscode');
const { ClaudeUsageScraper } = require('./src/scraper');
const { createStatusBarItem, updateStatusBar, startSpinner, stopSpinner } = require('./src/statusBar');
const { ActivityMonitor } = require('./src/activityMonitor');
const { SessionTracker } = require('./src/sessionTracker');
const { ClaudeDataLoader } = require('./src/claudeDataLoader');
const { CONFIG_NAMESPACE, COMMANDS, getTokenLimit, setDevMode, isDebugEnabled, getDebugChannel, disposeDebugChannel } = require('./src/utils');

let statusBarItem;
let scraper;
let usageData = null;
let isFirstFetch = true;
let autoRefreshTimer;
let activityMonitor;
let sessionTracker;
let claudeDataLoader;
let jsonlWatcher;

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
    }
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
    if (!isManualRetry && scraper && !scraper.hasExistingSession()) {
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

// Fetch usage data from Claude.ai via browser automation
async function fetchUsage(isManualRetry = false) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const tokenOnlyMode = config.get('tokenOnlyMode', false);

    if (tokenOnlyMode) {
        console.log('Claudemeter: Token-only mode enabled, skipping web fetch');
        return { webError: null, loginCancelled: false };
    }

    if (!scraper) {
        scraper = new ClaudeUsageScraper();
    }

    let loginCancelled = false;

    try {
        // Check session BEFORE launching browser to avoid headless->headed restart
        const hasSession = scraper.hasExistingSession();

        if (hasSession) {
            await scraper.initialize(false);
        }

        await scraper.ensureLoggedIn();
        usageData = await scraper.fetchUsageData();
        isFirstFetch = false;

        return { webError: null, loginCancelled: false };
    } catch (error) {
        if (error.message === 'CHROME_NOT_FOUND') {
            return { webError: new Error('Chromium-based browser required. Install Chrome, Chromium, Brave, or Edge to fetch Claude.ai usage stats.'), loginCancelled: false };
        } else if (error.message === 'LOGIN_CANCELLED') {
            console.log('Claudemeter: Login cancelled by user, falling back to token-only mode');
            return { webError: new Error('Login cancelled. Running in token-only mode. Click status bar to retry login.'), loginCancelled: true };
        } else if (error.message === 'LOGIN_TIMEOUT') {
            return { webError: new Error('Login timed out. Click status bar to retry.'), loginCancelled: false };
        } else {
            console.error('Web scrape failed:', error);
            return { webError: error, loginCancelled: false };
        }
    } finally {
        if (scraper) {
            await scraper.close();
        }
    }
}

async function updateStatusBarWithAllData() {
    const sessionData = sessionTracker ? await sessionTracker.getCurrentSession() : null;
    const activityStats = activityMonitor ? activityMonitor.getStats(usageData, sessionData) : null;
    updateStatusBar(statusBarItem, usageData, activityStats, sessionData);
}

function createAutoRefreshTimer(minutes) {
    const clampedMinutes = Math.max(1, Math.min(60, minutes));

    if (clampedMinutes <= 0) return null;

    console.log(`Auto-refresh enabled: checking usage every ${clampedMinutes} minutes`);

    return setInterval(async () => {
        await performFetch();
    }, clampedMinutes * 60 * 1000);
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

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null;
    if (workspacePath) {
        debugLog(`Workspace path: ${workspacePath}`);
    } else {
        debugLog('No workspace folder open - will use global token search');
    }

    claudeDataLoader = new ClaudeDataLoader(workspacePath, debugLog);

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
        debugLog(`Project directory not found for workspace: ${workspacePath}`);
        debugLog(`   Expected: ${claudeDataLoader.projectDirName}`);
        debugLog('   Token monitoring will only work once Claude Code creates data for this project.');
        debugLog('   Will retry on next refresh cycle.');
        await updateTokensFromJsonl(false);
        return;
    }

    debugLog(`Watching project-specific directory ONLY: ${projectDir}`);

    await updateTokensFromJsonl(false);

    const fs = require('fs');
    if (fs.existsSync(projectDir)) {
        jsonlWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(projectDir, '*.jsonl')
        );

        jsonlWatcher.onDidChange(async (uri) => {
            debugLog(`JSONL file changed: ${uri.fsPath}`);
            await updateTokensFromJsonl(false);
        });

        jsonlWatcher.onDidCreate(async (uri) => {
            debugLog(`New JSONL file created: ${uri.fsPath}`);
            await updateTokensFromJsonl(false);
        });

        context.subscriptions.push(jsonlWatcher);
        debugLog('File watcher active for project JSONL changes');
    }

    debugLog('Token monitoring initialised');
    debugLog(`   Watching: ${projectDir}/*.jsonl`);
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
                    await sessionTracker.updateTokens(usage.totalTokens, getTokenLimit());
                }

                const sessionData = await sessionTracker.getCurrentSession();
                const activityStats = activityMonitor ? activityMonitor.getStats(usageData, sessionData) : null;
                updateStatusBar(statusBarItem, usageData, activityStats, sessionData);
            } else {
                const activityStats = activityMonitor ? activityMonitor.getStats(usageData, null) : null;
                updateStatusBar(statusBarItem, usageData, activityStats, null);
            }
        }
    } catch (error) {
        debugLog(`Error updating tokens: ${error.message}`);
    }
}

async function activate(context) {
    // Enable debug mode in Extension Development Host (F5)
    if (context.extensionMode === vscode.ExtensionMode.Development) {
        setDevMode(true);
    }

    statusBarItem = createStatusBarItem(context);

    activityMonitor = new ActivityMonitor();
    activityMonitor.startMonitoring(context);

    sessionTracker = new SessionTracker();

    await setupTokenMonitoring(context);

    // Clean up browser when extension deactivates
    context.subscriptions.push({
        dispose: () => {
            if (scraper) {
                scraper.close().catch(err => {
                    console.error('Error closing browser on dispose:', err);
                });
            }
        }
    });

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

            if (scraper) {
                const diag = scraper.getDiagnostics();
                debugChannel.appendLine('Scraper State:');
                debugChannel.appendLine(`  Initialised: ${diag.isInitialized}`);
                debugChannel.appendLine(`  Connected Browser: ${diag.isConnectedBrowser}`);
                debugChannel.appendLine(`  Has Browser: ${diag.hasBrowser}`);
                debugChannel.appendLine(`  Has Page: ${diag.hasPage}`);
                debugChannel.appendLine(`  Has API Endpoint: ${diag.hasApiEndpoint}`);
                debugChannel.appendLine(`  Has API Headers: ${diag.hasApiHeaders}`);
                debugChannel.appendLine(`  Has Credits Endpoint: ${diag.hasCreditsEndpoint}`);
                debugChannel.appendLine(`  Has Overage Endpoint: ${diag.hasOverageEndpoint}`);
                debugChannel.appendLine(`  Captured Endpoints: ${diag.capturedEndpointsCount}`);
                debugChannel.appendLine(`  Session Dir: ${diag.sessionDir}`);
                debugChannel.appendLine(`  Has Existing Session: ${diag.hasExistingSession}`);
            } else {
                debugChannel.appendLine('Scraper not initialised');
            }

            debugChannel.appendLine('');
            debugChannel.appendLine('Usage Data State:');
            if (usageData) {
                debugChannel.appendLine(`  Last Updated: ${usageData.timestamp}`);
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
            try {
                if (scraper) {
                    const result = await scraper.reset();
                    isFirstFetch = true;
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
                if (scraper) {
                    const confirm = await vscode.window.showWarningMessage(
                        'This will delete your saved browser session. You will need to log in to Claude.ai again. Continue?',
                        { modal: true },
                        'Yes, Clear Session'
                    );
                    if (confirm === 'Yes, Clear Session') {
                        const result = await scraper.clearSession();
                        isFirstFetch = true;
                        vscode.window.showInformationMessage(result.message);
                    }
                } else {
                    vscode.window.showWarningMessage('Scraper not initialised');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Clear session failed: ${error.message}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.OPEN_BROWSER, async () => {
            try {
                if (scraper) {
                    vscode.window.showInformationMessage('Opening browser for Claude.ai login...');
                    const result = await scraper.forceOpenBrowser();
                    if (result.success) {
                        vscode.window.showInformationMessage(result.message);
                    } else {
                        vscode.window.showErrorMessage(result.message);
                    }
                } else {
                    vscode.window.showWarningMessage('Scraper not initialised');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open browser: ${error.message}`);
            }
        })
    );

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    if (config.get('fetchOnStartup', true)) {
        console.log('Claudemeter: Scheduling fetch on startup...');
        setTimeout(async () => {
            console.log('Claudemeter: Starting fetch on startup...');
            try {
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
