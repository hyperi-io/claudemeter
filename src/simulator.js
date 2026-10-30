//  Project:      Claudemeter
//  File:         src/simulator.js
//  Purpose:      Test-mode simulator for F5 debugging. Module-level state
//                to force each gauge/mode/profile during interactive testing.
//  Language:     JavaScript
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const VALID_TOKEN_LEVELS = new Set(['normal', 'rotLight', 'rotDeep', 'warning', 'error']);
const VALID_COLOR_MODES = new Set(['color', 'basic']);

let simulatedTokenLevel = null;
let simulatedTokenUsed = null;          // raw token count, lets simulator drive 'used'
let simulatedSessionPercent = null;
let simulatedWeeklyPercent = null;
let simulatedScopedWeekly = null;       // [{label, percent}], overrides usageData.scopedWeekly
let simulatedThresholdIcons = null;     // null | true | false, stands in for the global setting
let simulatedContextWindow = null;      // token count, overrides the resolved window
let simulatedPlanSignals = null;        // {subscriptionType, organizationType, creditsEnabled}
let simulatedCreditsPercent = null;     // 0..100, overrides monthlyCredits.percent
let simulatedHappyHour = null;          // null | true | false
let simulatedColorMode = null;          // null | 'color' | 'basic'
let simulatedProfileOverride = null;    // null | profile name string
let simulatedPanelBody = null;          // {session?, weekly?}: dev-only text drawn after the gauge label
let simulatedUsageHistory = null;       // relative-minute rows standing in for the usage history file
let simulatedRunsOut = null;            // {session?, weekly?}: minutes until the forced run-out
let simulatedPaceDelta = null;          // points ahead of the weekly clock
let simulatedTkSeries = null;           // [[minutesAgo, tokens]] standing in for the transcript turns
const RUNS_OUT_KEYS = new Set(['session', 'weekly']);

function clamp01_100(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    return Math.min(100, Math.max(0, v));
}

function clampNonNegative(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return null;
    return Math.max(0, v);
}

function setTokenLevel(level) {
    if (level === null) { simulatedTokenLevel = null; return; }
    if (!VALID_TOKEN_LEVELS.has(level)) return;
    simulatedTokenLevel = level;
}
function getTokenLevel() { return simulatedTokenLevel; }

function setTokenUsed(used) {
    if (used === null) { simulatedTokenUsed = null; return; }
    const v = clampNonNegative(used);
    if (v === null) return;
    simulatedTokenUsed = v;
}
function getTokenUsed() { return simulatedTokenUsed; }

function setSessionPercent(p) {
    if (p === null) { simulatedSessionPercent = null; return; }
    const v = clamp01_100(p);
    if (v === null) return;
    simulatedSessionPercent = v;
}
function getSessionPercent() { return simulatedSessionPercent; }

function setWeeklyPercent(p) {
    if (p === null) { simulatedWeeklyPercent = null; return; }
    const v = clamp01_100(p);
    if (v === null) return;
    simulatedWeeklyPercent = v;
}
function getWeeklyPercent() { return simulatedWeeklyPercent; }

// Scoped weekly gauges are model-agnostic: the simulator takes the same
// [{label, percent}] list the payload produces, so a new model needs no
// simulator change.
function setScopedWeekly(entries) {
    if (entries === null) { simulatedScopedWeekly = null; return; }
    if (!Array.isArray(entries)) return;
    const cleaned = entries
        .map(e => ({ label: String(e?.label ?? ''), percent: clamp01_100(e?.percent) }))
        .filter(e => e.label.length > 0 && e.percent !== null)
        .map(e => ({ ...e, modelId: null, resetsAt: null, severity: null }));
    simulatedScopedWeekly = cleaned;
}
function getScopedWeekly() { return simulatedScopedWeekly; }

// Stand in for the global threshold-icon setting. Sits at the GLOBAL tier of
// the cascade, so a per-gauge override still wins over it and the real
// precedence is what gets tested.
function setThresholdIcons(on) {
    if (on === null) { simulatedThresholdIcons = null; return; }
    simulatedThresholdIcons = !!on;
}
function getThresholdIcons() { return simulatedThresholdIcons; }

