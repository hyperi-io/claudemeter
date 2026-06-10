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
//                Rot tiers fire on absolute used, gated by a >200K window -
//                NOT the account profile (unreliable - e.g. macOS keeps
//                creds in the Keychain not a file, so the profile falls
//                back to 'unknown'). A big window makes the 300K/500K
//                frontier reachable - on a 200K window it never fires:
//                  rotDeep  when used >= rotDeepTokens  (default 500K)
//                  rotLight when used >= rotLightTokens (default 300K)
//
//                Pure JS — no vscode dependency, no I/O, fully testable.
//                See STATE.md "Claude Code auto-compact trigger" for the
//                research that motivates the reserve-based model.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const STANDARD_LIMIT = 200_000;
const DEFAULT_ROT_LIGHT_TOKENS = 300_000;
const DEFAULT_ROT_DEEP_TOKENS = 500_000;

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

    // Rot keys off the window, not the profile - a >200K window is what
    // makes the 300K/500K frontier reachable. Profile may tune the
    // thresholds, else defaults.
    if (contextWindow > STANDARD_LIMIT) {
        const rotDeep = T.rotDeepTokens ?? DEFAULT_ROT_DEEP_TOKENS;
        const rotLight = T.rotLightTokens ?? DEFAULT_ROT_LIGHT_TOKENS;
        if (used >= rotDeep)  return 'rotDeep';
        if (used >= rotLight) return 'rotLight';
    }

    return 'normal';
}

/**
 * Position of `used` within the rot blue zone, for the continuous
 * white→blue gauge gradient. The zone spans [rotLightTokens, yellow),
 * i.e. exactly where getTkLevel returns 'rotLight' or 'rotDeep'.
 *
 *   t = (used - rotLightTokens) / (yellowThreshold - rotLightTokens)
 *
 * Returns null outside the zone (below the rot floor, in warning/error, on
 * a <=200K window, or when the zone collapses) so callers fall back to the
 * discrete normal/warning/error colours.
 *
 * @param {number} used - tokens used in the current context (>= 0)
 * @param {object} profile - profile object from src/tk/profiles.js
 * @param {number} contextWindow - context window size in tokens
 * @returns {number|null} t in [0,1), or null when not in the rot zone
 */
function rotGradientT(used, profile, contextWindow) {
    if (!profile || !profile.thresholds) return null;
    if (contextWindow <= STANDARD_LIMIT) return null;
    const T = profile.thresholds;

    const compactPoint = contextWindow - T.compactReserveTokens;
    const yellowThreshold = compactPoint - T.warningRunwayTokens;

    const floor = T.rotLightTokens ?? DEFAULT_ROT_LIGHT_TOKENS;
    if (yellowThreshold <= floor) return null;   // zone collapsed
    if (used < floor) return null;               // normal zone
    if (used >= yellowThreshold) return null;    // warning/error zone

    return (used - floor) / (yellowThreshold - floor);
}

module.exports = { getTkLevel, rotGradientT };
