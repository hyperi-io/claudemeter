//  Project:      Claudemeter
//  File:         src/tk/recommendations.js
//  Purpose:      Tier → tooltip recommendation string.
//
//                Strings are deliberately model-agnostic and value-agnostic.
//                Specific evidence (model names, benchmark numbers, exact
//                compact trigger %) lives in the README "Why the
//                context-rot meter exists" section. Putting that data here
//                would create a maintenance tail — every model release
//                would force a code change.
//
//                'normal' maps to null — no recommendation.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const TIER_RECOMMENDATIONS = Object.freeze({
    rotLight: "Recall starts to drift in long-context tasks. /compact when it's a good time — on your terms.",
    rotDeep:  "Quality drops sharply on complex multi-step work. /compact soon, on your terms.",
    warning:  "Auto-compact approaching — Claude will compress soon.",
    error:    "Auto-compact imminent.",
    normal:   null,
});

module.exports = { TIER_RECOMMENDATIONS };
