// Tests for pure status-bar formatting helpers. These functions have
// no vscode-API dependencies (no require('vscode'), no config lookups)
// so they run as standalone unit tests without needing the vscode stub
// to do anything meaningful.
//
// Covers:
//   - formatTokenCount (rounding, k/M formatting)
//   - formatTokensDisplay (new claudemeter.statusBar.tokensDisplay setting)
//     with modes: bar, count, both
//   - formatTokensDisplayCompact (same three modes inside compact panel)
//   - Edge cases: zero, unknown limit, very small, very large, thresholds

import { describe, it, expect } from 'vitest';
const {
    formatTokenCount,
    formatAsBar,
    formatKCount,
    formatTokensDisplay,
    formatTokensDisplayCompact,
    BAR_STYLES,
} = require('../../src/statusBarFormatters');

describe('formatTokenCount', () => {
    it('formats 0 as 0k', () => {
        expect(formatTokenCount(0)).toBe('0k');
    });

    it('formats small values as 0k (sub-thousand)', () => {
        expect(formatTokenCount(1)).toBe('0k');
        expect(formatTokenCount(499)).toBe('0k');
    });

    it('rounds to nearest k', () => {
        expect(formatTokenCount(500)).toBe('1k');
        expect(formatTokenCount(1499)).toBe('1k');
        expect(formatTokenCount(1500)).toBe('2k');
    });

    it('formats 275k from 274719 (rounds up)', () => {
        expect(formatTokenCount(274719)).toBe('275k');
    });

    it('formats 275k from 275000 (exact)', () => {
        expect(formatTokenCount(275000)).toBe('275k');
    });

    it('formats 1M as 1m (no decimal for exact)', () => {
        expect(formatTokenCount(1000000)).toBe('1m');
    });

    it('formats 1.25M as 1.3m (rounds to 0.1)', () => {
        expect(formatTokenCount(1250000)).toBe('1.3m');
    });

    it('formats 1.5M as 1.5m', () => {
        expect(formatTokenCount(1500000)).toBe('1.5m');
    });

    it('formats 2M as 2m (strips .0)', () => {
        expect(formatTokenCount(2000000)).toBe('2m');
    });

    it('formats 999999 as 1000k (still below 1m threshold)', () => {
        expect(formatTokenCount(999999)).toBe('1000k');
    });

    it('formats 1050000 as 1.1m (rounds 1.05 up)', () => {
        expect(formatTokenCount(1050000)).toBe('1.1m');
    });

    it('formats 1010000 as 1m (1.01 rounds down to exact 1)', () => {
        expect(formatTokenCount(1010000)).toBe('1m');
    });

    it('formats 1040000 as 1m (1.04 rounds down)', () => {
        expect(formatTokenCount(1040000)).toBe('1m');
    });

    it('formats 1900000 as 1.9m', () => {
        expect(formatTokenCount(1900000)).toBe('1.9m');
    });

    it('handles negative defensively as 0k', () => {
        expect(formatTokenCount(-100)).toBe('0k');
    });

    it('handles NaN defensively as 0k', () => {
        expect(formatTokenCount(NaN)).toBe('0k');
    });

    it('handles null/undefined as 0k', () => {
        expect(formatTokenCount(null)).toBe('0k');
        expect(formatTokenCount(undefined)).toBe('0k');
    });
});

