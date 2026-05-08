//  Project:      Claudemeter
//  File:         src/tk/thresholds.js
//  Purpose:      Pure 5-tier resolver for the Tk (token) gauge.
//
//                Anchored to absolute tokens — both used and contextWindow
//                are token counts. The auto-compact "imminent" runway and
//                the rot frontier are absolute concerns; expressing them
//                in tokens (not percent) keeps the model consistent with
//                Claude Code's reserve-based auto-compact trigger.
//
//                Yellow / red thresholds are computed from the profile's
//                runway tokens relative to the auto-compact reserve:
//                  compactPoint = contextWindow - compactReserveTokens
//                  red  fires when used >= compactPoint - errorRunwayTokens
//                  yellow fires when used >= compactPoint - warningRunwayTokens
//
//                Rot tiers fire on absolute used:
//                  rotDeep  when used >= rotDeepTokens
//                  rotLight when used >= rotLightTokens
//
//                Rot is gated by profile.thresholds.rotEnabled. On
//                small-window profiles where rot tokens exceed the
//                window, the tiers naturally don't fire (used can never
//                reach them).
//
//                Pure JS — no vscode dependency, no I/O, fully testable.
//                See STATE.md "Claude Code auto-compact trigger" for the
//                research that motivates the reserve-based model.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

/**
 * Resolve the Tk tier for a given (used, profile, contextWindow) tuple.
 *
 * @param {number} used - tokens used in the current context (>= 0)
 * @param {object} profile - profile object from src/tk/profiles.js (with .thresholds)
 * @param {number} contextWindow - context window size in tokens (e.g. 200_000, 1_000_000)
 * @returns {'normal'|'rotLight'|'rotDeep'|'warning'|'error'}
 */
function getTkLevel(used, profile, contextWindow) {
    if (!profile || !profile.thresholds) return 'normal';
    const T = profile.thresholds;

    // Yellow / red: computed against the auto-compact reserve so the
    // visible threshold scales with window size automatically.
    const compactPoint = contextWindow - T.compactReserveTokens;
    if (used >= compactPoint - T.errorRunwayTokens)   return 'error';
    if (used >= compactPoint - T.warningRunwayTokens) return 'warning';

    // Rot tiers: absolute thresholds, gated by profile flag.
    if (T.rotEnabled) {
        if (used >= T.rotDeepTokens)  return 'rotDeep';
        if (used >= T.rotLightTokens) return 'rotLight';
    }

    return 'normal';
}

module.exports = { getTkLevel };
