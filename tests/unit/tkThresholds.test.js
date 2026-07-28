//  Project:      Claudemeter
//  File:         tests/unit/tkThresholds.test.js
//  Purpose:      Test suite for getTkLevel resolver.
//                Tests 5-tier ladder: normal / rotLight / rotDeep / warning / error.
//                Covers 200K / 500K / 1M window sizes, boundary semantics,
//                rotEnabled gating, and defensive null handling.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

import { describe, it, expect } from 'vitest';
const { getTkLevel } = require('../../src/tk/thresholds');
const { PROFILES } = require('../../src/tk/profiles');

describe('getTkLevel — 200K window (Pro / Unknown profiles)', () => {
    const profile = PROFILES.pro;  // standard runway, no rot
    const window = 200_000;

    it('low usage (50K) → normal', () => {
        expect(getTkLevel(50_000, profile, window)).toBe('normal');
    });

    it('approaching warning runway (146K = compact-21K) → normal (not yet 20K runway)', () => {
        // compactPoint = 167_000; warning fires at 167_000 - 20_000 = 147_000
        expect(getTkLevel(146_000, profile, window)).toBe('normal');
    });

    it('exactly warning threshold (147K) → warning', () => {
        expect(getTkLevel(147_000, profile, window)).toBe('warning');
    });

    it('exactly error threshold (162K = compact-5K) → error', () => {
        // compactPoint = 167_000; error fires at 167_000 - 5_000 = 162_000
        expect(getTkLevel(162_000, profile, window)).toBe('error');
    });

    it('past error (180K) → still error', () => {
        expect(getTkLevel(180_000, profile, window)).toBe('error');
    });

    it('rot tiers do not fire on rotEnabled=false profile', () => {
        // Rot is window-gated (>200K); this pro profile is on a 200K window so
        // rot never fires regardless. 300K on a 200K window is past the error
        // threshold (162K) anyway, so error wins.
        expect(getTkLevel(300_000, profile, window)).toBe('error');
    });
});

describe('getTkLevel — 1M window (Max profiles)', () => {
    const profile = PROFILES['max-20x'];  // standard runway + rot
    const window = 1_000_000;

    it('low usage (50K) → normal', () => {
        expect(getTkLevel(50_000, profile, window)).toBe('normal');
    });

    it('rotLight threshold (400K) → rotLight', () => {
        expect(getTkLevel(400_000, profile, window)).toBe('rotLight');
    });

    it('between rotLight and rotDeep (500K) → rotLight', () => {
        expect(getTkLevel(500_000, profile, window)).toBe('rotLight');
    });

    it('rotDeep threshold (650K) → rotDeep', () => {
        expect(getTkLevel(650_000, profile, window)).toBe('rotDeep');
    });

    it('between rotDeep and warning (900K) → rotDeep', () => {
        expect(getTkLevel(900_000, profile, window)).toBe('rotDeep');
    });

    it('warning threshold (947K = compactPoint - 20K) → warning', () => {
        // compactPoint = 967_000; warning at 967_000 - 20_000 = 947_000
        expect(getTkLevel(947_000, profile, window)).toBe('warning');
    });

    it('error threshold (962K = compactPoint - 5K) → error', () => {
        expect(getTkLevel(962_000, profile, window)).toBe('error');
    });

    it('past error (990K) → still error', () => {
        expect(getTkLevel(990_000, profile, window)).toBe('error');
    });
});

describe('getTkLevel — 500K window (Enterprise profile)', () => {
    const profile = PROFILES.enterprise;  // 500K window is >200K, so rot applies (window-gated, not profile)
    const window = 500_000;

    it('420K used → rotLight (rot floor 400K, yellow at 447K)', () => {
        expect(getTkLevel(420_000, profile, window)).toBe('rotLight');
    });

    it('warning threshold (447K) → warning', () => {
        expect(getTkLevel(447_000, profile, window)).toBe('warning');
    });

    it('error threshold (462K) → error', () => {
        expect(getTkLevel(462_000, profile, window)).toBe('error');
    });

    it('300K → normal (below the 400K rot floor; rot keyed to the >200K window, not the profile)', () => {
        expect(getTkLevel(300_000, profile, window)).toBe('normal');
    });
});

