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
const { COMMANDS, CONFIG_NAMESPACE, DAY_MS, calculateResetClockTime, formatCompact, formatLongDateTime, getCurrencySymbol, getUse24HourTime, toResetDate, getDebugChannel, fileLog, clientSideRemoteName } = require('./utils');
const {
    STATUS_PAGE_URL,
    refreshStatus: refreshServiceStatusInternal,
    getCurrentStatus: getServiceStatusFromCache,
} = require('./serviceStatus');
const {
    formatTokensDisplay,
    formatTokensDisplayCompact,
    formatIndicator,
    DISPLAY_DEFAULT,
} = require('./statusBarFormatters');
const { composeTooltip } = require('./tooltipComposer');
const { gaugeLabels, scopedShortLabel, resolveGauges, mergeDefinitions, isGenericPanel } = require('./gauges');
const { composeClaudeLabel } = require('./claudeLabelComposer');
const { describeAuthFailure } = require('./authFailure');
const { escapeMarkdown } = require('./markdown');
const { isHappyHour, nextTransition, validatePeakWindow, HAPPY_HOUR_ICONS } = require('./happyHour');
const { isCoreApplied, globalScopeReader, isDeclared } = require('./declutter/state');
const { resolveColor, getColorMode: realGetColorMode } = require('./colorResolver');
const simulator = require('./simulator');
const { selectProfile } = require('./tk/profileSelector');

// Where the one-time 'unknown' profile warning goes. The channel is created
// only if the warning fires.
const profileLogger = {
    appendLine: (msg) => {
        getDebugChannel().appendLine(msg);
        fileLog(msg);
    },
};
const { getTkLevel, rotGradientT } = require('./tk/thresholds');
const { lerpHexOklab } = require('./tk/gradient');
const { ROT_GRADIENT } = require('./tk/colorMap');
const { TIER_RECOMMENDATIONS } = require('./tk/recommendations');

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

// The only command links a tooltip may execute, whatever outside text reaches
// it. `isTrusted: true` would run any `command:` link in that text.
const TOOLTIP_COMMANDS = [COMMANDS.NOPILOT, COMMANDS.NOPILOT_DISMISS];

function makeTooltip(markdown, enabledCommands = []) {
    const md = new vscode.MarkdownString(markdown);
    md.isTrusted = { enabledCommands: [...enabledCommands] };
    md.supportThemeIcons = true;
    return md;
}

