// Project:   Claudemeter
// File:      statusBar.js
// Purpose:   Multi-item status bar display with threshold-based colouring
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { COMMANDS, CONFIG_NAMESPACE, calculateResetClockTime, getCurrencySymbol, getUse24HourTime } = require('./utils');
const {
    STATUS_PAGE_URL,
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
const { gaugeLabels, scopedShortLabel, resolveGauges, mergeDefinitions, isGenericPanel } = require('./gauges');
const { composeClaudeLabel } = require('./claudeLabelComposer');
const { describeAuthFailure } = require('./authFailure');
const { isHappyHour, nextTransition, validatePeakWindow, HAPPY_HOUR_ICONS } = require('./happyHour');
const { isCoreApplied, globalScopeReader } = require('./declutter/state');
const { resolveColor, getColorMode: realGetColorMode } = require('./colorResolver');
const simulator = require('./simulator');
const { selectProfile } = require('./tk/profileSelector');
const { getTkLevel, rotGradientT } = require('./tk/thresholds');
const { lerpHexOklab } = require('./tk/gradient');
const { ROT_GRADIENT } = require('./tk/colorMap');
const { TIER_RECOMMENDATIONS } = require('./tk/recommendations');

const LABEL_TEXT = 'Claude';

// Weekly reset time switches from hour to minute precision once you're within
// 24h of reset AND at/above this weekly-usage %. A niche display-precision
// detail, kept as a constant rather than a user setting.
const WEEKLY_MINUTE_PRECISION_PCT = 75;

// Small PNGs embedded into the tooltip as base64 data URIs. VS Code markdown
// tooltips render PNG (not SVG) images, and only inline-data / trusted URIs.
// Read once and cached: the assets never change at runtime and the tooltip
// rebuilds constantly. Returns '' if an asset is missing so the tooltip
// degrades (drops the image) rather than breaking. Both PNGs are pre-sized
// because markdown has no width control - native px IS the display width.
// main = dist/extension.js, so assets/ sits one level up from the bundle.
const assetUriCache = new Map(); // filename -> data URI ('' if unavailable)
function assetDataUri(filename) {
    if (assetUriCache.has(filename)) return assetUriCache.get(filename);
    let uri = '';
    try {
        const b64 = fs.readFileSync(path.join(__dirname, '..', 'assets', filename)).toString('base64');
        uri = `data:image/png;base64,${b64}`;
    } catch { /* missing asset -> '' */ }
    assetUriCache.set(filename, uri);
    return uri;
}

// Slim claudemeter banner header (assets/logo-tooltip.png, generate.py -w 158).
// A single markdown hard break (not a blank line) so the account line sits
// tight under the banner rather than a paragraph gap below it.
function getTooltipLogoHeader() {
    const uri = assetDataUri('logo-tooltip.png');
    return uri ? `![claudemeter](${uri})  \n` : '';
}

// Tiny tertiary HyperI lockup (wordmark + hound, no data trail) for the footer
// brand link (assets/hyperi-brand.png).
function getBrandIconDataUri() {
    return assetDataUri('hyperi-brand.png');
}

// Build a MarkdownString for an error / not-logged-in tooltip, carrying the
// same slim logo header as the main tooltip. isTrusted so the header's data-URI
// image renders (the error copy itself has no command links); supportThemeIcons
// for parity with the main tooltip.
function makeErrorTooltip(errorLines) {
    const md = new vscode.MarkdownString(getTooltipLogoHeader() + errorLines.join('  \n'));
    md.isTrusted = true;
    md.supportThemeIcons = true;
    return md;
}

/**
 * Return colorMode, consulting the simulator override first.
 * @returns {'color'|'basic'}
 */
function getColorMode() {
    const override = simulator.getColorMode();
    return override !== null ? override : realGetColorMode();
}

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
    return config.get('statusBar.priority', 10000);
}

/**
 * Get the usage format setting
 * @returns {string} One of: percent, barLight, barSolid, barSquare, barCircle
 */
function getUsageFormat() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const inspected = config.inspect('statusBar.usageFormat');
    if (inspected) {
        if (inspected.workspaceFolderValue !== undefined) return inspected.workspaceFolderValue;
        if (inspected.workspaceValue !== undefined) return inspected.workspaceValue;
        if (inspected.globalValue !== undefined) return inspected.globalValue;
    }
    // Platform-aware default: Windows status-bar fonts commonly lack U+25CB
    // (○ - White Circle), which forces a fallback font with mismatched
    // metrics and renders barCircle as uneven `●●OO` instead of `●●○○○`.
    // Block Elements (▓░) sit in a Unicode range that every standard
    // monospace font ships, so barLight renders cleanly on Windows. macOS
    // (SF Mono / Menlo) and most Linux fonts (DejaVu / Liberation / Noto)
    // all include the Geometric Shapes glyphs, so barCircle stays default
    // there.
    return process.platform === 'win32' ? 'barLight' : 'barCircle';
}