// A session can auto-compact at a small fraction of its window - around 168K
// on a 1M window. Tiers derived from the window put yellow at 947K and red at
// 962K, so they cannot fire before a compaction that happens at a sixth of
// that. Only the session's own compaction history knows where the cliff is.
describe('getTkLevel — observed compact point overrides the reserve model', () => {
    const profile = PROFILES['max-20x'];
    const window = 1_000_000;
    const compactPoint = 167_974;   // median of that session's last five

    it('goes red just under the point the session actually compacts at', () => {
        // errorRunwayTokens is 5K, so red from 162,974.
        expect(getTkLevel(162_974, profile, window, compactPoint)).toBe('error');
        expect(getTkLevel(167_000, profile, window, compactPoint)).toBe('error');
    });

    it('goes yellow 20K out, where the reserve model still says normal', () => {
        // warningRunwayTokens is 20K, so yellow from 147,974.
        expect(getTkLevel(147_974, profile, window, compactPoint)).toBe('warning');
        expect(getTkLevel(147_974, profile, window)).toBe('normal');
    });

    it('the exact reported reading is red, not silent', () => {
        // 166,984 tokens was one of that session's actual compaction sizes.
        expect(getTkLevel(166_984, profile, window)).toBe('normal');
        expect(getTkLevel(166_984, profile, window, compactPoint)).toBe('error');
    });

    it('leaves a session well short of its compact point alone', () => {
        expect(getTkLevel(100_000, profile, window, compactPoint)).toBe('normal');
    });

    it('does not disturb sessions that really do compact at the window', () => {
        // The 1M sessions on older Claude Code compacted at ~1,000,900, which
        // is within a rounding error of the reserve model's own answer.
        const atWindow = 1_000_889;
        expect(getTkLevel(500_000, profile, window, atWindow)).toBe('rotLight');
        expect(getTkLevel(700_000, profile, window, atWindow)).toBe('rotDeep');
        expect(getTkLevel(996_000, profile, window, atWindow)).toBe('error');
    });

    it('falls back to the reserve model when the session has never compacted', () => {
        for (const noPoint of [null, undefined, 0, NaN, -1]) {
            expect(getTkLevel(947_000, profile, window, noPoint)).toBe('warning');
            expect(getTkLevel(500_000, profile, window, noPoint)).toBe('rotLight');
        }
    });

    it('rot still keys off absolute usage, not the compact point', () => {
        // Rot is a property of how much text the model is reasoning over, so a
        // low compact point must not drag the 400K/650K frontier down with it.
        // Above the compact point the compaction warning wins, as it should.
        expect(getTkLevel(450_000, profile, window, compactPoint)).toBe('error');
        expect(getTkLevel(450_000, profile, window, 900_000)).toBe('rotLight');
    });
});

describe('getTkLevel — defensive', () => {
    it('null profile → normal', () => {
        expect(getTkLevel(500_000, null, 1_000_000)).toBe('normal');
    });

    it('profile with no thresholds → normal', () => {
        expect(getTkLevel(500_000, { name: 'broken' }, 1_000_000)).toBe('normal');
    });

    it('used = 0 → normal even on tiny window', () => {
        expect(getTkLevel(0, PROFILES.pro, 200_000)).toBe('normal');
    });
});

describe('getTkLevel — boundary inclusive (>=) at every threshold', () => {
    const profile = PROFILES['max-20x'];
    const window = 1_000_000;

    it('used exactly at rotLightTokens (400K) → rotLight', () => {
        expect(getTkLevel(400_000, profile, window)).toBe('rotLight');
    });

    it('used at 399_999 (just below rotLight) → normal', () => {
        expect(getTkLevel(399_999, profile, window)).toBe('normal');
    });

    it('used at 649_999 (just below rotDeep) → rotLight', () => {
        expect(getTkLevel(649_999, profile, window)).toBe('rotLight');
    });

    it('used at 946_999 (just below warning) → rotDeep', () => {
        expect(getTkLevel(946_999, profile, window)).toBe('rotDeep');
    });

    it('used at 961_999 (just below error) → warning', () => {
        expect(getTkLevel(961_999, profile, window)).toBe('warning');
    });
});
