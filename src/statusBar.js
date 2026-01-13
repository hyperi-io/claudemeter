// Project:   Claudemeter
// File:      statusBar.js
// Purpose:   Multi-item status bar display with threshold-based colouring
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

const vscode = require('vscode');
const { COMMANDS, CONFIG_NAMESPACE, calculateResetClockTime, calculateResetClockTimeExpanded, getCurrencySymbol } = require('./utils');

const LABEL_TEXT = 'Claude';

const DISPLAY_MODES = {
    DEFAULT: 'default',
    MINIMAL: 'minimal',
    COMPACT: 'compact'
};

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerIndex = 0;
let spinnerInterval = null;
let isSpinnerActive = false;

let statusBarItems = {
    label: null,
    session: null,
    weekly: null,
    sonnet: null,
    opus: null,
    tokens: null,
    credits: null,
    compact: null
};

let lastDisplayedValues = {
    sessionText: null,
    weeklyText: null,
    sonnetText: null,
    opusText: null,
    tokensText: null,
    creditsText: null,
    compactText: null
};

// Helper functions

function getIconAndColor(percent, warningThreshold = 80, errorThreshold = 90) {
    if (percent >= errorThreshold) {
        return {
            icon: '$(error)',
            color: new vscode.ThemeColor('errorForeground'),
            level: 'error'
        };
    } else if (percent >= warningThreshold) {
        return {
            icon: '$(warning)',
            color: new vscode.ThemeColor('editorWarning.foreground'),
            level: 'warning'
        };
    }
    return { icon: '', color: undefined, level: 'normal' };
}

function hideAllMetricItems() {
    statusBarItems.session.hide();
    statusBarItems.weekly.hide();
    statusBarItems.sonnet.hide();
    statusBarItems.opus.hide();
    statusBarItems.tokens.hide();
    statusBarItems.credits.hide();
    statusBarItems.compact.hide();
}

function setAllTooltips(tooltip) {
    Object.values(statusBarItems).forEach(item => {
        if (item) {
            item.tooltip = tooltip;
        }
    });
}

function renderCompactMode(sessionPercent, weeklyPercent, tokenPercent, sessionStatus, weeklyStatus, tokenStatus) {
    statusBarItems.label.hide();
    statusBarItems.session.hide();
    statusBarItems.weekly.hide();
    statusBarItems.sonnet.hide();
    statusBarItems.opus.hide();
    statusBarItems.tokens.hide();
    statusBarItems.credits.hide();
    lastDisplayedValues.sessionText = null;
    lastDisplayedValues.weeklyText = null;
    lastDisplayedValues.tokensText = null;

    const parts = [LABEL_TEXT];
    if (sessionPercent !== null) {
        parts.push(`S-${sessionPercent}%`);
    }
    if (weeklyPercent !== null) {
        parts.push(`Wk-${weeklyPercent}%`);
    }
    if (tokenPercent !== null) {
        parts.push(`Tk-${tokenPercent}%`);
    } else {
        parts.push('Tk-');
    }

    const compactText = parts.join(' ');

    let compactColor = undefined;
    const levels = [sessionStatus.level, weeklyStatus.level, tokenStatus.level];
    if (levels.includes('error')) {
        compactColor = new vscode.ThemeColor('errorForeground');
    } else if (levels.includes('warning')) {
        compactColor = new vscode.ThemeColor('editorWarning.foreground');
    }

    let icon = '';
    if (levels.includes('error')) {
        icon = '$(error) ';
    } else if (levels.includes('warning')) {
        icon = '$(warning) ';
    }

    if (compactText !== lastDisplayedValues.compactText) {
        statusBarItems.compact.text = `${icon}${compactText}`;
        statusBarItems.compact.color = compactColor;
        statusBarItems.compact.show();
        lastDisplayedValues.compactText = compactText;
    }
}

