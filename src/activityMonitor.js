// Project:   Claudemeter
// File:      activityMonitor.js
// Purpose:   Resolve an activity level from usage data and pick a
//            status-message quote for the tooltip's activity-quip line.
//            Quote data lives in activityQuotes.js - this module owns
//            only the level-resolution thresholds and the random pick.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const { ACTIVITY_DESCRIPTIONS } = require('./activityQuotes');

function pickRandom(messages) {
    return messages[Math.floor(Math.random() * messages.length)];
}

function getActivityLevel(usageData = null, sessionData = null) {
    const claudePercent = usageData?.usagePercent ?? 0;

    let tokenPercent = 0;
    if (sessionData && sessionData.tokenUsage) {
        tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
    }

    const maxPercent = Math.max(claudePercent, tokenPercent);

    if (maxPercent >= 90) {
        return 'heavy';
    } else if (maxPercent >= 75) {
        return 'moderate';
    } else {
        return 'idle';
    }
}

// Any change to the tooltip text makes VS Code re-render an open hover, so
// a quip re-rolled every tick pins the hover open and swallows new ones.
const QUIP_HOLD_MS = 5 * 60 * 1000;
let heldQuip = null;

function getActivityDescription(level) {
    const levelDescriptions = ACTIVITY_DESCRIPTIONS[level] || ACTIVITY_DESCRIPTIONS['idle'];
    const now = Date.now();
    if (!heldQuip || heldQuip.level !== level || now - heldQuip.at > QUIP_HOLD_MS) {
        heldQuip = { level, at: now, quirky: pickRandom(levelDescriptions.quirkyOptions) };
    }
    return {
        short: levelDescriptions.short,
        quirky: heldQuip.quirky,
    };
}

function getStats(usageData = null, sessionData = null) {
    const claudePercent = usageData?.usagePercent ?? 0;

    let tokenPercent = 0;
    if (sessionData && sessionData.tokenUsage) {
        tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
    }

    const maxPercent = Math.max(claudePercent, tokenPercent);
    const level = getActivityLevel(usageData, sessionData);

    return {
        level,
        claudePercent,
        tokenPercent,
        maxPercent,
        description: getActivityDescription(level),
    };
}

module.exports = { getActivityLevel, getActivityDescription, getStats };