/**
 * Get the tokens display setting (claudemeter.statusBar.tokensDisplay).
 * Controls how much of the Tk indicator's numeric half is shown next to
 * the bar/percent. Falls back to DISPLAY_DEFAULT (currently 'limit')
 * when unset. See statusBarFormatters.js for the per-mode rendering and
 * the legacy 'both' -> 'extended' migration.
 * @returns {string} One of: bar, value, extended, limit, count
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
    const choice = config.get('happyHour.icon', 'sparkle');
    if (choice === 'custom') {
        const custom = config.get('happyHour.customIcon', '');
        return (typeof custom === 'string' && custom.length > 0) ? custom : null;
    }
    return HAPPY_HOUR_ICONS[choice] || HAPPY_HOUR_ICONS.sparkle;
}

// Nopilot offer: due until the Copilot group is applied or the user turns the
// feature off.
function resolveNopilotOffer() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    if (!config.get('nopilot.enabled', true)) return false;
    const root = vscode.workspace.getConfiguration();
    return !isCoreApplied(globalScopeReader(root));
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
    // Simulator override first
    const simHappy = simulator.getHappyHour();
    if (simHappy === false) {
        return { active: false, icon: null, endsAt: null };
    }
    if (simHappy === true) {
        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        const icon = resolveHappyHourIcon(config);
        if (!icon) return { active: false, icon: null, endsAt: null };
        return {
            active: true,
            icon,
            endsAt: new Date(Date.now() + 60 * 60 * 1000),  // synthetic 1h
        };
    }

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    // Default false - mirrors the manifest. The peak-throttling policy
    // this panel tracks was withdrawn (see happyHour.js header).
    if (!config.get('happyHour.enabled', false)) {
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
 * Compose the Claude-label state for the current tick: text, color,
 * and service-status tooltip lines. Happy hour has its own dedicated
 * panel (renderHappyHourPanel) and is not threaded through here.
 */
function composeCurrentLabel({ isRefreshing = false } = {}) {
    const serviceStatus = isServiceStatusEnabled() ? getServiceStatusFromCache() : null;

    const result = composeClaudeLabel({
        serviceStatus,
        isRefreshing,
    });

    // Service-status footer: only shown when the service is in a
    // non-operational state. When the service is operational, the
    // footer's "Updated HH:MM" row already conveys freshness; a
    // second timestamp ("Last checked") for the status.anthropic.com
    // poll only added confusion. During an outage the
    // poll-cadence timestamp matters again because the user wants to
    // know how fresh the outage description is.
    //
    // The time format here matches the footer's "Updated" row
    // (toLocaleTimeString, honouring claudemeter.use24HourTime) so
    // the two stamps line up visually when both are visible.
    if (serviceStatus
        && serviceStatus.indicator
        && serviceStatus.indicator !== 'none') {
        if (serviceStatus.updatedAt) {
            const ts = new Date(serviceStatus.updatedAt);
            const t = ts.toLocaleTimeString(undefined, { hour12: !getUse24HourTime() });
            result.tooltipLines.push(`Claude state last checked ${t}`);
        }
        result.tooltipLines.push(`[View status page](${STATUS_PAGE_URL})`);
    }

    return {
        text: result.text,
        color: result.color ? new vscode.ThemeColor(result.color) : undefined,
        backgroundColor: result.backgroundColor ? new vscode.ThemeColor(result.backgroundColor) : undefined,
        tooltipLines: result.tooltipLines,
        quirkyOverride: result.quirkyOverride,
    };
}

