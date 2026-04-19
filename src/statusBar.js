// Project:   Claudemeter
// File:      statusBar.js
// Purpose:   Multi-item status bar display with threshold-based colouring
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const { COMMANDS, CONFIG_NAMESPACE, calculateResetClockTime, getCurrencySymbol, getUse24HourTime } = require('./utils');
const {
    getStatusDisplay, formatStatusTime, STATUS_PAGE_URL,
    refreshStatus: refreshServiceStatusInternal,
    getCurrentStatus: getServiceStatusFromCache,
} = require('./serviceStatus');
const {
    formatTokensDisplay,
    formatTokensDisplayCompact,
    formatAsBar,
    DISPLAY_DEFAULT,
} = require('./statusBarFormatters');
const { composeTooltip } = require('./tooltipComposer');
const { composeClaudeLabel, HAPPY_HOUR_ICONS } = require('./claudeLabelComposer');
const { isHappyHour, nextTransition, validatePeakWindow } = require('./happyHour');

const LABEL_TEXT = 'Claude';

/**
 * Check if service status display is enabled in settings
 * @returns {boolean}
 */
function isServiceStatusEnabled() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return config.get('statusBar.showServiceStatus', true);
}

/**
 * Get status bar alignment from settings
 * @returns {vscode.StatusBarAlignment}
 */
function getStatusBarAlignment() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const alignment = config.get('statusBar.alignment', 'right');
    return alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
}

/**
 * Get status bar priority from settings
 * @returns {number}
 */
function getStatusBarPriority() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return config.get('statusBar.priority', 100);
}

/**
 * Get the usage format setting
 * @returns {string} One of: percent, barLight, barSolid, barSquare, barCircle
 */
function getUsageFormat() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return config.get('statusBar.usageFormat', 'barCircle');
}

/**
 * Get the tokens display setting (claudemeter.statusBar.tokensDisplay).
 * Controls whether the Tk status bar item shows the bar/percent
 * indicator, the k-count, or both. Default is 'both' so users
 * upgrading from 2.2.x see the new k-count alongside the existing
 * indicator.
 * @returns {string} One of: bar, count, both
 */
function getTokensDisplay() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return config.get('statusBar.tokensDisplay', DISPLAY_DEFAULT);
}

/**
 * Resolve the happy-hour icon glyph from the enum setting. Returns null
 * when disabled, invalid, or when 'custom' is chosen with no customIcon.
 */
function resolveHappyHourIcon(config) {
    const choice = config.get('happyHour.icon', 'beer');
    if (choice === 'custom') {
        const custom = config.get('happyHour.customIcon', '');
        return (typeof custom === 'string' && custom.length > 0) ? custom : null;
    }
    return HAPPY_HOUR_ICONS[choice] || HAPPY_HOUR_ICONS.beer;
}

/**
 * Compute the current happy-hour state from config + clock.
 *
 * Returns:
 *   {
 *     active:   boolean,      // true when off-peak AND enabled AND icon resolved
 *     icon:     string|null,  // resolved glyph or null when none
 *     endsAt:   Date|null,    // next transition; feeds tooltip "ends HH:MM local"
 *   }
 */
function resolveHappyHourState() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    if (!config.get('happyHour.enabled', true)) {
        return { active: false, icon: null, endsAt: null };
    }
    const peakWindow = validatePeakWindow(config.get('happyHour.peakWindow'));
    const now = new Date();
    const active = isHappyHour(now, peakWindow);
    if (!active) {
        return { active: false, icon: null, endsAt: null };
    }
    const icon = resolveHappyHourIcon(config);
    if (!icon) {
        return { active: false, icon: null, endsAt: null };
    }
    return {
        active: true,
        icon,
        endsAt: nextTransition(now, peakWindow),
    };
}

