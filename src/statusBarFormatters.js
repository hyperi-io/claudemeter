// Project:   Claudemeter
// File:      statusBarFormatters.js
// Purpose:   Pure formatting helpers for the status bar Tk indicator.
//            No vscode API dependencies — unit-testable in isolation.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// This module was extracted from statusBar.js so the new
// tokensDisplay option (bar / count / both) can be covered by
// fast, deterministic unit tests without pulling in the vscode
// module stub or any config lookups. Everything in here takes
// its inputs as parameters.

// Display mode for claudemeter.statusBar.tokensDisplay
const DISPLAY_BAR   = 'bar';    // progress bar (or percent per usageFormat) only
const DISPLAY_COUNT = 'count';  // k-count only (e.g. 275k / 1000k)
const DISPLAY_BOTH  = 'both';   // bar + k-count side by side (default)

// Character sets for each bar style. barLight is the fallback for
// unknown styles (barSolid/barSquare/barCircle are the other three
// values accepted by claudemeter.statusBar.usageFormat).
const BAR_STYLES = {
    barLight:  { filled: '▓', empty: '░' },
    barSolid:  { filled: '█', empty: '░' },
    barSquare: { filled: '■', empty: '□' },
    barCircle: { filled: '●', empty: '○' },
};

// Placeholder shown when there's no data to render.
const NO_DATA = '-';

// Format a raw token count. Uses "k" below 1M and "m" at 1M and above so
// large context windows (1M / 2M / etc.) stay compact and readable in the
// status bar — e.g. "355k/1m" instead of "355k/1000k".
//
//   0       -> "0k"
//   275000  -> "275k"
//   1000000 -> "1m"     (exact: strip trailing .0)
//   1250000 -> "1.3m"   (round to nearest 0.1)
//   2000000 -> "2m"
//
// Defensive for NaN/null/negative: any of those collapse to "0k".
function formatTokenCount(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
        return '0k';
    }
    if (n >= 1000000) {
        const s = (n / 1000000).toFixed(1);
        return s.endsWith('.0') ? `${s.slice(0, -2)}m` : `${s}m`;
    }
    const k = Math.round(n / 1000);
    return `${k}k`;
}

// Render a percentage as a filled-vs-empty progress bar using the
// given style. Percent is clamped to [0, 100] and rounded to the
// nearest whole bar cell.
function formatAsBar(percent, style, width = 5) {
    const clamped = Math.max(0, Math.min(100, percent || 0));
    const filled = Math.round((clamped / 100) * width);
    const chars = BAR_STYLES[style] || BAR_STYLES.barLight;
    return chars.filled.repeat(filled) + chars.empty.repeat(width - filled);
}

// Build the indicator half of the Tk display — either a bar (via
// formatAsBar) or the bare percent string, depending on usageFormat.
// For the default/minimal display modes this is what sits next to
// the k-count in `both` mode, or alone in `bar` mode.
function formatIndicator(percent, usageFormat) {
    if (percent == null) return NO_DATA;
    if (usageFormat === 'percent') {
        return `${percent}%`;
    }
    return formatAsBar(percent, usageFormat);
}

// Render the k-count half. Shows a denominator (e.g. "275k/1000k")
// only when knownLimit is true — the inferred / unknown-limit case
// omits the denominator to avoid lying about a limit we don't know.
function formatKCount(current, limit, knownLimit) {
    if (current == null) return NO_DATA;
    const currentK = formatTokenCount(current);
    if (knownLimit && limit != null && limit > 0) {
        return `${currentK}/${formatTokenCount(limit)}`;
    }
    return currentK;
}

// Build the Tk indicator body for the default/minimal panel modes.
// Returns a string like "●○○○○ 275k/1000k" (both), "●○○○○" (bar),
// or "275k/1000k" (count). Unknown display values default to 'both'.
//
// Parameters:
//   display      - 'bar' | 'count' | 'both' (default 'both')
//   percent      - 0..100 or null for no-data
//   current      - raw token count or null
//   limit        - resolved limit in tokens, or null
//   knownLimit   - true when the resolved limit came from an
//                  authoritative/configured source (not 'inferred'
//                  or 'unknown'); controls whether the k-count
//                  shows a denominator
//   usageFormat  - 'percent' or one of the bar* styles (controls
//                  the indicator half in bar/both mode)
function formatTokensDisplay(opts) {
    const {
        display = DISPLAY_BOTH,
        percent,
        current,
        limit,
        knownLimit = false,
        usageFormat = 'barCircle',
    } = opts || {};

    // No-data short-circuit: we can still render a bar if percent
    // is known, but bar+null current makes no sense. When both are
    // null, return the NO_DATA placeholder.
    if (percent == null && current == null) {
        return NO_DATA;
    }

    const mode = normaliseDisplay(display);

    if (mode === DISPLAY_BAR) {
        return formatIndicator(percent, usageFormat);
    }

    if (mode === DISPLAY_COUNT) {
        return formatKCount(current, limit, knownLimit);
    }

    // DISPLAY_BOTH
    return `${formatIndicator(percent, usageFormat)} ${formatKCount(current, limit, knownLimit)}`;
}

// Build the Tk indicator body for the compact panel mode. Compact
// mode uses `Tk-36%` / `Tk-275k` / `Tk-36% 275k` with all three
// values concatenated into one status-bar panel together with the
// Se and Wk items. The `-` prefix is inherited from the pre-2.3.0
// compact format; it sits between the `Tk` label and the value.
function formatTokensDisplayCompact(opts) {
    const {
        display = DISPLAY_BOTH,
        percent,
        current,
        limit,
        knownLimit = false,
    } = opts || {};

    if (percent == null && current == null) {
        return 'Tk--';
    }

    const mode = normaliseDisplay(display);

    const percentStr = percent != null ? `${percent}%` : NO_DATA;
    const countStr = formatKCount(current, limit, knownLimit);

    if (mode === DISPLAY_BAR) {
        return `Tk-${percentStr}`;
    }

    if (mode === DISPLAY_COUNT) {
        return `Tk-${countStr}`;
    }

    // DISPLAY_BOTH
    return `Tk-${percentStr} ${countStr}`;
}

function normaliseDisplay(display) {
    if (display === DISPLAY_BAR || display === DISPLAY_COUNT || display === DISPLAY_BOTH) {
        return display;
    }
    return DISPLAY_BOTH;
}

module.exports = {
    DISPLAY_BAR,
    DISPLAY_COUNT,
    DISPLAY_BOTH,
    BAR_STYLES,
    formatTokenCount,
    formatAsBar,
    formatIndicator,
    formatKCount,
    formatTokensDisplay,
    formatTokensDisplayCompact,
};