function getActivityQuipOverride() {
    return composeCurrentLabel().quirkyOverride;
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

// VS Code only honours two backgroundColor values on a StatusBarItem:
// 'statusBarItem.errorBackground' and 'statusBarItem.warningBackground'.
// We surface this so partial/major outages paint the whole item red -
// far more visible than text colour alone.
function getServiceStatusBackground() {
    return composeCurrentLabel().backgroundColor;
}

// Apply the outage background to every claudemeter status-bar item so
// the whole cluster lights up red/yellow, not just the leftmost label.
// Items that own transient state (spinner, happy-hour panel) are skipped.
function setAllBackgrounds(background) {
    forEachPanel((item, key) => {
        if (key === 'spinner' || key === 'happyHour') return;
        item.backgroundColor = background;
    });
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
    if (statusBarItems.label) {
        statusBarItems.label.text = getLabelTextWithStatus();
        statusBarItems.label.color = getServiceStatusColor();
    }
    setAllBackgrounds(getServiceStatusBackground());
    return result;
}

/**
 * Get current service status (cached) - reads from serviceStatus module.
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

// The spinner is a dedicated status-bar panel just right of the Claude
// label, rather than a manually-animated suffix on the label text. It
// uses VS Code's built-in `$(sync~spin)` codicon, which auto-rotates
// without needing our own setInterval.
let isSpinnerActive = false;

// Status-bar slots for model-scoped weekly limits (the Fable cap and whatever
// Anthropic scopes next). The payload returns one today; two slots leave room
// for a second without re-registering items, and the tooltip lists every
// entry, so a third is reported rather than dropped silently.
const SCOPED_SLOTS = 2;

let statusBarItems = {
    label: null,
    spinner: null,       // transient - shown only while a fetch is in flight
    happyHour: null,     // transient - shown only during off-peak
    session: null,
    weekly: null,
    scoped: [],          // SCOPED_SLOTS items, each shown only above 0%
    tokens: null,
    credits: null,
    compact: null
};

let lastDisplayedValues = {
    sessionText: null,
    weeklyText: null,
    scopedTexts: [],
    tokensText: null,
    creditsText: null,
    compactText: null
};

// Helper functions

function getIconAndColor(percent, warningThreshold = 80, errorThreshold = 90) {
    if (percent >= errorThreshold) {
        return {
            icon: '$(error)',
            color: new vscode.ThemeColor('claudemeter.outageRed'),
            level: 'error'
        };
    } else if (percent >= warningThreshold) {
        return {
            icon: '$(warning)',
            color: new vscode.ThemeColor('charts.yellow'),
            level: 'warning'
        };
    }
    return { icon: '', color: undefined, level: 'normal' };
}

// Whether a gauge draws a threshold glyph at all. Off by default: colour
// already carries the tier, and a row of triangles reads as breakage rather
// than as usage. `statusBar.thresholdIcons` overrides the global per gauge,
// keyed by gauge id or by the model name a scoped cap reports.
// Cascade, most specific first: the per-gauge map, then the global setting
// (or the simulator standing in for it), then off.
//
// `gauge` may be several names, most specific first - a scoped cap is looked
// up by its model name before the generic 'scoped'.
function thresholdIconEnabled(gauge) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const perGauge = config.get('statusBar.thresholdIcons', {}) || {};
    const names = (Array.isArray(gauge) ? gauge : [gauge]).filter(n => typeof n === 'string');
    for (const name of names) {
        for (const [key, value] of Object.entries(perGauge)) {
            if (key.toLowerCase() === name.toLowerCase() && typeof value === 'boolean') {
                return value;
            }
        }
    }
    const simulated = simulator.getThresholdIcons();
    if (simulated !== null) return simulated;
    return config.get('statusBar.showThresholdIcons', false);
}

// Pick the prefix glyph for a usage gauge. The error-cross is
// reserved for the Claude platform-status panel where it really does
// mean "something failed". Usage gauges (Se/Wk) use the warning
// triangle even at the error threshold - high usage isn't a failure,
// just a heads-up. Tokens (Tk) never show an icon, the colour alone
// signals the state.
function gaugeIconForLevel(level, gauge) {
    if (getColorMode() === 'basic') return '';
    if (gauge === 'tokens') return '';
    if (!thresholdIconEnabled(gauge)) return '';
    if (level === 'error' || level === 'warning') return '$(warning)';
    return '';
}

/**
 * Return a status's colour, or undefined when colorMode='basic'. Used at
 * every status-bar item assignment so basic mode universally drops tints
 * without needing per-call-site conditionals.
 */
function gaugeColorOrUndefined(status) {
    if (getColorMode() === 'basic') return undefined;
    return status?.color;
}

/**
 * Map a 5-tier rot level (from getTkLevel) to the {icon, color, level}
 * shape that the rest of statusBar.js consumes.
 *
 * Tk never shows an icon (color alone signals tier). 'normal' returns
 * undefined color so bar dots render in the default text colour.
 */
function tokenStatusFromLevel(level) {
    const colour = resolveColor(level);
    return { icon: '', color: colour.themeColor, level };
}

// Scoped weekly limits for display, simulator override first.
//
// The user's gauge definitions are applied here rather than in the fetch path:
// the fetch result is shared across windows through the on-disk cache, and it
// stays free of one user's overrides. Re-resolving from the stored raw payload
// lets a definition surface a meter the fetch did not know to look for.
function getScopedWeekly(usageData) {
    const simulated = simulator.getScopedWeekly();
    if (simulated !== null) return simulated;

    const userDefinitions = vscode.workspace.getConfiguration(CONFIG_NAMESPACE)
        .get('gauges.definitions', {});
    if (usageData?.rawData && userDefinitions && Object.keys(userDefinitions).length > 0) {
        return resolveGauges(usageData.rawData, { definitions: mergeDefinitions(userDefinitions) })
            .filter(g => isGenericPanel(g) && typeof g.percent === 'number');
    }

    return Array.isArray(usageData?.scopedWeekly) ? usageData.scopedWeekly : [];
}

// User label overrides, keyed by gauge id for the fixed gauges and by the
// payload's model name for the scoped ones.
function getGaugeLabelOverrides() {
    return vscode.workspace.getConfiguration(CONFIG_NAMESPACE).get('gauges.labels', {}) || {};
}

function hideScopedItems() {
    statusBarItems.scoped.forEach((item, i) => {
        item.hide();
        lastDisplayedValues.scopedTexts[i] = null;
    });
}

function hideAllMetricItems() {
    statusBarItems.session.hide();
    statusBarItems.weekly.hide();
    hideScopedItems();
    statusBarItems.tokens.hide();
    statusBarItems.credits.hide();
    statusBarItems.compact.hide();
}

// Apply the main Claude usage tooltip to every primary panel.
// Transient panels that own their own tooltip are excluded: spinner
// ("Checking Claude...") and happyHour (off-peak countdown).
function setAllTooltips(tooltip) {
    forEachPanel((item, key) => {
        if (key === 'spinner' || key === 'happyHour') return;
        item.tooltip = tooltip;
    });
}

// Walk every registered panel, flattening the scoped slot array so callers
// treat one item and a group of items the same way.
function forEachPanel(fn) {
    Object.entries(statusBarItems).forEach(([key, value]) => {
        if (!value) return;
        if (Array.isArray(value)) {
            value.forEach(item => item && fn(item, key));
            return;
        }
        fn(value, key);
    });
}

// Convert a future Date into a duration-string like "2h 30m" / "5d 21h"
// that calculateResetClockTime understands. Used only for the happy-hour
// panel - other panels already receive duration strings from the API.
function dateToDurationString(futureDate) {
    if (!(futureDate instanceof Date)) return '0m';
    const diffMs = futureDate.getTime() - Date.now();
    const totalMinutes = Math.max(0, Math.floor(diffMs / 60000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

// Long-form ends-at datetime for tooltips. Matches tooltipComposer's
// "Resets Sunday 19 April at 2:01 pm" style so the happy-hour row
// sits alongside session/weekly rows without format drift.
function formatEndsAt(date, use24Hour) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
        hour12: !use24Hour,
    });
}

function renderHappyHourPanel() {
    const item = statusBarItems.happyHour;
    if (!item) return;

    const hh = resolveHappyHourState();
    if (!hh.active) {
        item.hide();
        return;
    }

    const countdown = hh.endsAt
        ? calculateResetClockTime(dateToDurationString(hh.endsAt))
        : '';
    item.text = countdown ? `${hh.icon} ${countdown}` : hh.icon;

    const endsText = hh.endsAt
        ? ` — off-peak, ends ${formatEndsAt(hh.endsAt, getUse24HourTime())}`
        : ' — off-peak';
    const md = new vscode.MarkdownString(`**Happy hour**${endsText}`);
    md.isTrusted = true;
    md.supportThemeIcons = true;
    item.tooltip = md;
    item.show();
}

function renderCompactMode(sessionPercent, weeklyPercent, tokenPercent, sessionStatus, weeklyStatus, tokenStatus, tokensInfo = null, scopedEntries = []) {
    statusBarItems.label.hide();
    statusBarItems.session.hide();
    statusBarItems.weekly.hide();
    hideScopedItems();
    statusBarItems.tokens.hide();
    statusBarItems.credits.hide();
    lastDisplayedValues.sessionText = null;
    lastDisplayedValues.weeklyText = null;
    lastDisplayedValues.tokensText = null;

    const labels = getGaugeLabelOverrides();
    const parts = [getLabelTextWithStatus()];
    if (sessionPercent !== null) {
        parts.push(`${gaugeLabels('session', labels).compact}${formatPercent(sessionPercent, true)}`);
    }
    if (weeklyPercent !== null) {
        parts.push(`${gaugeLabels('weekly', labels).compact}${formatPercent(weeklyPercent, true)}`);
    }
    for (const entry of scopedEntries) {
        parts.push(`${scopedShortLabel(entry.label, labels)}${formatPercent(entry.percent, true)}`);
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
        parts.push(`${gaugeLabels('tokens', labels).compact}-`);
    }

    const compactText = parts.join(' ');

    let compactColor = getServiceStatusColor();
    if (getColorMode() !== 'basic') {
        const levels = [sessionStatus.level, weeklyStatus.level, tokenStatus.level];
        if (levels.includes('error')) {
            compactColor = new vscode.ThemeColor('claudemeter.outageRed');
        } else if (levels.includes('warning')) {
            compactColor = new vscode.ThemeColor('charts.yellow');
        } else if (tokenStatus.level === 'rotDeep') {
            compactColor = new vscode.ThemeColor('claudemeter.rotDeep');
        } else if (tokenStatus.level === 'rotLight') {
            compactColor = new vscode.ThemeColor('claudemeter.rotLight');
        }
    }

    // Compact aggregate icon mirrors the per-gauge rule: only Se/Wk drive the
    // prefix, and they always use the warning triangle - never the error
    // cross. Tokens are signalled by colour only. It follows the same
    // threshold-icon setting, taking whichever of the two gauges enables it.
    const sessionWeeklyLevels = [sessionStatus.level, weeklyStatus.level];
    const compactIconOn = gaugeIconForLevel('warning', 'session') || gaugeIconForLevel('warning', 'weekly');
    const icon = (compactIconOn
        && (sessionWeeklyLevels.includes('error') || sessionWeeklyLevels.includes('warning')))
        ? '$(warning) '
        : '';

    statusBarItems.compact.color = compactColor;
    if (compactText !== lastDisplayedValues.compactText) {
        statusBarItems.compact.text = `${icon}${compactText}`;
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
    visibleScoped,
    showCredits,
    scopedThresholds,
    creditsThresholds,
    tokensInfo = null
) {
    statusBarItems.compact.hide();
    lastDisplayedValues.compactText = null;
    statusBarItems.label.show();

    const isMinimal = displayMode === DISPLAY_MODES.MINIMAL;

    const labels = getGaugeLabelOverrides();

    let newSessionText = null;
    let sessionVisible = false;
    if (sessionPercent !== null) {
        const sessionDisplay = formatPercent(sessionPercent);
        const sessionIcon = gaugeIconForLevel(sessionStatus.level, 'session');
        const sessionLabel = gaugeLabels('session', labels).short;
        if (isMinimal) {
            newSessionText = `${sessionIcon ? sessionIcon + ' ' : ''}${sessionLabel} ${sessionDisplay}`;
        } else {
            newSessionText = `${sessionIcon ? sessionIcon + ' ' : ''}${sessionLabel} ${sessionDisplay} $(history) ${sessionResetTime}`;
        }
        sessionVisible = true;
    }

    if (sessionVisible) {
        // Colour reacts to tier changes even when the text is unchanged
        // (e.g. simulator switching the level), so update it on every tick.
        statusBarItems.session.color = gaugeColorOrUndefined(sessionStatus);
    }
    if (newSessionText !== lastDisplayedValues.sessionText) {
        if (sessionVisible) {
            statusBarItems.session.text = newSessionText;
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
        const weeklyIcon = gaugeIconForLevel(weeklyStatus.level, 'weekly');
        const weeklyLabel = gaugeLabels('weekly', labels).short;
        if (isMinimal) {
            newWeeklyText = `${weeklyIcon ? weeklyIcon + ' ' : ''}${weeklyLabel} ${weeklyDisplay}`;
        } else {
            newWeeklyText = `${weeklyIcon ? weeklyIcon + ' ' : ''}${weeklyLabel} ${weeklyDisplay} $(history) ${weeklyResetTime}`;
        }
        weeklyVisible = true;
    }

    if (weeklyVisible) {
        statusBarItems.weekly.color = gaugeColorOrUndefined(weeklyStatus);
    }
    if (newWeeklyText !== lastDisplayedValues.weeklyText) {
        if (weeklyVisible) {
            statusBarItems.weekly.text = newWeeklyText;
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
        // Tk deliberately has no icon at any level - the colour alone
        // signals warning/error. See gaugeIconForLevel for rationale.
        newTokensText = `${gaugeLabels('tokens', labels).short} ${tokenDisplay}`;
        tokensVisible = true;
    } else {
        newTokensText = `${gaugeLabels('tokens', labels).short} -`;
        tokensVisible = true;
    }

    if (tokensVisible) {
        // Tk colour MUST update on every tick - the rot tiers
        // (rotLight/rotDeep) often fire when the gauge text stays
        // identical (e.g. 80% bar with a 1m limit), so gating colour on
        // text-change leaves the gauge in the previous tier's colour.
        statusBarItems.tokens.color = gaugeColorOrUndefined(tokenStatus);
    }
    if (newTokensText !== lastDisplayedValues.tokensText) {
        if (tokensVisible) {
            statusBarItems.tokens.text = newTokensText;
            statusBarItems.tokens.show();
        } else {
            statusBarItems.tokens.hide();
        }
        lastDisplayedValues.tokensText = newTokensText;
    }

    // Simulator overrides for the scoped gauges and credits panel. Each
    // override only changes the percent; the rest of the rendering (currency,
    // used count) stays drawn from real data so the visual shape matches
    // production. Set null to fall through to real values.
    const simCredits = simulator.getCreditsPercent();

    statusBarItems.scoped.forEach((item, i) => {
        const entry = visibleScoped[i];
        if (!entry) {
            item.hide();
            lastDisplayedValues.scopedTexts[i] = null;
            return;
        }
        const status = getIconAndColor(entry.percent, scopedThresholds.warning, scopedThresholds.error);
        const icon = gaugeIconForLevel(status.level, [entry.label, 'scoped']);
        // Label leads the value, as it does on Se / Wk / Tk.
        const text = `${icon ? icon + ' ' : ''}${scopedShortLabel(entry.label, labels)} ${formatPercent(entry.percent)}`;
        item.color = gaugeColorOrUndefined(status);
        if (text !== lastDisplayedValues.scopedTexts[i]) {
            item.text = text;
            item.show();
            lastDisplayedValues.scopedTexts[i] = text;
        }
    });

    // Credits override only meaningful when real monthlyCredits exists -
    // the override changes the percent for tier-colour testing but keeps
    // currency/used/limit from real data.
    const realCredits = usageData?.monthlyCredits;
    const effectiveCredits = (simCredits !== null && realCredits)
        ? { ...realCredits, percent: simCredits }
        : realCredits;

    let newCreditsText;
    if (showCredits && effectiveCredits) {
        const credits = effectiveCredits;
        const creditsStatus = getIconAndColor(credits.percent, creditsThresholds.warning, creditsThresholds.error);
        const currencySymbol = getCurrencySymbol(credits.currency);
        const usedDisplay = credits.used >= 1000
            ? `${(credits.used / 1000).toFixed(1)}K`
            : Math.round(credits.used);
        const creditsDisplay = formatPercent(credits.percent);
        const creditsIcon = gaugeIconForLevel(creditsStatus.level, 'credits');
        newCreditsText = `${creditsIcon ? creditsIcon + ' ' : ''}${currencySymbol}${usedDisplay}/${creditsDisplay}`;

        statusBarItems.credits.color = gaugeColorOrUndefined(creditsStatus);
        if (newCreditsText !== lastDisplayedValues.creditsText) {
            statusBarItems.credits.text = newCreditsText;
            statusBarItems.credits.show();
            lastDisplayedValues.creditsText = newCreditsText;
        }
    } else {
        statusBarItems.credits.hide();
        lastDisplayedValues.creditsText = null;
    }
}

// Main functions

// Cluster contiguity strategy:
//
// 1. basePriority defaults to 10000 - well above VS Code core editor
//    items (overtype/encoding/EOL/language/ln-col, all priorities ~100-101)
//    and most other extensions (typically <2000). The whole cluster
//    therefore lands together to the LEFT of core items, with no chance
//    of OVR or similar slotting in between.
// 2. Fractional offsets (0.2 to 0.9) order our own items inside the
//    cluster: leftmost is the Claude label (10000.9), rightmost is the
//    Tokens panel (10000.2). The 0.7 spread is wide enough that a stray
//    extension item at integer 10000 still sits OUTSIDE our cluster,
//    not in the middle of it.
function createStatusBarItem(context) {
    const alignment = getStatusBarAlignment();
    const basePriority = getStatusBarPriority();

    statusBarItems.label = vscode.window.createStatusBarItem(
        alignment,
        basePriority + 0.9
    );
    statusBarItems.label.command = COMMANDS.FETCH_NOW;
    statusBarItems.label.text = getLabelTextWithStatus();
    statusBarItems.label.show();
    context.subscriptions.push(statusBarItems.label);

    // Transient spinner panel - appears only while a fetch is in flight.
    // Sits just right of the label using $(sync~spin) which VS Code
    // auto-animates, so we don't need an interval-driven frame loop.
    statusBarItems.spinner = vscode.window.createStatusBarItem(
        alignment,
        basePriority + 0.85
    );
    statusBarItems.spinner.text = '$(sync~spin)';
    statusBarItems.spinner.tooltip = 'Checking Claude...';
    statusBarItems.spinner.command = COMMANDS.FETCH_NOW;
    // Initially hidden - shown only during startSpinner().
    context.subscriptions.push(statusBarItems.spinner);

    // Transient happy-hour panel - visible only during Anthropic's
    // off-peak window. Positioned between spinner and session.
    statusBarItems.happyHour = vscode.window.createStatusBarItem(
        alignment,
        basePriority + 0.8
    );
    statusBarItems.happyHour.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.happyHour);

    statusBarItems.session = vscode.window.createStatusBarItem(
        alignment,
        basePriority + 0.7
    );
    statusBarItems.session.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.session);

    statusBarItems.weekly = vscode.window.createStatusBarItem(
        alignment,
        basePriority + 0.6
    );
    statusBarItems.weekly.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.weekly);

    // Scoped weekly slots sit between Weekly and Tokens.
    statusBarItems.scoped = [];
    for (let i = 0; i < SCOPED_SLOTS; i++) {
        const item = vscode.window.createStatusBarItem(
            alignment,
            basePriority + 0.5 - i * 0.05
        );
        item.command = COMMANDS.FETCH_NOW;
        statusBarItems.scoped.push(item);
        context.subscriptions.push(item);
    }

    statusBarItems.credits = vscode.window.createStatusBarItem(
        alignment,
        basePriority + 0.3
    );
    statusBarItems.credits.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.credits);

    statusBarItems.tokens = vscode.window.createStatusBarItem(
        alignment,
        basePriority + 0.2
    );
    statusBarItems.tokens.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.tokens);

    statusBarItems.compact = vscode.window.createStatusBarItem(
        alignment,
        basePriority + 0.7
    );
    statusBarItems.compact.command = COMMANDS.FETCH_NOW;
    context.subscriptions.push(statusBarItems.compact);

    return statusBarItems.label;
}

