// Project:   Claudemeter
// File:      statusBar.js
// Purpose:   Multi-item status bar display with threshold-based colouring
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const { COMMANDS, CONFIG_NAMESPACE, calculateResetClockTime, calculateResetClockTimeExpanded, getCurrencySymbol, getUse24HourTime, formatCompact } = require('./utils');
const {
    getStatusDisplay, formatStatusTime, STATUS_PAGE_URL,
    refreshStatus: refreshServiceStatusInternal,
    getCurrentStatus: getServiceStatusFromCache,
} = require('./serviceStatus');
const { formatSubscriptionType, formatRateLimitTier } = require('./credentialsReader');
const { parseModelAlias, STANDARD_LIMIT } = require('./modelContextWindows');
const {
    formatTokensDisplay,
    formatTokensDisplayCompact,
    DISPLAY_DEFAULT,
} = require('./statusBarFormatters');

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
 * Bar style definitions
 */
const BAR_STYLES = {
    barLight: { filled: '▓', empty: '░' },
    barSolid: { filled: '█', empty: '░' },
    barSquare: { filled: '■', empty: '□' },
    barCircle: { filled: '●', empty: '○' }
};

/**
 * Format percentage as progress bar
 * @param {number} percent - Percentage (0-100)
 * @param {string} style - Bar style key
 * @param {number} width - Bar width in characters
 * @returns {string} Progress bar like "▓▓▓░░"
 */
function formatAsBar(percent, style, width = 5) {
    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round(clamped / 100 * width);
    const chars = BAR_STYLES[style] || BAR_STYLES.barLight;
    return chars.filled.repeat(filled) + chars.empty.repeat(width - filled);
}

/**
 * Format percentage based on usageFormat setting
 * @param {number} percent - Percentage (0-100)
 * @param {boolean} forCompact - Whether this is for compact mode
 * @returns {string} Formatted value (e.g., "45%", "▓▓░░░")
 */
function formatPercent(percent, forCompact = false) {
    const format = getUsageFormat();
    if (format !== 'percent') {
        return formatAsBar(percent, format);
    }
    return forCompact ? `-${percent}%` : `${percent}%`;
}

/**
 * Get the label text with service status icon prefix (only when degraded/outage)
 * @returns {string} Label text like "Claude" or "$(warning) Claude" when issues
 */
function getLabelTextWithStatus() {
    const current = getServiceStatusFromCache();
    if (isServiceStatusEnabled() && current && current.indicator !== 'none') {
        // Only show icon when there's an issue (not operational)
        const display = getStatusDisplay(current.indicator);
        return `${display.icon} ${LABEL_TEXT}`;
    }
    return `${LABEL_TEXT}`;
}

/**
 * Get ThemeColor for service status (if degraded/outage)
 * @returns {vscode.ThemeColor|undefined}
 */
function getServiceStatusColor() {
    const current = getServiceStatusFromCache();
    if (isServiceStatusEnabled() && current) {
        const display = getStatusDisplay(current.indicator);
        if (display.color) {
            return new vscode.ThemeColor(display.color);
        }
    }
    return undefined;
}

/**
 * Build service status section for tooltip
 * @returns {string[]} Array of tooltip lines
 */