function renderMultiPanelMode(
    displayMode,
    usageData,
    sessionPercent,
    sessionResetTime,
    sessionStatus,
    weeklyPercent,
    weeklyResetTime,
    weeklyStatus,
    tokenPercent,
    tokenStatus,
    showSonnet,
    showOpus,
    showCredits,
    sonnetThresholds,
    opusThresholds,
    creditsThresholds
) {
    statusBarItems.compact.hide();
    lastDisplayedValues.compactText = null;
    statusBarItems.label.show();

    const isMinimal = displayMode === DISPLAY_MODES.MINIMAL;

    let newSessionText = null;
    let sessionVisible = false;
    if (sessionPercent !== null) {
        if (isMinimal) {
            newSessionText = `${sessionStatus.icon ? sessionStatus.icon + ' ' : ''}Se ${sessionPercent}%`;
        } else {
            newSessionText = `${sessionStatus.icon ? sessionStatus.icon + ' ' : ''}Se ${sessionPercent}% $(history) ${sessionResetTime}`;
        }
        sessionVisible = true;
    }

    if (newSessionText !== lastDisplayedValues.sessionText) {
        if (sessionVisible) {
            statusBarItems.session.text = newSessionText;
            statusBarItems.session.color = sessionStatus.color;
            statusBarItems.session.show();
        } else {
            statusBarItems.session.hide();
        }
        lastDisplayedValues.sessionText = newSessionText;
    }

    let newWeeklyText = null;
    let weeklyVisible = false;
    if (weeklyPercent !== null) {
        if (isMinimal) {
            newWeeklyText = `${weeklyStatus.icon ? weeklyStatus.icon + ' ' : ''}Wk ${weeklyPercent}%`;
        } else {
            newWeeklyText = `${weeklyStatus.icon ? weeklyStatus.icon + ' ' : ''}Wk ${weeklyPercent}% $(history) ${weeklyResetTime}`;
        }
        weeklyVisible = true;
    }

    if (newWeeklyText !== lastDisplayedValues.weeklyText) {
        if (weeklyVisible) {
            statusBarItems.weekly.text = newWeeklyText;
            statusBarItems.weekly.color = weeklyStatus.color;
            statusBarItems.weekly.show();
        } else {
            statusBarItems.weekly.hide();
        }
        lastDisplayedValues.weeklyText = newWeeklyText;
    }

    let newTokensText = null;
    let tokensVisible = false;
    if (tokenPercent !== null) {
        newTokensText = `${tokenStatus.icon ? tokenStatus.icon + ' ' : ''}Tk ${tokenPercent}%`;
        tokensVisible = true;
    } else {
        newTokensText = 'Tk -';
        tokensVisible = true;
    }

    if (newTokensText !== lastDisplayedValues.tokensText) {
        if (tokensVisible) {
            statusBarItems.tokens.text = newTokensText;
            statusBarItems.tokens.color = tokenStatus.color;
            statusBarItems.tokens.show();
        } else {
            statusBarItems.tokens.hide();
        }
        lastDisplayedValues.tokensText = newTokensText;
    }

    let newSonnetText = null;
    if (showSonnet && usageData && usageData.usagePercentSonnet !== null && usageData.usagePercentSonnet !== undefined) {
        const sonnetStatus = getIconAndColor(usageData.usagePercentSonnet, sonnetThresholds.warning, sonnetThresholds.error);
        newSonnetText = `${sonnetStatus.icon ? sonnetStatus.icon + ' ' : ''}${usageData.usagePercentSonnet}%S`;

        if (newSonnetText !== lastDisplayedValues.sonnetText) {
            statusBarItems.sonnet.text = newSonnetText;
            statusBarItems.sonnet.color = sonnetStatus.color;
            statusBarItems.sonnet.show();
            lastDisplayedValues.sonnetText = newSonnetText;
        }
    } else {
        statusBarItems.sonnet.hide();
        lastDisplayedValues.sonnetText = null;
    }

    let newOpusText = null;
    if (showOpus && usageData && usageData.usagePercentOpus !== null && usageData.usagePercentOpus !== undefined) {
        const opusStatus = getIconAndColor(usageData.usagePercentOpus, opusThresholds.warning, opusThresholds.error);
        newOpusText = `${opusStatus.icon ? opusStatus.icon + ' ' : ''}${usageData.usagePercentOpus}%O`;

        if (newOpusText !== lastDisplayedValues.opusText) {
            statusBarItems.opus.text = newOpusText;
            statusBarItems.opus.color = opusStatus.color;
            statusBarItems.opus.show();
            lastDisplayedValues.opusText = newOpusText;
        }
    } else {
        statusBarItems.opus.hide();
        lastDisplayedValues.opusText = null;
    }

    let newCreditsText = null;
    if (showCredits && usageData && usageData.monthlyCredits) {
        const credits = usageData.monthlyCredits;
        const creditsStatus = getIconAndColor(credits.percent, creditsThresholds.warning, creditsThresholds.error);
        const currencySymbol = getCurrencySymbol(credits.currency);
        const usedDisplay = credits.used >= 1000
            ? `${(credits.used / 1000).toFixed(1)}K`
            : Math.round(credits.used);
        newCreditsText = `${creditsStatus.icon ? creditsStatus.icon + ' ' : ''}${currencySymbol}${usedDisplay}/${credits.percent}%`;

        if (newCreditsText !== lastDisplayedValues.creditsText) {
            statusBarItems.credits.text = newCreditsText;
            statusBarItems.credits.color = creditsStatus.color;
            statusBarItems.credits.show();
            lastDisplayedValues.creditsText = newCreditsText;
        }
    } else {
        statusBarItems.credits.hide();
        lastDisplayedValues.creditsText = null;
    }
}