describe('formatAsBar', () => {
    it('renders 0% as all empty', () => {
        expect(formatAsBar(0, 'barCircle')).toBe('○○○○○');
    });

    it('renders 100% as all filled', () => {
        expect(formatAsBar(100, 'barCircle')).toBe('●●●●●');
    });

    it('renders 50% as half filled', () => {
        // 50% of 5 width rounds to 3 (Math.round(2.5))
        expect(formatAsBar(50, 'barCircle')).toBe('●●●○○');
    });

    it('renders 27% with barCircle', () => {
        // 27% of 5 → 1.35 → rounds to 1
        expect(formatAsBar(27, 'barCircle')).toBe('●○○○○');
    });

    it('clamps negative values to 0', () => {
        expect(formatAsBar(-10, 'barCircle')).toBe('○○○○○');
    });

    it('clamps above-100 values to 100', () => {
        expect(formatAsBar(150, 'barCircle')).toBe('●●●●●');
    });

    it('supports all four bar styles', () => {
        expect(formatAsBar(100, 'barLight')).toBe('▓▓▓▓▓');
        expect(formatAsBar(100, 'barSolid')).toBe('█████');
        expect(formatAsBar(100, 'barSquare')).toBe('■■■■■');
        expect(formatAsBar(100, 'barCircle')).toBe('●●●●●');
    });

    it('falls back to barLight for unknown style', () => {
        expect(formatAsBar(100, 'barUnknown')).toBe('▓▓▓▓▓');
    });

    it('accepts custom width', () => {
        expect(formatAsBar(100, 'barCircle', 3)).toBe('●●●');
        expect(formatAsBar(100, 'barCircle', 10)).toBe('●●●●●●●●●●');
    });
});

describe('BAR_STYLES', () => {
    it('exports all four style definitions', () => {
        expect(BAR_STYLES.barLight).toEqual({ filled: '▓', empty: '░' });
        expect(BAR_STYLES.barSolid).toEqual({ filled: '█', empty: '░' });
        expect(BAR_STYLES.barSquare).toEqual({ filled: '■', empty: '□' });
        expect(BAR_STYLES.barCircle).toEqual({ filled: '●', empty: '○' });
    });
});

