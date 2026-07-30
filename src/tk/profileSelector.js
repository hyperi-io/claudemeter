//  Project:      Claudemeter
//  File:         src/tk/profileSelector.js
//  Purpose:      Map Claude account detection signals to a Tk profile.
//
//                Implementation is an EXPLICIT if-else priority chain
//                sorted by signal specificity (most-specific first), NOT
//                an iteration over the PROFILES object. Array-position
//                coupling is invisible and breaks silently when entries
//                are inserted in the wrong order. An explicit chain forces
//                anyone adding a profile to ALSO add a branch here, with
//                the precedence visible at a glance.
//
//                String comparisons are EXACT (no normalisation). Verbatim
//                Anthropic strings come from the credential store and the
//                OAuth /profile response; they are compared as-is. Do not
//                import or call formatSubscriptionType /
//                formatRateLimitTier here - those are display formatters
//                and a parallel-normalisation hazard.
//
//                'unknown' fallback emits a one-time output-channel warning
//                so users with detection-failure scenarios can see the
//                signals that landed. The flag is module-level and reset
//                on explicit account-switch via resetUnknownWarning().
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const { PROFILES } = require('./profiles.js');

let hasWarnedUnknown = false;

/**
 * Resolve detection signals -> Tk profile.
 *
 * @param {{ subscriptionType?: string, rateLimitTier?: string, orgType?: string }} signals
 * @param {{ appendLine: (msg: string) => void } | null} logger - optional output channel
 * @returns {object} a profile from PROFILES (never null - always falls back to 'unknown')
 */
function selectProfile(signals, logger = null) {
    const subscriptionType = signals?.subscriptionType;
    const rateLimitTier = signals?.rateLimitTier;
    const orgType = signals?.orgType;

    // Most specific first - both subscriptionType AND rateLimitTier set
    if (subscriptionType === 'max' && rateLimitTier === 'default_claude_max_20x') {
        return PROFILES['max-20x'];
    }
    if (subscriptionType === 'max' && rateLimitTier === 'default_claude_max_5x') {
        return PROFILES['max-5x'];
    }

    // One field set
    if (subscriptionType === 'max') return PROFILES['max-unknown'];
    if (orgType === 'Enterprise')   return PROFILES['enterprise'];
    if (orgType === 'Team')         return PROFILES['team-standard'];
    if (subscriptionType === 'pro') return PROFILES['pro'];

    // Fallback
    if (!hasWarnedUnknown && logger && typeof logger.appendLine === 'function') {
        logger.appendLine(
            `[claudemeter] profile detection fell through — using 'unknown' (signals: ${JSON.stringify({ subscriptionType, rateLimitTier, orgType })})`
        );
        hasWarnedUnknown = true;
    }
    return PROFILES['unknown'];
}

/**
 * Reset the one-time 'unknown' warning flag. Call on explicit
 * account-switch events so the warning re-emits if detection still
 * fails after the switch.
 */
function resetUnknownWarning() {
    hasWarnedUnknown = false;
}

module.exports = { selectProfile, resetUnknownWarning };