// An error / not-logged-in tooltip, under the same slim logo header as the
// main tooltip. Its copy links no commands.
function makeErrorTooltip(errorLines) {
    return makeTooltip(getTooltipLogoHeader() + errorLines.join('  \n'));
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
    return !isCoreApplied(globalScopeReader(root), (key) => isDeclared(root, key));
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
 * @param {number|null} percent - Percentage (0-100), or null/NaN for "-"
 * @param {boolean} forCompact - Whether this is for compact mode
 * @returns {string} Formatted value
 */
function formatPercent(percent, forCompact = false) {
    const format = getUsageFormat();
    const indicator = formatIndicator(percent, format);
    return forCompact && format === 'percent' && indicator !== '-' ? `-${indicator}` : indicator;
}

/**
 * Compose the Claude-label state for the current tick: text, color,
 * and service-status tooltip lines. Happy hour has its own dedicated
 * panel (renderHappyHourPanel) and is not threaded through here.
 */
function composeCurrentLabel() {
    const serviceStatus = isServiceStatusEnabled() ? getServiceStatusFromCache() : null;

    const result = composeClaudeLabel({ serviceStatus });

    // Service-status footer: only shown when the service is in a
    // non-operational state. When the service is operational, the
    // footer's "Updated HH:MM" row already conveys freshness; a
    // second timestamp ("Last checked") for the status.anthropic.com
    // poll only added confusion. During an outage the
    // poll-cadence timestamp matters again because the user wants to
    // know how fresh the outage description is.
    //
    // The time format here matches the footer's "Updated" row
    // (toLocaleTimeString, honouring statusBar.timeFormat) so
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

// The label text without its trailing double-space (callers add their own
// spacing when they need a spinner frame).
function getLabelTextWithStatus() {
    const { text } = composeCurrentLabel();
    return text.replace(/\s+$/, '');
}

// Paint the outage background on every primary panel so the whole cluster
// lights up red/yellow, not just the leftmost label. VS Code only honours
// 'statusBarItem.errorBackground' and 'statusBarItem.warningBackground' here.
function applyServiceStatusBackground() {
    const background = composeCurrentLabel().backgroundColor;
    forEachPrimaryPanel((item) => {
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

    if (statusBarItems.label) {
        drawHead(lastFetchError?.tokenError ?? null);
    }
    applyServiceStatusBackground();
    return result;
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

// Text last drawn per panel, keyed `<panel>Text`. show() runs only on a text
// change, so every hide drops the entry (hidePanel).
let lastDisplayedValues;

// Compact content minus the Claude label, so label status and error marker are
// redrawn rather than appended. Null while compact is hidden.
let compactParts = null;

// The last web fetch failure, kept until a fetch succeeds so local ticks redraw it.
let lastFetchError = null;

// VS Code re-opens a visible hover on every tooltip change, and one that lands
// as the mouse leaves is never closed, so usage tooltips change at most this often.
const TOOLTIP_REFRESH_MS = 30 * 1000;
let usageTooltip;

function resetUsageTooltip() {
    clearTimeout(usageTooltip?.timer);
    usageTooltip = { value: null, scope: null, at: 0, timer: null };
}

function resetRenderState() {
    resetUsageTooltip();
    lastDisplayedValues = {
        sessionText: null,
        weeklyText: null,
        scopedTexts: [],
        tokensText: null,
        creditsText: null,
        compactText: null,
    };
    compactParts = null;
    lastFetchError = null;
}

resetRenderState();

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

// On the client of a remote window the transcripts sit on the remote host, so
// the context gauge has nothing to show (#58).
function isRemoteWindow() {
    return !!clientSideRemoteName();
}

function hideScopedItems() {
    statusBarItems.scoped.forEach((item, i) => {
        item.hide();
        lastDisplayedValues.scopedTexts[i] = null;
    });
}

// key: session | weekly | tokens | credits | compact
function hidePanel(key) {
    statusBarItems[key].hide();
    lastDisplayedValues[`${key}Text`] = null;
    if (key === 'compact') compactParts = null;
}

function drawPanel(key, text) {
    if (text !== lastDisplayedValues[`${key}Text`]) {
        statusBarItems[key].text = text;
        statusBarItems[key].show();
        lastDisplayedValues[`${key}Text`] = text;
    }
}

function hideAllMetricItems() {
    hidePanel('session');
    hidePanel('weekly');
    hideScopedItems();
    hidePanel('tokens');
    hidePanel('credits');
    hidePanel('compact');
}

// The status-bar glyph and colour for a recorded fetch failure.
function fetchErrorMarker(webError, tokenError) {
    if (!webError.authReason && tokenError) return { glyph: '✗', color: 'claudemeter.outageRed' };
    return { glyph: '⚠', color: 'charts.yellow' };
}

function fetchErrorTooltip({ webError, at }, tokenError) {
    // Checked before the combined branch: tokenError is set in every window
    // without a live Claude Code session, so the combined wording would
    // otherwise bury the auth message in the common case.
    if (webError.authReason) {
        const authFailure = describeAuthFailure(webError.authReason, webError.authContext);
        const errorLines = [`**${authFailure.title}**`, '', ...authFailure.lines];
        if (tokenError) {
            errorLines.push('', 'No Claude Code session in this window, so no context gauge either.');
        }
        errorLines.push('', authFailure.canRelogin
            ? '• **Click to log into Claude Code**'
            : '• Run "Claudemeter: Show Debug Output" for details');
        return makeErrorTooltip(errorLines);
    }
    const when = `Time: ${at.toLocaleString()}`;
    const actions = ['**Actions**', '• Click to retry', '• Run "Claudemeter: Show Debug Output" for details'];
    if (tokenError) {
        return makeErrorTooltip([
            '**Complete Fetch Failed**', '',
            `Web: ${escapeMarkdown(webError.message)}`,
            `Tokens: ${escapeMarkdown(tokenError.message)}`, '',
            '**Debug Info**', when, '',
            ...actions,
        ]);
    }
    return makeErrorTooltip([
        '**Web Fetch Failed**', '',
        `Error: ${escapeMarkdown(webError.message)}`, '',
        '**Debug Info**', when, '',
        'Token data may still be available', '',
        ...actions,
    ]);
}

// Draw the Claude label, or the compact panel standing in for it, marked with
// any recorded fetch failure, and swap in that failure's tooltip.
function drawHead(tokenError) {
    const marker = lastFetchError ? fetchErrorMarker(lastFetchError.webError, tokenError) : null;
    if (lastFetchError) setAllTooltips(fetchErrorTooltip(lastFetchError, tokenError));
    const suffix = marker ? ` ${marker.glyph}` : '';
    const markerColor = marker ? new vscode.ThemeColor(marker.color) : undefined;

    if (compactParts) {
        statusBarItems.label.hide();
        const body = compactParts.body ? ` ${compactParts.body}` : '';
        drawPanel('compact', `${compactParts.icon}${getLabelTextWithStatus()}${body}${suffix}`);
        statusBarItems.compact.color = markerColor || compactParts.color || composeCurrentLabel().color;
        return;
    }
    statusBarItems.label.text = `${getLabelTextWithStatus()}${suffix}`;
    statusBarItems.label.color = markerColor || composeCurrentLabel().color;
    statusBarItems.label.show();
}

// Apply a tooltip to every primary panel at once, ending any held usage tooltip.
function setAllTooltips(tooltip) {
    resetUsageTooltip();
    forEachPrimaryPanel((item) => {
        item.tooltip = tooltip;
    });
}

// The usage tooltip, held to TOOLTIP_REFRESH_MS unless its scope (account,
// which data is present) changed, so another account's numbers never linger.
function setUsageTooltip(tooltip, scope) {
    clearTimeout(usageTooltip.timer);
    usageTooltip.timer = null;
    if (tooltip.value === usageTooltip.value && scope === usageTooltip.scope) return;
    const wait = scope === usageTooltip.scope ? usageTooltip.at + TOOLTIP_REFRESH_MS - Date.now() : 0;
    if (wait > 0) {
        usageTooltip.timer = setTimeout(() => setUsageTooltip(tooltip, scope), wait);
        return;
    }
    forEachPrimaryPanel((item) => {
        item.tooltip = tooltip;
    });
    usageTooltip = { value: tooltip.value, scope, at: Date.now(), timer: null };
}

// Panels that own their own tooltip and background: spinner ("Checking
// Claude...") and happyHour (off-peak countdown).
const TRANSIENT_PANELS = new Set(['spinner', 'happyHour']);

// Walk every registered panel but the transient ones, flattening the scoped
// slot array so callers treat one item and a group of items the same way.
function forEachPrimaryPanel(fn) {
    Object.entries(statusBarItems).forEach(([key, value]) => {
        if (!value || TRANSIENT_PANELS.has(key)) return;
        if (Array.isArray(value)) {
            value.forEach(item => item && fn(item));
            return;
        }
        fn(value);
    });
}

function renderHappyHourPanel(hh) {
    const item = statusBarItems.happyHour;
    if (!item) return;

    if (!hh.active) {
        item.hide();
        return;
    }

    const countdown = hh.endsAt ? calculateResetClockTime(hh.endsAt) : '';
    item.text = countdown ? `${hh.icon} ${countdown}` : hh.icon;

    const endsText = hh.endsAt
        ? ` — off-peak, ends ${formatLongDateTime(hh.endsAt, getUse24HourTime())}`
        : ' — off-peak';
    item.tooltip = makeTooltip(`**Happy hour**${endsText}`);
    item.show();
}

function renderCompactMode(sessionPercent, weeklyPercent, tokenPercent, sessionStatus, weeklyStatus, tokenStatus, tokensInfo, scopedEntries, scopedThresholds) {
    hidePanel('session');
    hidePanel('weekly');
    hideScopedItems();
    hidePanel('tokens');
    hidePanel('credits');

    const labels = getGaugeLabelOverrides();
    const parts = [];
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
    // progress bar. A remote window has no context gauge to show.
    const tokensLabel = gaugeLabels('tokens', labels).compact;
    if (!isRemoteWindow()) {
        parts.push(tokenPercent !== null
            ? formatTokensDisplayCompact({
                display: getTokensDisplay(),
                percent: tokenPercent,
                current: tokensInfo?.current ?? null,
                limit: tokensInfo?.limit ?? null,
                knownLimit: tokensInfo?.knownLimit ?? false,
                label: tokensLabel,
            })
            : `${tokensLabel}-`);
    }

    let compactColor;
    if (getColorMode() !== 'basic') {
        const scopedLevels = scopedEntries.map(entry =>
            getIconAndColor(entry.percent, scopedThresholds.warning, scopedThresholds.error).level);
        const levels = [sessionStatus.level, weeklyStatus.level, tokenStatus.level, ...scopedLevels];
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

    compactParts = { icon, body: parts.join(' '), color: compactColor };
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
    hidePanel('compact');

    const isMinimal = displayMode === DISPLAY_MODES.MINIMAL;

    const labels = getGaugeLabelOverrides();

    const resetGauges = [
        ['session', sessionPercent, sessionStatus, sessionResetTime],
        ['weekly', weeklyPercent, weeklyStatus, weeklyResetTime],
    ];
    for (const [key, percent, status, resetTime] of resetGauges) {
        if (percent === null) {
            hidePanel(key);
            continue;
        }
        const icon = gaugeIconForLevel(status.level, key);
        const reset = isMinimal ? '' : ` $(history) ${resetTime}`;
        // Colour reacts to tier changes even when the text is unchanged
        // (e.g. simulator switching the level), so update it on every tick.
        statusBarItems[key].color = gaugeColorOrUndefined(status);
        drawPanel(key, `${icon ? icon + ' ' : ''}${gaugeLabels(key, labels).short} ${formatPercent(percent)}${reset}`);
    }

    if (isRemoteWindow()) {
        hidePanel('tokens');
    } else {
        // Tk deliberately has no icon at any level - the colour alone
        // signals warning/error. See gaugeIconForLevel for rationale.
        const tokenDisplay = tokenPercent !== null
            ? formatTokensDisplay({
                display: getTokensDisplay(),
                percent: tokenPercent,
                current: tokensInfo?.current ?? null,
                limit: tokensInfo?.limit ?? null,
                knownLimit: tokensInfo?.knownLimit ?? false,
                usageFormat: getUsageFormat(),
            })
            : '-';
        // Tk colour MUST update on every tick - the rot tiers
        // (rotLight/rotDeep) often fire when the gauge text stays
        // identical (e.g. 80% bar with a 1m limit), so gating colour on
        // text-change leaves the gauge in the previous tier's colour.
        statusBarItems.tokens.color = gaugeColorOrUndefined(tokenStatus);
        drawPanel('tokens', `${gaugeLabels('tokens', labels).short} ${tokenDisplay}`);
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
        const usedDisplay = formatCompact(credits.used);
        const creditsDisplay = formatPercent(credits.percent);
        const creditsIcon = gaugeIconForLevel(creditsStatus.level, 'credits');
        newCreditsText = `${creditsIcon ? creditsIcon + ' ' : ''}${currencySymbol}${usedDisplay}/${creditsDisplay}`;

        statusBarItems.credits.color = gaugeColorOrUndefined(creditsStatus);
        drawPanel('credits', newCreditsText);
    } else {
        hidePanel('credits');
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
    // New items start blank, so no cached text may suppress their first render.
    resetRenderState();

    // Every panel is a click target for a fetch.
    const panel = (offset) => {
        const item = vscode.window.createStatusBarItem(alignment, basePriority + offset);
        item.command = COMMANDS.FETCH_NOW;
        context.subscriptions.push(item);
        return item;
    };

    statusBarItems.label = panel(0.9);
    statusBarItems.label.text = getLabelTextWithStatus();
    statusBarItems.label.show();

    // Transient spinner panel - appears only while a fetch is in flight.
    // Sits just right of the label using $(sync~spin) which VS Code
    // auto-animates, so we don't need an interval-driven frame loop.
    // Initially hidden - shown only during startSpinner().
    statusBarItems.spinner = panel(0.85);
    statusBarItems.spinner.text = '$(sync~spin)';
    statusBarItems.spinner.tooltip = 'Checking Claude...';

    // Transient happy-hour panel - visible only during Anthropic's
    // off-peak window. Positioned between spinner and session.
    statusBarItems.happyHour = panel(0.8);
    statusBarItems.session = panel(0.7);
    statusBarItems.weekly = panel(0.6);
    // Scoped weekly slots sit between Weekly and Tokens.
    statusBarItems.scoped = [];
    for (let i = 0; i < SCOPED_SLOTS; i++) {
        statusBarItems.scoped.push(panel(0.5 - i * 0.05));
    }
    statusBarItems.credits = panel(0.3);
    statusBarItems.tokens = panel(0.2);
    statusBarItems.compact = panel(0.7);

    return statusBarItems.label;
}

function updateStatusBar(item, usageData, activityStats = null, sessionData = null, credentialsInfo = null) {
    // Happy-hour panel is independent of fetch state - render on
    // every tick so the countdown stays fresh.
    const happyHourState = resolveHappyHourState();
    renderHappyHourPanel(happyHourState);

    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const displayMode = config.get('statusBar.displayMode', DISPLAY_MODES.DEFAULT);
    const showScopedWeekly = config.get('statusBar.showScopedWeekly', true);
    const showCredits = config.get('statusBar.showCredits', false);

    const globalWarning = config.get('thresholds.warning', 80);
    const globalError = config.get('thresholds.error', 90);

    // Per-gauge thresholds: the schema declares each key with default 0,
    // and anything not above 0 inherits the global.
    const getThresholds = (gauge) => {
        const warning = config.get(`thresholds.${gauge}.warning`);
        const error = config.get(`thresholds.${gauge}.error`);
        return {
            warning: warning > 0 ? warning : globalWarning,
            error: error > 0 ? error : globalError,
        };
    };

    const sessionThresholds = getThresholds('session');
    const weeklyThresholds = getThresholds('weekly');
    const scopedThresholds = getThresholds('scoped');
    const creditsThresholds = getThresholds('credits');

    const tokenOnlyMode = config.get('tokenOnlyMode', false);
    // No web fetch runs in token-only mode, so no web failure can still apply.
    if (tokenOnlyMode) lastFetchError = null;
    const tokenError = sessionData?.tokenUsage ? null : (lastFetchError?.tokenError ?? null);

    applyServiceStatusBackground();

    if (!usageData && !sessionData) {
        hideAllMetricItems();
        if (tokenOnlyMode && !isRemoteWindow()) {
            // The token gauge waits for a session; no web fetch is needed.
            setAllTooltips('Waiting for Claude Code session...');
            const labels = getGaugeLabelOverrides();
            if (displayMode === DISPLAY_MODES.COMPACT) {
                compactParts = { icon: '', body: `${gaugeLabels('tokens', labels).compact} --`, color: undefined };
            } else {
                statusBarItems.tokens.color = undefined;
                drawPanel('tokens', `${gaugeLabels('tokens', labels).short} --`);
            }
        } else {
            setAllTooltips('Click to fetch Claude usage data');
        }
        drawHead(tokenError);
        return;
    }

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
                organizationType: usageData?.accountInfo?.organizationType
                    || credentialsInfo?.organizationType,
            }, profileLogger);
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
        sessionResetTime = calculateResetClockTime(usageData.resetsAt);
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
        const weeklyResetDate = toResetDate(usageData.resetsAtWeek);
        const isWithin24hrs = !!weeklyResetDate && weeklyResetDate.getTime() - Date.now() < DAY_MS;
        const needsMinutePrecision = isWithin24hrs && weeklyPercent >= WEEKLY_MINUTE_PRECISION_PCT;
        const weeklyTimeFormat = needsMinutePrecision
            ? { hour: 'numeric', minute: '2-digit' }
            : { hour: 'numeric' };
        weeklyResetTime = calculateResetClockTime(weeklyResetDate, weeklyTimeFormat);
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
    const scopedWeekly = getScopedWeekly(usageData);
    const gaugeLabelOverrides = getGaugeLabelOverrides();

    const markdownBody = composeTooltip({
        usageData,
        sessionData,
        credentialsInfo,
        activityStats,
        platformTooltipLines,
        activityQuipOverride: composeCurrentLabel().quirkyOverride,
        happyHourState,
        showNopilotOffer: resolveNopilotOffer(),
        extensionVersion: extVersion,
        repositoryUrl,
        marketplaceUrl,
        brandIconDataUri: getBrandIconDataUri(),
        claudeCodeSelectedModel: vscode.workspace.getConfiguration('claudeCode').get('selectedModel', ''),
        remoteName: clientSideRemoteName(),
        scopedWeekly,
        gaugeLabelOverrides,
        tokensInfo,
        config: {
            tokenLimitOverride: config.get('tokenLimit', 0),
            use24HourTime: getUse24HourTime(),
            weeklyPrecisionThreshold: WEEKLY_MINUTE_PRECISION_PCT,
        },
    });

    if (!lastFetchError) {
        const scope = [
            credentialsInfo?.accountUuid || credentialsInfo?.orgId || credentialsInfo?.email || '',
            usageData ? 'web' : '',
            sessionData?.tokenUsage ? 'tk' : '',
        ].join('|');
        setUsageTooltip(makeTooltip(getTooltipLogoHeader() + markdownBody, TOOLTIP_COMMANDS), scope);
    }

    // A scoped limit is drawn only once it registers above 0%: an account that
    // has never touched the model reports 0 and would otherwise carry a
    // permanent dead gauge.
    const visibleScoped = showScopedWeekly
        ? scopedWeekly.filter(e => typeof e.percent === 'number' && e.percent > 0)
        : [];

    if (displayMode === DISPLAY_MODES.COMPACT) {
        renderCompactMode(sessionPercent, weeklyPercent, tokenPercent, sessionStatus, weeklyStatus, tokenStatus,
            tokensInfo, visibleScoped, scopedThresholds);
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
    drawHead(tokenError);
}

function startSpinner() {
    if (isSpinnerActive) return;
    isSpinnerActive = true;
    if (statusBarItems.spinner) {
        statusBarItems.spinner.show();
    }
}

// Records the fetch outcome and draws a failure at once. A clean result only
// clears the record: the render that follows owns the normal text and colours,
// including the compact panel's threshold and rot colours.
function stopSpinner(webError = null, tokenError = null) {
    isSpinnerActive = false;
    if (statusBarItems.spinner) {
        statusBarItems.spinner.hide();
    }

    lastFetchError = webError ? { webError, tokenError, at: new Date() } : null;
    if (lastFetchError && statusBarItems.label) {
        drawHead(tokenError);
    }
}

module.exports = {
    createStatusBarItem,
    updateStatusBar,
    startSpinner,
    stopSpinner,
    refreshServiceStatus,
};
