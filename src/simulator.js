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

function clearAll() {
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
    clearAll,
};