function updateStatusBar(item, usageData, activityStats = null, sessionData = null, credentialsInfo = null) {
    // Happy-hour panel is independent of fetch state - render on
    // every tick so the countdown stays fresh.
    renderHappyHourPanel();

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const displayMode = config.get('statusBar.displayMode', DISPLAY_MODES.DEFAULT);
    const showScopedWeekly = config.get('statusBar.showScopedWeekly', true);
    const showCredits = config.get('statusBar.showCredits', false);

    const globalWarning = config.get('thresholds.warning', 80);
    const globalError = config.get('thresholds.error', 90);

    // Per-gauge thresholds: the schema declares each key with default 0,
    // and 0 here means "inherit the global". Anything > 0 wins over the
    // gauge-specific fallback, which itself wins over the global.
    const getThresholds = (gauge, defaultWarning = globalWarning, defaultError = globalError) => {
        const warning = config.get(`thresholds.${gauge}.warning`);
        const error = config.get(`thresholds.${gauge}.error`);
        return {
            warning: (warning !== undefined && warning !== null && warning > 0) ? warning : defaultWarning,
            error: (error !== undefined && error !== null && error > 0) ? error : defaultError
        };
    };

    const sessionThresholds = getThresholds('session');
    const weeklyThresholds = getThresholds('weekly');
    const scopedThresholds = getThresholds('scoped');
    const creditsThresholds = getThresholds('credits');

    const tokenOnlyMode = config.get('tokenOnlyMode', false);

    if (!usageData && !sessionData) {
        if (statusBarItems.label) {
            statusBarItems.label.text = getLabelTextWithStatus();
            statusBarItems.label.color = getServiceStatusColor();
        }
        setAllBackgrounds(getServiceStatusBackground());
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
        return;
    }

    if (statusBarItems.label) {
        statusBarItems.label.text = getLabelTextWithStatus();
        statusBarItems.label.color = getServiceStatusColor();
    }
    setAllBackgrounds(getServiceStatusBackground());

    // Compute derived values used by both the tooltip composer and
    // the renderers below.
    let sessionPercent = null;
    let sessionResetTime = null;
    let sessionStatus = { icon: '', color: undefined, level: 'normal' };

    let tokenPercent = null;
    let tokenStatus = { icon: '', color: undefined, level: 'normal' };
    let tokensInfo = null;

    // Profile-driven Tk threshold resolution.
    // Reads detection signals from the credentials/usage stack, applies
    // the user's profileOverride if set, then resolves to a profile.
    // getTkLevel maps absolute tokens used -> 5-tier level. Bar fill is
    // still computed as a percentage for the gauge dots.
    let tokenProfile;
    let tokenLevel;

    if (sessionData && sessionData.tokenUsage) {
        tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
        const limit = sessionData.tokenUsage.limit;

        // Profile selection - simulator override > setting override > detection
        const { PROFILES } = require('./tk/profiles');
        const simProfile = simulator.getProfileOverride();
        const settingOverride = config.get('thresholds.tokens.profileOverride', '');
        const effectiveOverride = simProfile || settingOverride;

        if (effectiveOverride && PROFILES[effectiveOverride]) {
            tokenProfile = PROFILES[effectiveOverride];
        } else {
            tokenProfile = selectProfile({
                subscriptionType: credentialsInfo?.subscriptionType,
                rateLimitTier: credentialsInfo?.rateLimitTier,
                orgType: usageData?.accountInfo?.orgType,
            });
        }

        // Apply per-profile threshold overrides from claudemeter.thresholds.tokens.profiles
        const userProfileOverrides = config.get('thresholds.tokens.profiles', {});
        if (userProfileOverrides && userProfileOverrides[tokenProfile.name]?.thresholds) {
            tokenProfile = {
                ...tokenProfile,
                thresholds: {
                    ...tokenProfile.thresholds,
                    ...userProfileOverrides[tokenProfile.name].thresholds,
                },
            };
        }

        // Simulator override beats colour-mode short-circuit beats live computation
        const simLevel = simulator.getTokenLevel();
        const simUsed = simulator.getTokenUsed();
        const effectiveUsed = simUsed !== null ? simUsed : sessionData.tokenUsage.current;

        tokenLevel = simLevel !== null
            ? simLevel
            : (getColorMode() === 'basic'
                ? 'normal'
                : getTkLevel(effectiveUsed, tokenProfile, limit));
        tokenStatus = tokenStatusFromLevel(tokenLevel);

        // The simulator's "used" override drives the whole gauge - bar fill
        // and count, not just the tier tint - so scrubbing it in F5 moves the
        // visible needle, matching what a real session at that usage shows.
        if (simUsed !== null && limit > 0) {
            tokenPercent = Math.round((effectiveUsed / limit) * 100);
        }

        // Continuous white->blue rot gradient: when there's a real numeric
        // `used` (no tier-snap override) and colour mode is on, replace the
        // two discrete rot swatches with an OKLab-interpolated hex. Outside
        // the rot zone rotGradientT returns null and the discrete
        // normal/warning/error colour from tokenStatusFromLevel stands.
        if (simLevel === null && getColorMode() === 'color') {
            const t = rotGradientT(effectiveUsed, tokenProfile, limit);
            if (t !== null) {
                tokenStatus = {
                    ...tokenStatus,
                    color: lerpHexOklab(ROT_GRADIENT.start, ROT_GRADIENT.end, t),
                };
            }
        }

        const confidence = sessionData.tokenUsage.limitConfidence || null;
        const knownLimit = confidence === 'authoritative' || confidence === 'configured';
        tokensInfo = {
            percent: tokenPercent,
            current: effectiveUsed,
            limit: sessionData.tokenUsage.limit,
            knownLimit,
            level: tokenLevel,
            profile: tokenProfile.name,
            recommendation: TIER_RECOMMENDATIONS[tokenLevel] || null,
        };
    }

    if (usageData) {
        sessionPercent = usageData.usagePercent;
        sessionResetTime = calculateResetClockTime(usageData.resetTime);
        sessionStatus = getIconAndColor(sessionPercent, sessionThresholds.warning, sessionThresholds.error);
    }
    const simSession = simulator.getSessionPercent();
    if (simSession !== null) {
        sessionPercent = simSession;
        sessionStatus = getIconAndColor(sessionPercent, sessionThresholds.warning, sessionThresholds.error);
    }

    let weeklyPercent = null;
    let weeklyResetTime = null;
    let weeklyStatus = { icon: '', color: undefined, level: 'normal' };

    if (usageData && usageData.usagePercentWeek !== undefined) {
        weeklyPercent = usageData.usagePercentWeek;
        const resetTimeStr = usageData.resetTimeWeek || '';
        const isWithin24hrs = !resetTimeStr.includes('d');
        const needsMinutePrecision = isWithin24hrs && weeklyPercent >= WEEKLY_MINUTE_PRECISION_PCT;
        const weeklyTimeFormat = needsMinutePrecision
            ? { hour: 'numeric', minute: '2-digit' }
            : { hour: 'numeric' };
        weeklyResetTime = calculateResetClockTime(usageData.resetTimeWeek, weeklyTimeFormat);
        weeklyStatus = getIconAndColor(weeklyPercent, weeklyThresholds.warning, weeklyThresholds.error);
    }
    const simWeekly = simulator.getWeeklyPercent();
    if (simWeekly !== null) {
        weeklyPercent = simWeekly;
        weeklyStatus = getIconAndColor(weeklyPercent, weeklyThresholds.warning, weeklyThresholds.error);
    }

    // Compose tooltip via the pure composer.
    const extPackageJson = vscode.extensions.getExtension('HyperSec.claudemeter')?.packageJSON;
    const extVersion = extPackageJson?.version;
    // Repo URL from the manifest (no hardcoded string) - normalise the
    // package.json "git+https://....git" form to a plain browsable URL.
    const repositoryUrl = (extPackageJson?.repository?.url || extPackageJson?.homepage || '')
        .replace(/^git\+/, '')
        .replace(/\.git$/, '')
        .replace(/#.*$/, '');
    // Marketplace review deep-link, built from the manifest publisher.name
    // (no hardcoded item id). The anchor jumps straight to the review tab.
    const marketplaceUrl = (extPackageJson?.publisher && extPackageJson?.name)
        ? `https://marketplace.visualstudio.com/items?itemName=${extPackageJson.publisher}.${extPackageJson.name}&ssr=false#review-details`
        : '';
    const platformTooltipLines = getServiceStatusTooltipLines();

    const markdownBody = composeTooltip({
        usageData,
        sessionData,
        credentialsInfo,
        activityStats,
        platformTooltipLines,
        activityQuipOverride: getActivityQuipOverride(),
        happyHourState: resolveHappyHourState(),
        showNopilotOffer: resolveNopilotOffer(),
        extensionVersion: extVersion,
        repositoryUrl,
        marketplaceUrl,
        brandIconDataUri: getBrandIconDataUri(),
        claudeCodeSelectedModel: vscode.workspace.getConfiguration('claudeCode').get('selectedModel', ''),
        remoteName: vscode.env.remoteName || null,
        tokensInfo,
        config: {
            tokenLimitOverride: config.get('tokenLimit', 0),
            use24HourTime: getUse24HourTime(),
            weeklyPrecisionThreshold: WEEKLY_MINUTE_PRECISION_PCT,
        },
    });

    const markdown = new vscode.MarkdownString(getTooltipLogoHeader() + markdownBody);
    markdown.isTrusted = true;  // Enable clickable links
    markdown.supportThemeIcons = true;  // Render $(codicon-name) glyphs
    setAllTooltips(markdown);

    // A scoped limit is drawn only once it registers above 0%: an account that
    // has never touched the model reports 0 and would otherwise carry a
    // permanent dead gauge.
    const visibleScoped = showScopedWeekly
        ? getScopedWeekly(usageData).filter(e => typeof e.percent === 'number' && e.percent > 0)
        : [];

    if (displayMode === DISPLAY_MODES.COMPACT) {
        renderCompactMode(sessionPercent, weeklyPercent, tokenPercent, sessionStatus, weeklyStatus, tokenStatus, tokensInfo, visibleScoped);
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
            visibleScoped.slice(0, SCOPED_SLOTS),
            showCredits,
            scopedThresholds,
            creditsThresholds,
            tokensInfo
        );
    }
}

