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
//                Yellow / red thresholds are runway to the point auto-compact
//                actually fires:
//                  red  fires when used >= compactPoint - errorRunwayTokens
//                  yellow fires when used >= compactPoint - warningRunwayTokens
//
//                compactPoint comes from the session's OWN compaction history
//                when it has one (src/tk/compactPoint.js), because on some
//                Claude Code versions auto-compact fires nowhere near the
//                window - measured at ~168K on a 1M window. Only when a
//                session has never auto-compacted does it fall back to the
//                reserve model, `contextWindow - compactReserveTokens`.
//
//                Rot tiers fire on absolute used, gated by a >200K window -
//                NOT the account profile (unreliable - e.g. macOS keeps
//                creds in the Keychain not a file, so the profile falls
//                back to 'unknown'). A big window makes the 400K/650K
//                frontier reachable - on a 200K window it never fires:
//                  rotDeep  when used >= rotDeepTokens  (default 650K)
//                  rotLight when used >= rotLightTokens (default 400K)
//                Defaults track Opus 4.8's gentler long-context curve - see
//                docs/context-rot.md (re-check 7 Jul 2026). The frontier is
//                a model property, so it is the same whether it comes from a
//                profile's explicit values or these defaults.
//
//                Pure JS — no vscode dependency, no I/O, fully testable.
//                See STATE.md "Claude Code auto-compact trigger" for the
//                research that motivates the reserve-based model.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const STANDARD_LIMIT = 200_000;
const DEFAULT_ROT_LIGHT_TOKENS = 400_000;
const DEFAULT_ROT_DEEP_TOKENS = 650_000;

/**
 * Where auto-compact is expected to fire for this session.
 *
 * The session's own measured compact point wins outright. It is the only one
 * of the two that survives Claude Code changing when it compacts, and it is
 * an observation rather than a model. The reserve model is the fallback for a
 * session that has not compacted yet and so has nothing to measure.
 *
 * @param {object} thresholds - profile.thresholds
 * @param {number} contextWindow - context window size in tokens
 * @param {number|null} observedCompactPoint - from src/tk/compactPoint.js
 * @returns {number} tokens at which compaction is expected
 */
function resolveCompactPoint(thresholds, contextWindow, observedCompactPoint = null) {
    if (Number.isFinite(observedCompactPoint) && observedCompactPoint > 0) {
        return observedCompactPoint;
    }
    return contextWindow - thresholds.compactReserveTokens;
}

/**
 * Resolve the Tk tier for a given (used, profile, contextWindow) tuple.
 *
 * @param {number} used - tokens used in the current context (>= 0)
 * @param {object} profile - profile object from src/tk/profiles.js (with .thresholds)
 * @param {number} contextWindow - context window size in tokens (e.g. 200_000, 1_000_000)
 * @param {number|null} observedCompactPoint - the session's measured compact
 *        point, when it has compacted before; null falls back to the reserve model
 * @returns {'normal'|'rotLight'|'rotDeep'|'warning'|'error'}
 */
function getTkLevel(used, profile, contextWindow, observedCompactPoint = null) {
    if (!profile || !profile.thresholds) return 'normal';
    const T = profile.thresholds;

    const compactPoint = resolveCompactPoint(T, contextWindow, observedCompactPoint);
    if (used >= compactPoint - T.errorRunwayTokens)   return 'error';
    if (used >= compactPoint - T.warningRunwayTokens) return 'warning';

    // Rot keys off the window, not the profile - a >200K window is what
    // makes the 400K/650K frontier reachable. Profile may tune the
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
 * @param {number|null} observedCompactPoint - the session's measured compact point
 * @returns {number|null} t in [0,1), or null when not in the rot zone
 */
function rotGradientT(used, profile, contextWindow, observedCompactPoint = null) {
    if (!profile || !profile.thresholds) return null;
    if (contextWindow <= STANDARD_LIMIT) return null;
    const T = profile.thresholds;

    // Same compact point the tiers use, so the gradient always stops exactly
    // where yellow starts rather than drifting away from it.
    const compactPoint = resolveCompactPoint(T, contextWindow, observedCompactPoint);
    const yellowThreshold = compactPoint - T.warningRunwayTokens;

    const floor = T.rotLightTokens ?? DEFAULT_ROT_LIGHT_TOKENS;
    if (yellowThreshold <= floor) return null;   // zone collapsed
    if (used < floor) return null;               // normal zone
    if (used >= yellowThreshold) return null;    // warning/error zone

    return (used - floor) / (yellowThreshold - floor);
}

module.exports = { getTkLevel, rotGradientT, resolveCompactPoint };