describe('formatTokensDisplay — bar mode', () => {
    // Default-panel rendering (not compact).
    // 'bar' mode replicates pre-2.3.0 behaviour: just the percent-as-bar.
    it('bar mode shows only the bar (no token count)', () => {
        const result = formatTokensDisplay({
            display: 'bar',
            percent: 27,
            current: 275000,
            limit: 1000000,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('●○○○○');
    });

    it('bar mode with usageFormat=percent shows percent', () => {
        const result = formatTokensDisplay({
            display: 'bar',
            percent: 27,
            current: 275000,
            limit: 1000000,
            usageFormat: 'percent',
        });
        expect(result).toBe('27%');
    });

    it('bar mode respects usageFormat=barSolid', () => {
        const result = formatTokensDisplay({
            display: 'bar',
            percent: 100,
            current: 1000000,
            limit: 1000000,
            usageFormat: 'barSolid',
        });
        expect(result).toBe('█████');
    });
});

describe('formatKCount — tokensDisplay modes', () => {
    // The tokensDisplay setting controls the numeric part of the Tk
    // indicator. 200K is STANDARD_LIMIT — the baseline everyone shares.
    // `limit` mode only shows the max when it's *extended* past 200K,
    // because showing "200k" always would be noise.

    describe('bar mode (no numeric data)', () => {
        it('returns empty string for bar mode', () => {
            expect(formatKCount(100000, 200000, true, 'bar')).toBe('');
            expect(formatKCount(518000, 1000000, true, 'bar')).toBe('');
        });
    });

    describe('value mode (current only)', () => {
        it('shows current for 200K session', () => {
            expect(formatKCount(100000, 200000, true, 'value')).toBe('100k');
        });
        it('shows current for 1M session', () => {
            expect(formatKCount(518000, 1000000, true, 'value')).toBe('518k');
        });
        it('ignores limit entirely', () => {
            expect(formatKCount(100000, 200000, false, 'value')).toBe('100k');
        });
    });

    describe('extended mode (current/max)', () => {
        it('shows current/max for 200K session', () => {
            expect(formatKCount(100000, 200000, true, 'extended')).toBe('100k/200k');
        });
        it('shows current/max for 1M session', () => {
            expect(formatKCount(518000, 1000000, true, 'extended')).toBe('518k/1m');
        });
        it('hides max when knownLimit=false', () => {
            expect(formatKCount(518000, 1000000, false, 'extended')).toBe('518k');
        });
    });

    describe('limit mode (max only, extended only) — NEW DEFAULT', () => {
        it('returns empty for 200K session (not extended)', () => {
            expect(formatKCount(100000, 200000, true, 'limit')).toBe('');
        });
        it('shows max for 1M session', () => {
            expect(formatKCount(518000, 1000000, true, 'limit')).toBe('1m');
        });
        it('shows max for 2M session', () => {
            expect(formatKCount(1200000, 2000000, true, 'limit')).toBe('2m');
        });
        it('shows inferred max for 1M session (limit mode advertises ceiling only, safe even when inferred)', () => {
            expect(formatKCount(518000, 1000000, false, 'limit')).toBe('1m');
        });
        it('returns empty for 199K (edge: just under threshold)', () => {
            expect(formatKCount(50000, 199000, true, 'limit')).toBe('');
        });
    });

    describe('count mode (current/max, no bar)', () => {
        it('shows current/max for 1M session', () => {
            expect(formatKCount(518000, 1000000, true, 'count')).toBe('518k/1m');
        });
        it('shows current only when knownLimit=false', () => {
            expect(formatKCount(518000, 1000000, false, 'count')).toBe('518k');
        });
    });

    describe('legacy both alias migrates to extended', () => {
        it('both mode treated as extended', () => {
            expect(formatKCount(518000, 1000000, true, 'both')).toBe('518k/1m');
        });
    });

    describe('default behaviour (limit mode)', () => {
        it('defaults to limit mode when tokensDisplay is undefined', () => {
            expect(formatKCount(100000, 200000, true)).toBe('');       // 200K not extended
            expect(formatKCount(518000, 1000000, true)).toBe('1m');    // 1M is extended
        });
        it('falls back to limit mode on unknown value', () => {
            expect(formatKCount(518000, 1000000, true, 'weird')).toBe('1m');
        });
    });
});

describe('formatTokensDisplay — count mode', () => {
    // 'count' mode shows k-count with denominator when limit is known.
    it('count mode with known limit shows current/limit', () => {
        const result = formatTokensDisplay({
            display: 'count',
            percent: 27,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('275k/1m');
    });

    it('count mode with unknown limit omits denominator', () => {
        const result = formatTokensDisplay({
            display: 'count',
            percent: 0,
            current: 275000,
            limit: 1000000,
            knownLimit: false,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('275k');
    });

    it('count mode with known limit at 0 shows 0k/1m', () => {
        const result = formatTokensDisplay({
            display: 'count',
            percent: 0,
            current: 0,
            limit: 1000000,
            knownLimit: true,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('0k/1m');
    });

    it('count mode with 200K limit', () => {
        const result = formatTokensDisplay({
            display: 'count',
            percent: 50,
            current: 100000,
            limit: 200000,
            knownLimit: true,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('100k/200k');
    });
});

describe('formatTokensDisplay — both mode (default)', () => {
    // 'both' mode shows bar AND k-count side by side.
    // Denominator rule: matches count-mode uniformly (include when known).
    it('both mode with known limit shows bar + count/limit', () => {
        const result = formatTokensDisplay({
            display: 'both',
            percent: 27,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('●○○○○ 275k/1m');
    });

    it('both mode with unknown limit omits denominator', () => {
        const result = formatTokensDisplay({
            display: 'both',
            percent: 0,
            current: 275000,
            limit: 200000, // snapped fallback
            knownLimit: false,
            usageFormat: 'barCircle',
        });
        // Bar still shown based on snapped percent (but we pass percent=0
        // to simulate the inferred case where we don't pretend to know);
        // count side omits denominator.
        expect(result).toBe('○○○○○ 275k');
    });

    it('both mode with usageFormat=percent shows percent + count', () => {
        const result = formatTokensDisplay({
            display: 'both',
            percent: 27,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
            usageFormat: 'percent',
        });
        expect(result).toBe('27% 275k/1m');
    });

    it('both mode at 100% looks right', () => {
        const result = formatTokensDisplay({
            display: 'both',
            percent: 100,
            current: 1000000,
            limit: 1000000,
            knownLimit: true,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('●●●●● 1m/1m');
    });
});

describe('formatTokensDisplay — fallback and edge cases', () => {
    it('defaults to limit mode when display is undefined (1M session)', () => {
        // New default: limit mode shows max only when extended.
        // 1M > 200K threshold, so max renders as "1m".
        const result = formatTokensDisplay({
            percent: 27,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('●○○○○ 1m');
    });

    it('default on 200K session shows just the bar (limit mode suppresses max at baseline)', () => {
        const result = formatTokensDisplay({
            percent: 27,
            current: 55000,
            limit: 200000,
            knownLimit: true,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('●○○○○');
    });

    it('treats unknown display value as limit (default) — shows max on 1M', () => {
        const result = formatTokensDisplay({
            display: 'weird',
            percent: 27,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('●○○○○ 1m');
    });
});

describe('formatTokensDisplayCompact — compact mode variants', () => {
    // Compact mode uses the `Tk-NN%` convention instead of a literal bar,
    // so the 'bar' label really means 'percentage'. The three modes are:
    //   bar    -> `Tk-36%`
    //   count  -> `Tk-275k` (with /1m if known at 1M limit)
    //   both   -> `Tk-36% 275k` (with /1m if known at 1M limit)

    it('bar mode returns percent-only string', () => {
        const result = formatTokensDisplayCompact({
            display: 'bar',
            percent: 36,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
        });
        expect(result).toBe('Tk-36%');
    });

    it('count mode with known limit', () => {
        const result = formatTokensDisplayCompact({
            display: 'count',
            percent: 27,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
        });
        expect(result).toBe('Tk-275k/1m');
    });

    it('count mode with unknown limit omits denominator', () => {
        const result = formatTokensDisplayCompact({
            display: 'count',
            percent: 0,
            current: 275000,
            limit: 200000,
            knownLimit: false,
        });
        expect(result).toBe('Tk-275k');
    });

    it('both mode with known limit shows percent and count', () => {
        const result = formatTokensDisplayCompact({
            display: 'both',
            percent: 36,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
        });
        expect(result).toBe('Tk-36% 275k/1m');
    });

    it('both mode with unknown limit shows percent (snapped) + count (no denominator)', () => {
        const result = formatTokensDisplayCompact({
            display: 'both',
            percent: 0,
            current: 275000,
            limit: 200000,
            knownLimit: false,
        });
        expect(result).toBe('Tk-0% 275k');
    });

    it('defaults to limit mode when display is undefined (1M session shows max)', () => {
        const result = formatTokensDisplayCompact({
            percent: 36,
            current: 275000,
            limit: 1000000,
            knownLimit: true,
        });
        expect(result).toBe('Tk-36% 1m');
    });

    it('default on 200K session shows just percent (limit mode suppresses)', () => {
        const result = formatTokensDisplayCompact({
            percent: 36,
            current: 55000,
            limit: 200000,
            knownLimit: true,
        });
        expect(result).toBe('Tk-36%');
    });

    it('compact with no data returns Tk-- as before', () => {
        const result = formatTokensDisplayCompact({
            display: 'both',
            percent: null,
            current: null,
            limit: null,
            knownLimit: false,
        });
        expect(result).toBe('Tk--');
    });
});

describe('formatTokensDisplay — no data', () => {
    it('bar mode with null percent returns empty bar', () => {
        const result = formatTokensDisplay({
            display: 'bar',
            percent: null,
            current: null,
            limit: null,
            knownLimit: false,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('-');
    });

    it('count mode with null current returns dash', () => {
        const result = formatTokensDisplay({
            display: 'count',
            percent: null,
            current: null,
            limit: null,
            knownLimit: false,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('-');
    });

    it('both mode with null current returns dash', () => {
        const result = formatTokensDisplay({
            display: 'both',
            percent: null,
            current: null,
            limit: null,
            knownLimit: false,
            usageFormat: 'barCircle',
        });
        expect(result).toBe('-');
    });
});