// Force the resolved context window, so the Tk gauge can be driven against a
// 1M or 200K window without an account on that plan.
function setContextWindow(limit) {
    if (limit === null) { simulatedContextWindow = null; return; }
    const v = clampNonNegative(limit);
    if (v === null || v === 0) return;
    simulatedContextWindow = v;
}
function getContextWindow() { return simulatedContextWindow; }

// Force the plan signals the context-window rules read, so the credits caveat
// can be exercised without switching accounts. `creditsEnabled` is tri-state:
// null means unknown, which grants the window.
function setPlanSignals(signals) {
    if (signals === null) { simulatedPlanSignals = null; return; }
    if (!signals || typeof signals !== 'object') return;
    simulatedPlanSignals = {
        subscriptionType: typeof signals.subscriptionType === 'string' ? signals.subscriptionType : null,
        organizationType: typeof signals.organizationType === 'string' ? signals.organizationType : null,
        creditsEnabled: typeof signals.creditsEnabled === 'boolean' ? signals.creditsEnabled : null,
    };
}
function getPlanSignals() { return simulatedPlanSignals; }

function setCreditsPercent(p) {
    if (p === null) { simulatedCreditsPercent = null; return; }
    const v = clamp01_100(p);
    if (v === null) return;
    simulatedCreditsPercent = v;
}
function getCreditsPercent() { return simulatedCreditsPercent; }

function setHappyHour(active) {
    if (active === null) { simulatedHappyHour = null; return; }
    simulatedHappyHour = !!active;
}
function getHappyHour() { return simulatedHappyHour; }

function setColorMode(mode) {
    if (mode === null) { simulatedColorMode = null; return; }
    if (!VALID_COLOR_MODES.has(mode)) return;
    simulatedColorMode = mode;
}
function getColorMode() { return simulatedColorMode; }

function setProfileOverride(profileName) {
    if (profileName === null) { simulatedProfileOverride = null; return; }
    if (typeof profileName !== 'string' || profileName.length === 0) return;
    simulatedProfileOverride = profileName;
}
function getProfileOverride() { return simulatedProfileOverride; }

// Replaces what a gauge draws after its label, so glyph experiments can be
// seen in the real status bar without touching the renderers.
const PANEL_BODY_KEYS = new Set(['session', 'weekly']);
function setPanelBody(bodies) {
    if (bodies === null) { simulatedPanelBody = null; return; }
    if (!bodies || typeof bodies !== 'object' || Array.isArray(bodies)) return;
    const cleaned = Object.fromEntries(
        Object.entries(bodies).filter(([k, v]) => PANEL_BODY_KEYS.has(k) && typeof v === 'string')
    );
    simulatedPanelBody = Object.keys(cleaned).length > 0 ? cleaned : null;
}
function getPanelBody(key) { return simulatedPanelBody?.[key] ?? null; }

const MINUTE_MS = 60 * 1000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Usage history as relative minutes, so a scenario stays valid whenever it is applied:
// { fiveResetsInMin, weekResetsInMin, samples: [[minutesAgo, fivePct, weekPct, {scopedKey: pct}?], ...] }.
function setUsageHistory(spec) {
    if (spec === null) { simulatedUsageHistory = null; return; }
    if (!spec || typeof spec !== 'object' || !Array.isArray(spec.samples)) return;
    const rows = spec.samples.filter((r) => Array.isArray(r) && finite(r[0]) && finite(r[1]) && finite(r[2]));
    simulatedUsageHistory = {
        fiveResetsInMin: finite(spec.fiveResetsInMin) ? spec.fiveResetsInMin : 180,
        weekResetsInMin: finite(spec.weekResetsInMin) ? spec.weekResetsInMin : 3 * 24 * 60,
        rows,
    };
}
function getUsageHistory(now) {
    if (!simulatedUsageHistory) return null;
    const { fiveResetsInMin, weekResetsInMin, rows } = simulatedUsageHistory;
    const fiveResetsAt = now + fiveResetsInMin * MINUTE_MS;
    const weekResetsAt = now + weekResetsInMin * MINUTE_MS;
    return rows.map(([ago, five, week, scoped]) => ({
        ts: now - ago * MINUTE_MS,
        fiveHour: { pct: five, resetsAt: fiveResetsAt },
        sevenDay: { pct: week, resetsAt: weekResetsAt },
        scoped: Object.fromEntries(Object.entries(scoped && typeof scoped === 'object' ? scoped : {})
            .filter(([, pct]) => finite(pct))
            .map(([key, pct]) => [key, { pct, resetsAt: weekResetsAt }])),
    }));
}