// Main functions

// High base priority keeps our items grouped together in the status bar
function createStatusBarItem(context) {
    const basePriority = 1000;

    statusBarItems.label = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        basePriority
    );
    statusBarItems.label.command = COMMANDS.FETCH_NOW;
    statusBarItems.label.text = `${LABEL_TEXT}  `;
    statusBarItems.label.show();
    context.subscriptions.push(statusBarItems.label);

    statusBarItems.session = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        basePriority - 1
    );
    statusBarItems.session.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.session);

    statusBarItems.weekly = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        basePriority - 2
    );
    statusBarItems.weekly.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.weekly);

    statusBarItems.sonnet = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        basePriority - 3
    );
    statusBarItems.sonnet.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.sonnet);

    statusBarItems.opus = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        basePriority - 4
    );
    statusBarItems.opus.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.opus);

    statusBarItems.credits = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        basePriority - 5
    );
    statusBarItems.credits.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.credits);

    statusBarItems.tokens = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        basePriority - 6
    );
    statusBarItems.tokens.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.tokens);

    statusBarItems.compact = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        basePriority - 1
    );
    statusBarItems.compact.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.compact);

    return statusBarItems.label;
}

function updateStatusBar(item, usageData, activityStats = null, sessionData = null) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const displayMode = config.get('statusBar.displayMode', DISPLAY_MODES.DEFAULT);
    const showSonnet = config.get('statusBar.showSonnet', false);
    const showOpus = config.get('statusBar.showOpus', false);
    const showCredits = config.get('statusBar.showCredits', false);

    const globalWarning = config.get('thresholds.warning', 80);
    const globalError = config.get('thresholds.error', 90);

    const getThresholds = (gauge, defaultWarning = globalWarning) => {
        const warning = config.get(`thresholds.${gauge}.warning`);
        const error = config.get(`thresholds.${gauge}.error`);
        return {
            warning: (warning !== undefined && warning !== null && warning > 0) ? warning : defaultWarning,
            error: (error !== undefined && error !== null && error > 0) ? error : globalError
        };
    };

    const sessionThresholds = getThresholds('session');
    const tokenThresholds = getThresholds('tokens', 65);
    const weeklyThresholds = getThresholds('weekly');
    const sonnetThresholds = getThresholds('sonnet');
    const opusThresholds = getThresholds('opus');
    const creditsThresholds = getThresholds('credits');

    if (!usageData && !sessionData) {
        if (!isSpinnerActive) {
            if (statusBarItems.label) {
                statusBarItems.label.text = `${LABEL_TEXT}  `;
                statusBarItems.label.color = undefined;
            }
            setAllTooltips('Click to fetch Claude usage data');
        }
        hideAllMetricItems();
        return;
    }

    if (!isSpinnerActive) {
        if (statusBarItems.label) {
            statusBarItems.label.text = `${LABEL_TEXT}  `;
            statusBarItems.label.color = undefined;
        }
    }

    const tooltipLines = [];

    let sessionPercent = null;
    let sessionResetTime = null;
    let sessionStatus = { icon: '', color: undefined, level: 'normal' };

    let tokenPercent = null;
    let tokenStatus = { icon: '', color: undefined, level: 'normal' };

    if (sessionData && sessionData.tokenUsage) {
        tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
        tokenStatus = getIconAndColor(tokenPercent, tokenThresholds.warning, tokenThresholds.error);
    }

    if (usageData) {
        sessionPercent = usageData.usagePercent;
        sessionResetTime = calculateResetClockTime(usageData.resetTime);
        const sessionResetTimeExpanded = calculateResetClockTimeExpanded(usageData.resetTime);
        sessionStatus = getIconAndColor(sessionPercent, sessionThresholds.warning, sessionThresholds.error);

        tooltipLines.push(`**Session ${sessionPercent}%**`);
        if (tokenPercent !== null) {
            tooltipLines.push(`Tokens: ${sessionData.tokenUsage.current.toLocaleString()} / ${sessionData.tokenUsage.limit.toLocaleString()} (${tokenPercent}%)`);
        }
        tooltipLines.push(`Resets ${sessionResetTimeExpanded}`);
    } else if (tokenPercent !== null) {
        tooltipLines.push('**Session**');
        tooltipLines.push(`Tokens: ${sessionData.tokenUsage.current.toLocaleString()} / ${sessionData.tokenUsage.limit.toLocaleString()} (${tokenPercent}%)`);
    }

    let weeklyPercent = null;
    let weeklyResetTime = null;
    let weeklyStatus = { icon: '', color: undefined, level: 'normal' };

    if (usageData && usageData.usagePercentWeek !== undefined) {
        weeklyPercent = usageData.usagePercentWeek;
        const weeklyPrecisionThreshold = config.get('statusBar.weeklyPrecisionThreshold', 75);
        const resetTimeStr = usageData.resetTimeWeek || '';
        const isWithin24hrs = !resetTimeStr.includes('d');
        const needsMinutePrecision = isWithin24hrs && weeklyPercent >= weeklyPrecisionThreshold;
        const weeklyTimeFormat = needsMinutePrecision
            ? { hour: 'numeric', minute: '2-digit' }
            : { hour: 'numeric' };
        weeklyResetTime = calculateResetClockTime(usageData.resetTimeWeek, weeklyTimeFormat);
        const weeklyResetTimeExpanded = calculateResetClockTimeExpanded(usageData.resetTimeWeek);
        weeklyStatus = getIconAndColor(weeklyPercent, weeklyThresholds.warning, weeklyThresholds.error);

        tooltipLines.push('');
        tooltipLines.push(`**Weekly ${weeklyPercent}%**`);

        if (usageData.usagePercentSonnet !== null && usageData.usagePercentSonnet !== undefined) {
            tooltipLines.push(`Sonnet: ${usageData.usagePercentSonnet}%`);
        }
        if (usageData.usagePercentOpus !== null && usageData.usagePercentOpus !== undefined) {
            tooltipLines.push(`Opus: ${usageData.usagePercentOpus}%`);
        }

        tooltipLines.push(`Resets ${weeklyResetTimeExpanded}`);
    }

    if (usageData && usageData.monthlyCredits) {
        const credits = usageData.monthlyCredits;
        const currencySymbol = getCurrencySymbol(credits.currency);
        const usedFormatted = `${currencySymbol}${credits.used.toLocaleString()}`;
        const limitFormatted = `${currencySymbol}${credits.limit.toLocaleString()}`;

        tooltipLines.push('');
        tooltipLines.push('**Extra Usage**');
        tooltipLines.push(`Used: ${usedFormatted} / ${limitFormatted} ${credits.currency} (${credits.percent}%)`);

        if (usageData.prepaidCredits) {
            const prepaid = usageData.prepaidCredits;
            const prepaidSymbol = getCurrencySymbol(prepaid.currency);
            const balanceFormatted = `${prepaidSymbol}${prepaid.balance.toLocaleString()}`;
            tooltipLines.push(`Balance: ${balanceFormatted} ${prepaid.currency}`);
        }
    } else if (usageData && usageData.prepaidCredits) {
        const prepaid = usageData.prepaidCredits;
        const prepaidSymbol = getCurrencySymbol(prepaid.currency);
        const balanceFormatted = `${prepaidSymbol}${prepaid.balance.toLocaleString()}`;

        tooltipLines.push('');
        tooltipLines.push('**Credits**');
        tooltipLines.push(`Balance: ${balanceFormatted} ${prepaid.currency}`);
    }

    if (activityStats && activityStats.description) {
        tooltipLines.push('');
        tooltipLines.push(`*${activityStats.description.quirky}*`);
    }

    tooltipLines.push('');
    if (usageData) {
        tooltipLines.push(`Updated: ${usageData.timestamp.toLocaleTimeString()}`);
    }
    tooltipLines.push('Click to refresh');

    const markdown = new vscode.MarkdownString(tooltipLines.join('  \n'));
    if (!isSpinnerActive) {
        setAllTooltips(markdown);
    }

    if (displayMode === DISPLAY_MODES.COMPACT) {
        renderCompactMode(sessionPercent, weeklyPercent, tokenPercent, sessionStatus, weeklyStatus, tokenStatus);
    } else {
        renderMultiPanelMode(
            displayMode,
            usageData,
            sessionPercent,
            sessionResetTime,
            sessionStatus,
            weeklyPercent,
            weeklyResetTime,
            weeklyStatus,
            tokenPercent,
            tokenStatus,
            showSonnet,
            showOpus,
            showCredits,
            sonnetThresholds,
            opusThresholds,
            creditsThresholds
        );
    }
}

