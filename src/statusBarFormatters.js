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

// Display mode for claudemeter.statusBar.tokensDisplay.
//
// The enum expanded in 2.3.x to give finer control over the numeric
// half of the Tk indicator. Old users who had `both` (the previous
// default) are auto-migrated to `extended` in extension.js, so they
// see no visible change.
//
//   bar      — "Tk ●○○○○"              just the progress bar / percent
//   value    — "Tk ●○○○○ 518k"         bar + current consumption
//   extended — "Tk ●○○○○ 518k/1m"      bar + current/max (was: "both")
//   limit    — "Tk ●○○○○ 1m"           bar + max only, but ONLY when the
//                                       max is extended beyond the 200K
//                                       baseline. 200K sessions show
//                                       just the bar. NEW DEFAULT.
//   count    — "Tk 518k/1m"             count only, no bar
//
// The threshold for `limit`'s "is it extended" check mirrors
// modelContextWindows.STANDARD_LIMIT (200000) but is kept local so
// this module stays pure.
const DISPLAY_BAR      = 'bar';
const DISPLAY_VALUE    = 'value';
const DISPLAY_EXTENDED = 'extended';
const DISPLAY_LIMIT    = 'limit';
const DISPLAY_COUNT    = 'count';
const DISPLAY_DEFAULT  = DISPLAY_LIMIT;

// Legacy value kept for internal migration + back-compat on any
// external callers still using 'both'. Treated as `extended`.
const DISPLAY_BOTH     = 'both';

const EXTENDED_THRESHOLD = 200000;

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

// Render the numeric half of the Tk indicator for a given tokensDisplay
// mode. Returns the empty string when the current mode shouldn't show
// any numeric content — the caller is expected to fall back to the bar.
//
// knownLimit=false (limit is inferred, not authoritative) suppresses
// any "/max" rendering — we don't want to publish a ratio we're not
// sure about. `value` still shows the current only; `extended` and
// `count` drop the denominator.
//
// `limit` mode is special: it advertises the ceiling alone, not a
// ratio. An inferred 1M ceiling is still useful information (the user
// wants to know their context window is extended), so `limit` mode
// shows the max whenever the limit is present and extended past the
// 200K baseline, regardless of knownLimit.
function formatKCount(current, limit, knownLimit, tokensDisplay = DISPLAY_DEFAULT) {
    if (current == null) return '';

    const mode = normaliseTokensDisplay(tokensDisplay);
    const currentK = formatTokenCount(current);
    const hasLimit = limit != null && limit > 0;
    const hasKnownLimit = knownLimit && hasLimit;
    const isExtended = hasLimit && limit > EXTENDED_THRESHOLD;

    switch (mode) {
        case DISPLAY_BAR:
            return '';
        case DISPLAY_VALUE:
            return currentK;
        case DISPLAY_EXTENDED:
            return hasKnownLimit ? `${currentK}/${formatTokenCount(limit)}` : currentK;
        case DISPLAY_LIMIT:
            return isExtended ? formatTokenCount(limit) : '';
        case DISPLAY_COUNT:
            return hasKnownLimit ? `${currentK}/${formatTokenCount(limit)}` : currentK;
        default:
            return isExtended ? formatTokenCount(limit) : '';
    }
}

function normaliseTokensDisplay(tokensDisplay) {
    if (tokensDisplay === DISPLAY_BOTH) return DISPLAY_EXTENDED;  // legacy alias
    if (tokensDisplay === DISPLAY_BAR
        || tokensDisplay === DISPLAY_VALUE
        || tokensDisplay === DISPLAY_EXTENDED
        || tokensDisplay === DISPLAY_LIMIT
        || tokensDisplay === DISPLAY_COUNT) {
        return tokensDisplay;
    }
    return DISPLAY_DEFAULT;
}

// Build the Tk indicator body for the default/minimal panel modes.
//
// Parameters:
//   display      - one of bar|value|extended|limit|count. Legacy 'both'
//                  is migrated to 'extended'. Default: 'limit'.
//   percent      - 0..100 or null for no-data
//   current      - raw token count or null
//   limit        - resolved limit in tokens, or null
//   knownLimit   - true when the resolved limit came from an
//                  authoritative/configured source
//   usageFormat  - 'percent' or one of the bar* styles
function formatTokensDisplay(opts) {
    const {
        display = DISPLAY_DEFAULT,
        percent,
        current,
        limit,
        knownLimit = false,
        usageFormat = 'barCircle',
    } = opts || {};

    if (percent == null && current == null) {
        return NO_DATA;
    }

    const mode = normaliseTokensDisplay(display);
    const count = formatKCount(current, limit, knownLimit, mode);

    if (mode === DISPLAY_COUNT) {
        // count-only mode — no bar. If count came back empty (unknown
        // limit on a limit-mode that needs it), fall back to bar so
        // the user sees *something*.
        return count || formatIndicator(percent, usageFormat);
    }

    // Everything else shows the bar. The numeric count follows if non-empty.
    const bar = formatIndicator(percent, usageFormat);
    return count ? `${bar} ${count}` : bar;
}

// Build the Tk indicator body for the compact panel mode. Compact
// mode uses `Tk-36%` / `Tk-275k` / `Tk-36% 275k` with all three
// values concatenated into one status-bar panel together with the
// Se and Wk items. The `-` prefix is inherited from the pre-2.3.0
// compact format; it sits between the `Tk` label and the value.
function formatTokensDisplayCompact(opts) {
    const {
        display = DISPLAY_DEFAULT,
        percent,
        current,
        limit,
        knownLimit = false,
    } = opts || {};

    if (percent == null && current == null) {
        return 'Tk--';
    }

    const mode = normaliseTokensDisplay(display);
    const percentStr = percent != null ? `${percent}%` : NO_DATA;
    const countStr = formatKCount(current, limit, knownLimit, mode);

    if (mode === DISPLAY_COUNT) {
        return `Tk-${countStr || percentStr}`;
    }

    return countStr ? `Tk-${percentStr} ${countStr}` : `Tk-${percentStr}`;
}

module.exports = {
    DISPLAY_BAR,
    DISPLAY_VALUE,
    DISPLAY_EXTENDED,
    DISPLAY_LIMIT,
    DISPLAY_COUNT,
    DISPLAY_BOTH,       // legacy alias; exported for back-compat with any external callers
    DISPLAY_DEFAULT,
    EXTENDED_THRESHOLD,
    BAR_STYLES,
    formatTokenCount,
    formatAsBar,
    formatIndicator,
    formatKCount,
    normaliseTokensDisplay,
    formatTokensDisplay,
    formatTokensDisplayCompact,
};