/**
 * Format percentage based on usageFormat setting.
 *
 * Non-compact: "45%" or "▓▓░░░"
 * Compact mode with percent format: "-45%" (dash prefix so
 * "S-45% Wk-10%" reads cleanly; omitted for bar formats because
 * the bar visually separates the values already).
 *
 * @param {number} percent - Percentage (0-100)
 * @param {boolean} forCompact - Whether this is for compact mode
 * @returns {string} Formatted value
 */
function formatPercent(percent, forCompact = false) {
    const format = getUsageFormat();
    if (format !== 'percent') {
        return formatAsBar(percent, format);
    }
    return forCompact ? `-${percent}%` : `${percent}%`;
}

/**
 * Compose the full Claude-label state for the current tick:
 * text, color, and platform tooltip lines (service status + happy
 * hour). Single call, consistent state, used by both the status-bar
 * label render and the tooltip composer's platform block.
 */
function composeCurrentLabel({ isRefreshing = false } = {}) {
    const serviceStatus = isServiceStatusEnabled() ? getServiceStatusFromCache() : null;
    const hh = resolveHappyHourState();

    const result = composeClaudeLabel({
        serviceStatus,
        happyHourActive: hh.active,
        happyHourIcon: hh.icon,
        happyHourEndsAt: hh.endsAt,
        isRefreshing,
    });

    // Extended tooltip lines: append service-status footer ("Last checked:
    // ...", "[View status page](...)") for parity with the previous
    // behaviour. The core icon + one-line description comes from
    // composeClaudeLabel; this adds the "metadata" rows.
    if (serviceStatus) {
        const display = getStatusDisplay(serviceStatus.indicator);
        if (serviceStatus.updatedAt) {
            result.tooltipLines.push(`Last checked: ${formatStatusTime(serviceStatus.updatedAt)}`);
        }
        if (display.color !== undefined || serviceStatus.indicator !== 'none') {
            result.tooltipLines.push(`[View status page](${STATUS_PAGE_URL})`);
        }
    }

    return {
        text: `${result.text}  `,  // trailing spaces for visual breathing room
        color: result.color ? new vscode.ThemeColor(result.color) : undefined,
        tooltipLines: result.tooltipLines,
    };
}

// Back-compat thin wrappers. Many call sites in this file already read
// one piece of the label state at a time; rather than rewrite every
// site, these helpers route through composeCurrentLabel so there's a
// single source of truth.
function getLabelTextWithStatus() {
    // Returns just the text without the trailing double-space (callers
    // add their own spacing when they need a spinner frame).
    const { text } = composeCurrentLabel();
    return text.replace(/\s+$/, '');
}

function getServiceStatusColor() {
    return composeCurrentLabel().color;
}

function getServiceStatusTooltipLines() {
    const { tooltipLines } = composeCurrentLabel();
    // Prepend a blank line if we have any content, for visual
    // separation from the section above (matches prior behaviour).
    return tooltipLines.length > 0 ? ['', ...tooltipLines] : [];
}

/**
 * Refresh service status from API and re-render the label. State
 * persistence lives in serviceStatus.js; this wrapper just chains the
 * fetch with a label update.
 * @returns {Promise<object|null>} the fetched status, or null on failure
 */
async function refreshServiceStatus() {
    if (!isServiceStatusEnabled()) {
        return null;
    }

    const result = await refreshServiceStatusInternal();

    // Update label text if initialised (only show icon when there's an issue)
    if (statusBarItems.label && !isSpinnerActive) {
        statusBarItems.label.text = `${getLabelTextWithStatus()}  `;
        statusBarItems.label.color = getServiceStatusColor();
    }
    return result;
}

/**
 * Get current service status (cached) — reads from serviceStatus module.
 * @returns {object|null}
 */
function getServiceStatus() {
    return getServiceStatusFromCache();
}

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

