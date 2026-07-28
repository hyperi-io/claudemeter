//  Project:      Claudemeter
//  File:         src/tk/compactPoint.js
//  Purpose:      Estimate where auto-compact ACTUALLY fires for a session,
//                from that session's own compaction history.
//
//                The point auto-compact fires at is NOT a function of the
//                context window. Some Claude Code versions fire just short of
//                it; others fire at a small fraction of it, and a session on a
//                1M window can compact repeatedly around 168K. So it cannot be
//                derived, only observed - which the transcript supports, since
//                every compaction leaves a `compact_boundary` record carrying
//                the size it fired at.
//
//                Pure JS - no vscode dependency, no I/O, fully testable.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

// How many of a session's most recent auto compactions feed the estimate.
// Small enough to follow a shift in behaviour within a few compactions, large
// enough that a single outlying compaction cannot move the median.
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
 * Median rather than mean or latest: compaction sizes cluster tightly with
 * occasional outliers several times the cluster, so a mean is dragged up by
 * one of them and "latest" follows it off a cliff for a turn.
 *
 * Median rather than min: warning early costs a gauge that cries wolf for the
 * rest of the session, warning late costs the compaction it exists to warn
 * about. The median sits between, and the runway subtracted downstream already
 * biases toward early.
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
