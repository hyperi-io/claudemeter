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
let simulatedSonnetPercent = null;      // 0..100, overrides usageData.usagePercentSonnet
let simulatedOpusPercent = null;        // 0..100, overrides usageData.usagePercentOpus
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

function setSonnetPercent(p) {
    if (p === null) { simulatedSonnetPercent = null; return; }
    const v = clamp01_100(p);
    if (v === null) return;
    simulatedSonnetPercent = v;
}
function getSonnetPercent() { return simulatedSonnetPercent; }

function setOpusPercent(p) {
    if (p === null) { simulatedOpusPercent = null; return; }
    const v = clamp01_100(p);
    if (v === null) return;
    simulatedOpusPercent = v;
}
function getOpusPercent() { return simulatedOpusPercent; }

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
    simulatedSonnetPercent = null;
    simulatedOpusPercent = null;
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
    setSonnetPercent, getSonnetPercent,
    setOpusPercent, getOpusPercent,
    setCreditsPercent, getCreditsPercent,
    setHappyHour, getHappyHour,
    setColorMode, getColorMode,
    setProfileOverride, getProfileOverride,
    clearAll,
};
