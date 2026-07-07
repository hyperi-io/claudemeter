//  Project:      Claudemeter
//  File:         tests/unit/tkRotGradient.test.js
//  Purpose:      Test suite for rotGradientT — the continuous position of
//                `used` within the rot blue zone [rotLightTokens, yellow).
//                Returns 0..1 inside the zone, null outside it (so callers
//                fall back to discrete normal/warning/error colours).
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

import { describe, it, expect } from 'vitest';
const { rotGradientT } = require('../../src/tk/thresholds');
const { PROFILES } = require('../../src/tk/profiles');

describe('rotGradientT — 1M window (max-20x, rot enabled)', () => {
    const profile = PROFILES['max-20x'];
    const window = 1_000_000;
    // rotLightTokens = 400_000; yellow threshold = 947_000.
    // zone span = 547_000; midpoint = 673_500.

    it('below rot floor (399_999) → null', () => {
        expect(rotGradientT(399_999, profile, window)).toBeNull();
    });

    it('exactly at rot floor (400_000) → 0', () => {
        expect(rotGradientT(400_000, profile, window)).toBe(0);
    });

    it('midpoint of zone (673_500) → 0.5', () => {
        expect(rotGradientT(673_500, profile, window)).toBeCloseTo(0.5, 5);
    });

    it('just below yellow (946_999) → close to 1 but < 1', () => {
        const t = rotGradientT(946_999, profile, window);
        expect(t).toBeGreaterThan(0.99);
        expect(t).toBeLessThan(1);
    });

    it('at yellow threshold (947_000) → null (warning zone owns it)', () => {
        expect(rotGradientT(947_000, profile, window)).toBeNull();
    });

    it('in error zone (962_000) → null', () => {
        expect(rotGradientT(962_000, profile, window)).toBeNull();
    });

    it('is monotonically increasing across the zone', () => {
        const a = rotGradientT(450_000, profile, window);
        const b = rotGradientT(550_000, profile, window);
        const c = rotGradientT(900_000, profile, window);
        expect(a).toBeLessThan(b);
        expect(b).toBeLessThan(c);
    });
});

describe('rotGradientT — rot disabled / defensive', () => {
    it('pro 200K window → null mid-range (window-gated, <=200K)', () => {
        expect(rotGradientT(150_000, PROFILES.pro, 200_000)).toBeNull();
    });

    it('200K window → null for a rot-capable profile (window-gated)', () => {
        expect(rotGradientT(150_000, PROFILES['max-20x'], 200_000)).toBeNull();
    });

    it('null profile → null', () => {
        expect(rotGradientT(500_000, null, 1_000_000)).toBeNull();
    });

    it('profile with no thresholds → null', () => {
        expect(rotGradientT(500_000, { name: 'broken' }, 1_000_000)).toBeNull();
    });

    it('degenerate window where yellow <= rot floor → null (no zone)', () => {
        // Tiny window: compactPoint - warningRunway falls below rotLightTokens,
        // so the blue zone collapses and there is nothing to interpolate.
        expect(rotGradientT(300_000, PROFILES['max-20x'], 250_000)).toBeNull();
    });
});