function renderCompactMode(sessionPercent, weeklyPercent, tokenPercent, sessionStatus, weeklyStatus, tokenStatus, tokensInfo = null) {
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

    const parts = [getLabelTextWithStatus()];
    if (sessionPercent !== null) {
        parts.push(`S${formatPercent(sessionPercent, true)}`);
    }
    if (weeklyPercent !== null) {
        parts.push(`Wk${formatPercent(weeklyPercent, true)}`);
    }
    // Tk rendering uses the new tokensDisplay setting to choose between
    // bar/percent, k-count, or both. In compact mode the 'bar' variant
    // becomes 'percent' because compact mode has no room for a literal
    // progress bar.
    if (tokenPercent !== null) {
        parts.push(formatTokensDisplayCompact({
            display: getTokensDisplay(),
            percent: tokenPercent,
            current: tokensInfo?.current ?? null,
            limit: tokensInfo?.limit ?? null,
            knownLimit: tokensInfo?.knownLimit ?? false,
        }));
    } else {
        parts.push('Tk-');
    }

    const compactText = parts.join(' ');

    let compactColor = getServiceStatusColor();
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
    creditsThresholds,
    tokensInfo = null
) {
    statusBarItems.compact.hide();
    lastDisplayedValues.compactText = null;
    statusBarItems.label.show();

    const isMinimal = displayMode === DISPLAY_MODES.MINIMAL;

    let newSessionText = null;
    let sessionVisible = false;
    if (sessionPercent !== null) {
        const sessionDisplay = formatPercent(sessionPercent);
        if (isMinimal) {
            newSessionText = `${sessionStatus.icon ? sessionStatus.icon + ' ' : ''}Se ${sessionDisplay}`;
        } else {
            newSessionText = `${sessionStatus.icon ? sessionStatus.icon + ' ' : ''}Se ${sessionDisplay} $(history) ${sessionResetTime}`;
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
        const weeklyDisplay = formatPercent(weeklyPercent);
        if (isMinimal) {
            newWeeklyText = `${weeklyStatus.icon ? weeklyStatus.icon + ' ' : ''}Wk ${weeklyDisplay}`;
        } else {
            newWeeklyText = `${weeklyStatus.icon ? weeklyStatus.icon + ' ' : ''}Wk ${weeklyDisplay} $(history) ${weeklyResetTime}`;
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

    let newTokensText;
    let tokensVisible;
    if (tokenPercent !== null) {
        const tokenDisplay = formatTokensDisplay({
            display: getTokensDisplay(),
            percent: tokenPercent,
            current: tokensInfo?.current ?? null,
            limit: tokensInfo?.limit ?? null,
            knownLimit: tokensInfo?.knownLimit ?? false,
            usageFormat: getUsageFormat(),
        });
        newTokensText = `${tokenStatus.icon ? tokenStatus.icon + ' ' : ''}Tk ${tokenDisplay}`;
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

    let newSonnetText;
    if (showSonnet && usageData && usageData.usagePercentSonnet !== null && usageData.usagePercentSonnet !== undefined) {
        const sonnetStatus = getIconAndColor(usageData.usagePercentSonnet, sonnetThresholds.warning, sonnetThresholds.error);
        const sonnetDisplay = formatPercent(usageData.usagePercentSonnet);
        newSonnetText = `${sonnetStatus.icon ? sonnetStatus.icon + ' ' : ''}${sonnetDisplay}S`;

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

    let newOpusText;
    if (showOpus && usageData && usageData.usagePercentOpus !== null && usageData.usagePercentOpus !== undefined) {
        const opusStatus = getIconAndColor(usageData.usagePercentOpus, opusThresholds.warning, opusThresholds.error);
        const opusDisplay = formatPercent(usageData.usagePercentOpus);
        newOpusText = `${opusStatus.icon ? opusStatus.icon + ' ' : ''}${opusDisplay}O`;

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

    let newCreditsText;
    if (showCredits && usageData && usageData.monthlyCredits) {
        const credits = usageData.monthlyCredits;
        const creditsStatus = getIconAndColor(credits.percent, creditsThresholds.warning, creditsThresholds.error);
        const currencySymbol = getCurrencySymbol(credits.currency);
        const usedDisplay = credits.used >= 1000
            ? `${(credits.used / 1000).toFixed(1)}K`
            : Math.round(credits.used);
        const creditsDisplay = formatPercent(credits.percent);
        newCreditsText = `${creditsStatus.icon ? creditsStatus.icon + ' ' : ''}${currencySymbol}${usedDisplay}/${creditsDisplay}`;

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

// Priority offset keeps our items grouped together in the status bar
function createStatusBarItem(context) {
    const alignment = getStatusBarAlignment();
    const basePriority = getStatusBarPriority();

    statusBarItems.label = vscode.window.createStatusBarItem(
        alignment,
        basePriority
    );
    statusBarItems.label.command = COMMANDS.FETCH_NOW;
    statusBarItems.label.text = `${getLabelTextWithStatus()}  `;
    statusBarItems.label.show();
    context.subscriptions.push(statusBarItems.label);

    statusBarItems.session = vscode.window.createStatusBarItem(
        alignment,
        basePriority - 1
    );
    statusBarItems.session.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.session);

    statusBarItems.weekly = vscode.window.createStatusBarItem(
        alignment,
        basePriority - 2
    );
    statusBarItems.weekly.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.weekly);

    statusBarItems.sonnet = vscode.window.createStatusBarItem(
        alignment,
        basePriority - 3
    );
    statusBarItems.sonnet.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.sonnet);

    statusBarItems.opus = vscode.window.createStatusBarItem(
        alignment,
        basePriority - 4
    );
    statusBarItems.opus.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.opus);

    statusBarItems.credits = vscode.window.createStatusBarItem(
        alignment,
        basePriority - 5
    );
    statusBarItems.credits.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.credits);

    statusBarItems.tokens = vscode.window.createStatusBarItem(
        alignment,
        basePriority - 6
    );
    statusBarItems.tokens.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.tokens);

    statusBarItems.compact = vscode.window.createStatusBarItem(
        alignment,
        basePriority - 1
    );
    statusBarItems.compact.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.compact);

    return statusBarItems.label;
}

function updateStatusBar(item, usageData, activityStats = null, sessionData = null, credentialsInfo = null) {
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

    const tokenOnlyMode = config.get('tokenOnlyMode', false);

    if (!usageData && !sessionData) {
        if (!isSpinnerActive) {
            if (statusBarItems.label) {
                statusBarItems.label.text = `${getLabelTextWithStatus()}  `;
                statusBarItems.label.color = getServiceStatusColor();
            }
            if (tokenOnlyMode) {
                // In token-only mode, show token gauge as waiting (no web fetch needed)
                setAllTooltips('Waiting for Claude Code session...');
                hideAllMetricItems();
                if (displayMode === DISPLAY_MODES.COMPACT) {
                    statusBarItems.compact.text = `${getLabelTextWithStatus()} Tk --`;
                    statusBarItems.compact.show();
                } else {
                    statusBarItems.tokens.text = 'Tk --';
                    statusBarItems.tokens.show();
                }
            } else {
                setAllTooltips('Click to fetch Claude usage data');
                hideAllMetricItems();
            }
        }
        return;
    }

    if (!isSpinnerActive) {
        if (statusBarItems.label) {
            statusBarItems.label.text = `${getLabelTextWithStatus()}  `;
            statusBarItems.label.color = getServiceStatusColor();
        }
    }

    // Compute derived values used by both the tooltip composer and
    // the renderers below.
    let sessionPercent = null;
    let sessionResetTime = null;
    let sessionStatus = { icon: '', color: undefined, level: 'normal' };

    let tokenPercent = null;
    let tokenStatus = { icon: '', color: undefined, level: 'normal' };
    let tokensInfo = null;

    if (sessionData && sessionData.tokenUsage) {
        tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
        tokenStatus = getIconAndColor(tokenPercent, tokenThresholds.warning, tokenThresholds.error);
        // The knownLimit flag tells formatTokensDisplay whether to show
        // a denominator. Only authoritative/configured sources are known;
        // inferred and standard fallbacks are not.
        const confidence = sessionData.tokenUsage.limitConfidence || null;
        const knownLimit = confidence === 'authoritative' || confidence === 'configured';
        tokensInfo = {
            percent: tokenPercent,
            current: sessionData.tokenUsage.current,
            limit: sessionData.tokenUsage.limit,
            knownLimit,
        };
    }

    if (usageData) {
        sessionPercent = usageData.usagePercent;
        sessionResetTime = calculateResetClockTime(usageData.resetTime);
        sessionStatus = getIconAndColor(sessionPercent, sessionThresholds.warning, sessionThresholds.error);
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
        weeklyStatus = getIconAndColor(weeklyPercent, weeklyThresholds.warning, weeklyThresholds.error);
    }

    // Compose tooltip via the pure composer.
    const extVersion = vscode.extensions.getExtension('HyperSec.claudemeter')?.packageJSON?.version;
    const platformTooltipLines = getServiceStatusTooltipLines();
    const markdownBody = composeTooltip({
        usageData,
        sessionData,
        credentialsInfo,
        activityStats,
        platformTooltipLines,
        extensionVersion: extVersion,
        claudeCodeSelectedModel: vscode.workspace.getConfiguration('claudeCode').get('selectedModel', ''),
        config: {
            tokenLimitOverride: config.get('tokenLimit', 0),
            use24HourTime: getUse24HourTime(),
            weeklyPrecisionThreshold: config.get('statusBar.weeklyPrecisionThreshold', 75),
        },
    });

    const markdown = new vscode.MarkdownString(markdownBody);
    markdown.isTrusted = true;  // Enable clickable links
    if (!isSpinnerActive) {
        setAllTooltips(markdown);
    }

    if (displayMode === DISPLAY_MODES.COMPACT) {
        renderCompactMode(sessionPercent, weeklyPercent, tokenPercent, sessionStatus, weeklyStatus, tokenStatus, tokensInfo);
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
            creditsThresholds,
            tokensInfo
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
            statusBarItems.label.text = `${getLabelTextWithStatus()} ${spinnerFrames[spinnerIndex]}`;
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
            '• Run "Claudemeter: Clear Session (Re-login)" to re-authenticate'
        ];
        const errorTooltip = new vscode.MarkdownString(errorLines.join('  \n'));

        setAllTooltips(errorTooltip);

        if (isCompactMode && statusBarItems.compact) {
            const currentText = statusBarItems.compact.text || LABEL_TEXT;
            const baseText = currentText.replace(/ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/, '');
            statusBarItems.compact.text = `${baseText} ✗`;
            statusBarItems.compact.color = new vscode.ThemeColor('errorForeground');
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${getLabelTextWithStatus()} ✗`;
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
                '• Run "Claudemeter: Clear Session (Re-login)" to re-authenticate'
            ];
        }
        const errorTooltip = new vscode.MarkdownString(errorLines.join('  \n'));

        setAllTooltips(errorTooltip);

        if (isCompactMode && statusBarItems.compact) {
            const currentText = statusBarItems.compact.text || getLabelTextWithStatus();
            const baseText = currentText.replace(/ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/, '');
            statusBarItems.compact.text = `${baseText} ⚠`;
            statusBarItems.compact.color = new vscode.ThemeColor('editorWarning.foreground');
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${getLabelTextWithStatus()} ⚠`;
            statusBarItems.label.color = new vscode.ThemeColor('editorWarning.foreground');
        }
    } else {
        if (isCompactMode && statusBarItems.compact) {
            const currentText = statusBarItems.compact.text || getLabelTextWithStatus();
            statusBarItems.compact.text = currentText.replace(/ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/, '');
            statusBarItems.compact.color = getServiceStatusColor();
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${getLabelTextWithStatus()}  `;
            statusBarItems.label.color = getServiceStatusColor();
        }
    }
}

module.exports = {
    createStatusBarItem,
    updateStatusBar,
    startSpinner,
    stopSpinner,
    refreshServiceStatus,
    getServiceStatus,
    DISPLAY_MODES
};
