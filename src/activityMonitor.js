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
    const claudePercent = usageData ? usageData.usagePercent : 0;

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

function getActivityDescription(level) {
    const levelDescriptions = ACTIVITY_DESCRIPTIONS[level] || ACTIVITY_DESCRIPTIONS['idle'];
    return {
        short: levelDescriptions.short,
        quirky: pickRandom(levelDescriptions.quirkyOptions),
    };
}

function getStats(usageData = null, sessionData = null) {
    const claudePercent = usageData ? usageData.usagePercent : 0;

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