// Forces the run-out flag, with the gauge projected to run out this many minutes from now:
// { session: 40, weekly: 300 }.
function setRunsOut(minutes) {
    if (minutes === null) { simulatedRunsOut = null; return; }
    if (!minutes || typeof minutes !== 'object' || Array.isArray(minutes)) return;
    const cleaned = Object.fromEntries(Object.entries(minutes).filter(([k, v]) => RUNS_OUT_KEYS.has(k) && finite(v) && v > 0));
    simulatedRunsOut = Object.keys(cleaned).length > 0 ? cleaned : null;
}
function getRunsOut(key) { return simulatedRunsOut?.[key] ?? null; }

// Forces the weekly pace delta, in points ahead of (positive) or behind the clock.
function setPaceDelta(points) {
    if (points === null) { simulatedPaceDelta = null; return; }
    if (!finite(points)) return;
    simulatedPaceDelta = points;
}
function getPaceDelta() { return simulatedPaceDelta; }

// Tk turns as [[minutesAgo, tokens], ...], oldest first.
function setTkSeries(rows) {
    if (rows === null) { simulatedTkSeries = null; return; }
    if (!Array.isArray(rows)) return;
    simulatedTkSeries = rows.filter((r) => Array.isArray(r) && finite(r[0]) && finite(r[1]) && r[1] >= 0);
}
function getTkSeries(now) {
    return simulatedTkSeries ? simulatedTkSeries.map(([ago, tokens]) => ({ ts: now - ago * MINUTE_MS, tokens })) : null;
}

function clearAll() {
    simulatedUsageHistory = null;
    simulatedRunsOut = null;
    simulatedPaceDelta = null;
    simulatedTkSeries = null;
    simulatedTokenLevel = null;
    simulatedTokenUsed = null;
    simulatedSessionPercent = null;
    simulatedWeeklyPercent = null;
    simulatedScopedWeekly = null;
    simulatedThresholdIcons = null;
    simulatedContextWindow = null;
    simulatedPlanSignals = null;
    simulatedCreditsPercent = null;
    simulatedHappyHour = null;
    simulatedColorMode = null;
    simulatedProfileOverride = null;
    simulatedPanelBody = null;
}

// Setter per scenario key, so a scenario file names the same states the
// interactive commands do.
const SCENARIO_SETTERS = {
    tokenLevel: setTokenLevel,
    tokenUsed: setTokenUsed,
    sessionPercent: setSessionPercent,
    weeklyPercent: setWeeklyPercent,
    scopedWeekly: setScopedWeekly,
    thresholdIcons: setThresholdIcons,
    contextWindow: setContextWindow,
    planSignals: setPlanSignals,
    creditsPercent: setCreditsPercent,
    colorMode: setColorMode,
    profileOverride: setProfileOverride,
    panelBody: setPanelBody,
    usageHistory: setUsageHistory,
    runsOut: setRunsOut,
    paceDelta: setPaceDelta,
    tkSeries: setTkSeries,
};

// Replace every simulated state with the scenario's, so a scenario never
// inherits a value from the one before it. Returns the keys applied.
function applyScenario(scenario) {
    clearAll();
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return [];
    const applied = [];
    for (const [key, value] of Object.entries(scenario)) {
        if (!Object.hasOwn(SCENARIO_SETTERS, key)) continue;
        SCENARIO_SETTERS[key](value);
        applied.push(key);
    }
    return applied;
}

module.exports = {
    setTokenLevel, getTokenLevel,
    setTokenUsed, getTokenUsed,
    setSessionPercent, getSessionPercent,
    setWeeklyPercent, getWeeklyPercent,
    setScopedWeekly, getScopedWeekly,
    setThresholdIcons, getThresholdIcons,
    setContextWindow, getContextWindow,
    setPlanSignals, getPlanSignals,
    setCreditsPercent, getCreditsPercent,
    setHappyHour, getHappyHour,
    setColorMode, getColorMode,
    setProfileOverride, getProfileOverride,
    setPanelBody, getPanelBody,
    setUsageHistory, getUsageHistory,
    setRunsOut, getRunsOut,
    setPaceDelta, getPaceDelta,
    setTkSeries, getTkSeries,
    clearAll,
    applyScenario,
};
