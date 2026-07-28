// Tests for the observed auto-compact point - the replacement for assuming
// compaction fires at `contextWindow - compactReserveTokens`.
//
// That assumption held on Claude Code 2.1.181-2.1.207 (six sessions, seventeen
// auto compactions, all at 999,548-1,005,372 on a 1M window) and did not on
// 2.1.220, where one session compacted sixteen times between 166,984 and
// 608,197 on a window it demonstrably held 606,132 tokens in. Every number
// below is from those transcripts.

import { describe, it, expect } from 'vitest';
const { observedCompactPoint, COMPACT_POINT_SAMPLES } = require('../../src/tk/compactPoint');

// The full boundary series of the session that prompted this, oldest first.
const REAL_SERIES = [
    608197, 198749, 178394, 168104, 166984, 196005, 172005, 169871,
    281192, 223876, 168640, 167968, 167974, 167151, 311579, 169446,
];

describe('observedCompactPoint', () => {
    it('lands on the recent cluster, not dragged by old excursions', () => {
        // Last five are 168,640 / 167,968 / 167,974 / 167,151 / 169,446.
        expect(observedCompactPoint(REAL_SERIES)).toBe(167974);
    });

    it('ignores everything older than the sample window', () => {
        const withAncientJunk = [5, 10, 15, 20, 25, ...REAL_SERIES.slice(-COMPACT_POINT_SAMPLES)];
        expect(observedCompactPoint(withAncientJunk)).toBe(167974);
    });

    it('rides over a single excursion instead of chasing it', () => {
        // 311,579 was real and immediately followed by 169,446. A "latest wins"
        // estimate would have doubled the compact point for one turn; a mean
        // would sit ~28K high. The median does neither.
        const throughTheSpike = [167968, 167974, 167151, 311579, 169446];
        expect(observedCompactPoint(throughTheSpike)).toBe(167974);
    });

    it('tracks a genuine regime change once it outnumbers the old one', () => {
        // Three of the last five at the new level is enough to move the median.
        const shifted = [167151, 169446, 400000, 410000, 405000];
        expect(observedCompactPoint(shifted)).toBe(400000);
    });

    it('handles the 1M sessions, where compaction really is at the window', () => {
        const atTheWindow = [1000889, 1000048, 1000407, 1003375, 1000921];
        expect(observedCompactPoint(atTheWindow)).toBe(1000889);
    });

    it('works from a single compaction', () => {
        expect(observedCompactPoint([167151])).toBe(167151);
    });

    it('averages the middle pair on an even count', () => {
        expect(observedCompactPoint([100000, 200000])).toBe(150000);
    });

    it('returns null when there is nothing to go on', () => {
        // Callers fall back to the window-minus-reserve model on null.
        expect(observedCompactPoint([])).toBeNull();
        expect(observedCompactPoint(null)).toBeNull();
        expect(observedCompactPoint(undefined)).toBeNull();
        expect(observedCompactPoint('167151')).toBeNull();
    });

    it('drops junk samples rather than letting them skew the median', () => {
        expect(observedCompactPoint([NaN, 0, -5, Infinity, null, 167151])).toBe(167151);
        expect(observedCompactPoint([NaN, 0, -5])).toBeNull();
    });

    it('does not mutate the caller"s array', () => {
        const input = [...REAL_SERIES];
        observedCompactPoint(input);
        expect(input).toEqual(REAL_SERIES);
    });
});
