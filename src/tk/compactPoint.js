//  Project:      Claudemeter
//  File:         src/tk/compactPoint.js
//  Purpose:      Estimate where auto-compact ACTUALLY fires for a session,
//                from that session's own compaction history.
//
//                The gauge used to assume the compact point was
//                `contextWindow - compactReserveTokens`. Measured against
//                real transcripts that holds on some Claude Code versions
//                and not others:
//
//                  cc 2.1.181-2.1.207, six sessions, seventeen auto
//                  compactions - all fired at 999,548-1,005,372 on a 1M
//                  window. Spread 1.01x. The reserve model fits.
//
//                  cc 2.1.220, one session, sixteen auto compactions -
//                  166,984 / 167,151 / 167,968 / 167,974 / 168,104 /
//                  168,640 / 169,446 / 169,871 / 172,005 / 178,394 /
//                  196,005 / 198,749 / 223,876 / 281,192 / 311,579 /
//                  608,197. Spread 3.64x, on a window the same session
//                  demonstrably held 606,132 tokens in. The reserve model
//                  is nowhere near.
//
//                So the compact point cannot be derived from the window. It
//                has to be measured per session, which the transcript
//                already supports: every compaction leaves a
//                `compact_boundary` record carrying the size it fired at.
//
//                Pure JS - no vscode dependency, no I/O, fully testable.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

// How many of a session's most recent auto compactions feed the estimate.
//
// Small enough to track a regime change within a few compactions, large
// enough that one excursion cannot move the median. On the sixteen-boundary
// session above, the last five are 168,640 / 167,968 / 167,974 / 167,151 /
// 169,446 - median 167,974 - even though 311,579 and 281,192 sit just behind
// them.
const COMPACT_POINT_SAMPLES = 5;

// Middle value, or the mean of the two middle values for an even count.
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

/**
 * Estimate the session's auto-compact point from its recent compaction sizes.
 *
 * Median rather than mean or latest: the observed spread is driven by
 * occasional excursions (one session went 167,151 -> 311,579 -> 169,446), and
 * a median rides over those where a mean would be dragged up by them and
 * "latest" would chase them.
 *
 * Median rather than min: warning early costs the user a gauge that cries
 * wolf for the rest of the session, warning late costs them the compaction
 * they asked to be warned about. The median sits between, and the runway
 * subtracted downstream already biases toward early.
 *
 * @param {number[]} samples - preTokens of the session's auto compactions,
 *                             oldest first. Anything non-finite or <= 0 is
 *                             dropped.
 * @returns {number|null} estimated compact point, or null with no usable
 *                        samples - callers then fall back to the
 *                        window-minus-reserve model.
 */
function observedCompactPoint(samples) {
    if (!Array.isArray(samples)) return null;
    const usable = samples.filter(n => Number.isFinite(n) && n > 0);
    if (usable.length === 0) return null;
    return median(usable.slice(-COMPACT_POINT_SAMPLES));
}

module.exports = { observedCompactPoint, COMPACT_POINT_SAMPLES };