function getServiceStatusTooltipLines() {
    const lines = [];
    if (!isServiceStatusEnabled()) return lines;

    const current = getServiceStatusFromCache();
    if (current) {
        const display = getStatusDisplay(current.indicator);
        lines.push('');
        lines.push(`**Service Status:** ${display.label}`);
        if (current.description && current.description !== display.label) {
            lines.push(`${current.description}`);
        }
        if (current.updatedAt) {
            lines.push(`Last checked: ${formatStatusTime(current.updatedAt)}`);
        }
        lines.push(`[View status page](${STATUS_PAGE_URL})`);
    } else {
        // No successful fetch yet — may be startup (null) or an error.
        // We still don't expose the error here; a separate design could
        // add a "(unable to fetch)" line, but for now silence is fine.
    }
    return lines;
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

    const tooltipLines = [];

    // Account identity header
    // Strip "'s Organization" / "'s Organisation" suffix from personal account names
    const rawAccountName = usageData?.accountInfo?.name;
    const accountName = rawAccountName
        ? rawAccountName.replace(/'s Organi[sz]ation$/, '')
        : null;
    const accountEmail = usageData?.accountInfo?.email;
    if (accountName && accountEmail) {
        const safeName = accountName.replace(/([*_`~[\]\\])/g, '\\$1');
        tooltipLines.push(`**${safeName}** (${accountEmail})`);
    } else if (accountName) {
        const safeName = accountName.replace(/([*_`~[\]\\])/g, '\\$1');
        tooltipLines.push(`**${safeName}**`);
    } else if (accountEmail) {
        tooltipLines.push(accountEmail);
    }
    if (credentialsInfo) {
        const plan = formatSubscriptionType(credentialsInfo.subscriptionType);
        const tier = formatRateLimitTier(credentialsInfo.rateLimitTier);
        const orgType = usageData?.accountInfo?.orgType;
        const orgName = usageData?.accountInfo?.orgName;
        // Build plan label with org type: "Max (Personal)" or "Max (Acme Corp)"
        let planLabel = plan;
        if (plan && orgType) {
            planLabel = `${plan} (${orgType})`;
        } else if (plan && orgName && !/'s Organi[sz]ation$/.test(orgName)) {
            planLabel = `${plan} (${orgName})`;
        } else if (plan) {
            planLabel = `${plan} (Personal)`;
        }
        if (planLabel && tier && tier !== plan) {
            tooltipLines.push(`${planLabel} · ${tier}`);
        } else if (planLabel) {
            tooltipLines.push(planLabel);
        }
    }
    if (sessionData && sessionData.tokenUsage) {
        const limit = sessionData.tokenUsage.limit;
        const isExtended = limit > STANDARD_LIMIT;
        // When the limit came from a non-authoritative source (rule
        // table match, observed-floor snap, standard fallback), we
        // say so in the tooltip — that way users who see a surprising
        // number know we're inferring rather than reading ground truth.
        const confidence = sessionData.tokenUsage.limitConfidence || null;
        let suffix = '';
        if (isExtended && confidence === 'authoritative') {
            suffix = ' (extended)';
        } else if (confidence === 'inferred') {
            suffix = ' (inferred)';
        } else if (confidence === 'configured') {
            suffix = ' (configured)';
        } else if (isExtended) {
            suffix = ' (extended)';
        }
        tooltipLines.push(`Context: ${formatCompact(limit)}${suffix}`);
    } else if (credentialsInfo) {
        const ccModel = vscode.workspace.getConfiguration('claudeCode').get('selectedModel', '');
        const aliasLimit = parseModelAlias(ccModel);
        const fallbackLimit = aliasLimit || STANDARD_LIMIT;
        const isExtended = fallbackLimit > STANDARD_LIMIT;
        tooltipLines.push(`Context: ${formatCompact(fallbackLimit)}${isExtended ? ' (extended)' : ''}`);
    }
    if (accountName || credentialsInfo) {
        tooltipLines.push('');
    }

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
        // a denominator in count/both modes. Limits from authoritative
        // or configured sources (user override, explicit [1m] alias,
        // rule table, cc eligibility) are considered known; inferred
        // and standard fallbacks are not.
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
        const sessionResetTimeExpanded = calculateResetClockTimeExpanded(usageData.resetTime);
        sessionStatus = getIconAndColor(sessionPercent, sessionThresholds.warning, sessionThresholds.error);

        tooltipLines.push(`**Session ${sessionPercent}%**`);
        if (tokenPercent !== null) {
            tooltipLines.push(`Tokens: ${formatCompact(sessionData.tokenUsage.current)} / ${formatCompact(sessionData.tokenUsage.limit)} (${tokenPercent}%)`);
        }
        tooltipLines.push(`Resets ${sessionResetTimeExpanded}`);
        const tokenLimitOverride = config.get('tokenLimit', 0);
        if (tokenLimitOverride > 0) {
            tooltipLines.push(`⚙ Context window override: ${formatCompact(tokenLimitOverride)}`);
        }
    } else if (tokenPercent !== null) {
        tooltipLines.push('**Session**');
        tooltipLines.push(`Tokens: ${formatCompact(sessionData.tokenUsage.current)} / ${formatCompact(sessionData.tokenUsage.limit)} (${tokenPercent}%)`);
        const tokenLimitOverride = config.get('tokenLimit', 0);
        if (tokenLimitOverride > 0) {
            tooltipLines.push(`⚙ Context window override: ${formatCompact(tokenLimitOverride)}`);
        }
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

    // Add service status to tooltip
    const serviceStatusLines = getServiceStatusTooltipLines();
    tooltipLines.push(...serviceStatusLines);

    tooltipLines.push('');
    if (usageData) {
        tooltipLines.push(`Updated: ${usageData.timestamp.toLocaleTimeString(undefined, { hour12: !getUse24HourTime() })}`);
    }
    const extVersion = vscode.extensions.getExtension('HyperSec.claudemeter')?.packageJSON?.version;
    if (extVersion) {
        tooltipLines.push(`Claudemeter v${extVersion}`);
    }
    tooltipLines.push('[Click to resync account](command:claudemeter.resyncAccount)');

    const markdown = new vscode.MarkdownString(tooltipLines.join('  \n'));
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