function startSpinner() {
    if (isSpinnerActive) return;
    isSpinnerActive = true;
    if (statusBarItems.spinner) {
        statusBarItems.spinner.show();
    }
}

function stopSpinner(webError = null, tokenError = null) {
    isSpinnerActive = false;
    if (statusBarItems.spinner) {
        statusBarItems.spinner.hide();
    }

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const displayMode = config.get('statusBar.displayMode', DISPLAY_MODES.DEFAULT);
    const isCompactMode = displayMode === DISPLAY_MODES.COMPACT;

    // Checked before the combined branch: tokenError is set in every window
    // without a live Claude Code session, so the combined wording would
    // otherwise bury the auth message in the common case.
    const authFailure = webError && webError.authReason
        ? describeAuthFailure(webError.authReason, webError.authContext)
        : null;

    if (authFailure) {
        const errorLines = [`**${authFailure.title}**`, '', ...authFailure.lines];
        if (tokenError) {
            errorLines.push('', 'No Claude Code session in this window, so no context gauge either.');
        }
        errorLines.push('', authFailure.canRelogin
            ? '• **Click to log into Claude Code**'
            : '• Run "Claudemeter: Show Debug Output" for details');

        setAllTooltips(makeErrorTooltip(errorLines));

        if (isCompactMode && statusBarItems.compact) {
            statusBarItems.compact.text = `${statusBarItems.compact.text || getLabelTextWithStatus()} ⚠`;
            statusBarItems.compact.color = new vscode.ThemeColor('charts.yellow');
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${getLabelTextWithStatus()} ⚠`;
            statusBarItems.label.color = new vscode.ThemeColor('charts.yellow');
        }
    } else if (webError && tokenError) {
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
        ];
        const errorTooltip = makeErrorTooltip(errorLines);

        setAllTooltips(errorTooltip);

        if (isCompactMode && statusBarItems.compact) {
            statusBarItems.compact.text = `${statusBarItems.compact.text || LABEL_TEXT} ✗`;
            statusBarItems.compact.color = new vscode.ThemeColor('claudemeter.outageRed');
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${getLabelTextWithStatus()} ✗`;
            statusBarItems.label.color = new vscode.ThemeColor('claudemeter.outageRed');
        }
    } else if (webError) {
        // tokenOnlyMode is NOT handled here: performFetch short-circuits before
        // any web fetch when it's on, so webError is never set in that mode.
        const errorLines = [
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
        ];
        const errorTooltip = makeErrorTooltip(errorLines);

        setAllTooltips(errorTooltip);

        if (isCompactMode && statusBarItems.compact) {
            statusBarItems.compact.text = `${statusBarItems.compact.text || getLabelTextWithStatus()} ⚠`;
            statusBarItems.compact.color = new vscode.ThemeColor('charts.yellow');
        } else if (statusBarItems.label) {
            statusBarItems.label.text = `${getLabelTextWithStatus()} ⚠`;
            statusBarItems.label.color = new vscode.ThemeColor('charts.yellow');
        }
    }
    // No error: nothing to decorate. updateStatusBar runs immediately before
    // this and owns the normal text and colour, including the compact panel's
    // threshold and rot colours, so re-applying the service-status colour here
    // would erase them on every successful fetch.
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