function startSpinner() {
    if (spinnerInterval) return;

    spinnerIndex = 0;
    isSpinnerActive = true;

    setAllTooltips('Checking Claude...');

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const displayMode = config.get('statusBar.displayMode', DISPLAY_MODES.DEFAULT);
    const isCompactMode = displayMode === DISPLAY_MODES.COMPACT;

    if (isCompactMode && statusBarItems.compact) {
        const currentText = statusBarItems.compact.text || LABEL_TEXT;
        const baseText = currentText.replace(/ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/, '');
        spinnerInterval = setInterval(() => {
            statusBarItems.compact.text = `${baseText} ${spinnerFrames[spinnerIndex]}`;
            spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
        }, 80);
    } else if (statusBarItems.label) {
        spinnerInterval = setInterval(() => {
            statusBarItems.label.text = `${LABEL_TEXT} ${spinnerFrames[spinnerIndex]}`;
            spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
        }, 80);
    }
}

function stopSpinner(webError = null, tokenError = null) {
    if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
    }
    isSpinnerActive = false;

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const displayMode = config.get('statusBar.displayMode', DISPLAY_MODES.DEFAULT);
    const isCompactMode = displayMode === DISPLAY_MODES.COMPACT;

    if (webError && tokenError) {
        const errorLines = [
            '**Complete Fetch Failed**',
            '',
            `Web: ${webError.message}`,
            `Tokens: ${tokenError.message}`,
            '',
            '**Debug Info**',
            `Time: ${new Date().toLocaleString()}`,
            '',
            '**Actions**',
            '• Click to retry',
            '• Run "Claudemeter: Show Debug Output" for details',
            '• Run "Claudemeter: Reset Browser Connection" to reconnect'
        ];
        const errorTooltip = new vscode.MarkdownString(errorLines.join('  \n'));

        setAllTooltips(errorTooltip);

        if (isCompactMode && statusBarItems.compact) {
            const currentText = statusBarItems.compact.text || LABEL_TEXT;
            const baseText = currentText.replace(/ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/, '');
            statusBarItems.compact.text = `${baseText} ✗`;
            statusBarItems.compact.color = new vscode.ThemeColor('errorForeground');
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${LABEL_TEXT} ✗`;
            statusBarItems.label.color = new vscode.ThemeColor('errorForeground');
        }
    } else if (webError) {
        const isLoginCancelled = webError.message.includes('Login cancelled');
        const isTokenOnlyMode = webError.message.includes('token-only mode') ||
                                config.get('tokenOnlyMode', false);

        let errorLines;
        if (isLoginCancelled || isTokenOnlyMode) {
            errorLines = [
                '**Token-Only Mode**',
                '',
                isLoginCancelled
                    ? 'Login was cancelled. Showing Claude Code tokens only.'
                    : 'Token-only mode enabled. Showing Claude Code tokens only.',
                '',
                'Claude.ai web usage (session/weekly limits) not available.',
                '',
                '**Actions**',
                '• **Click to retry login**',
                '• Or enable `claudemeter.tokenOnlyMode` in settings to disable this message'
            ];
        } else {
            errorLines = [
                '**Web Fetch Failed**',
                '',
                `Error: ${webError.message}`,
                '',
                '**Debug Info**',
                `Time: ${new Date().toLocaleString()}`,
                '',
                'Token data may still be available',
                '',
                '**Actions**',
                '• Click to retry',
                '• Run "Claudemeter: Show Debug Output" for details',
                '• Run "Claudemeter: Reset Browser Connection" to reconnect'
            ];
        }
        const errorTooltip = new vscode.MarkdownString(errorLines.join('  \n'));

        setAllTooltips(errorTooltip);

        if (isCompactMode && statusBarItems.compact) {
            const currentText = statusBarItems.compact.text || LABEL_TEXT;
            const baseText = currentText.replace(/ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/, '');
            statusBarItems.compact.text = `${baseText} ⚠`;
            statusBarItems.compact.color = new vscode.ThemeColor('editorWarning.foreground');
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${LABEL_TEXT} ⚠`;
            statusBarItems.label.color = new vscode.ThemeColor('editorWarning.foreground');
        }
    } else {
        if (isCompactMode && statusBarItems.compact) {
            const currentText = statusBarItems.compact.text || LABEL_TEXT;
            statusBarItems.compact.text = currentText.replace(/ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/, '');
            statusBarItems.compact.color = undefined;
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${LABEL_TEXT}  `;
            statusBarItems.label.color = undefined;
        }
    }
}

module.exports = {
    createStatusBarItem,
    updateStatusBar,
    startSpinner,
    stopSpinner,
    DISPLAY_MODES
};
