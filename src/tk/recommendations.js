//  Project:      Claudemeter
//  File:         src/tk/recommendations.js
//  Purpose:      Tier -> tooltip recommendation string.
//
//                Strings are deliberately model-agnostic and value-agnostic.
//                Specific evidence (model names, benchmark numbers, exact
//                compact trigger %) lives in the README "Why the
//                context-rot meter exists" section. Putting that data here
//                would create a maintenance tail - every model release
//                would force a code change.
//
//                Each recommendation uses markdown line breaks ("  \\n",
//                two trailing spaces + newline) to split into short
//                segments. The tooltip composer splits on these and emits
//                each segment as its own italic line, so the tooltip
//                width is bounded by the longest SINGLE line rather than
//                the longest sentence. The first segment names the
//                concept ("Context rot"), the second describes the
//                effect, the third gives the action.
//
//                'normal' maps to null - no recommendation.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const TIER_RECOMMENDATIONS = Object.freeze({
    rotLight: [
        "Context rot - light.",
        "Recall starts to drift in long-context tasks.",
        "/compact when convenient.",
    ].join("  \n"),
    rotDeep: [
        "Context rot - deep.",
        "Quality drops sharply on complex multi-step work.",
        "/compact soon, on your terms.",
    ].join("  \n"),
    warning: [
        "Auto-compact approaching.",
        "Claude will compress soon.",
    ].join("  \n"),
    error: "Auto-compact imminent.",
    normal: null,
});

module.exports = { TIER_RECOMMENDATIONS };
