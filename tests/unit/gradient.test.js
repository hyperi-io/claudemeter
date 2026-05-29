//  Project:      Claudemeter
//  File:         tests/unit/gradient.test.js
//  Purpose:      Test suite for lerpHexOklab — OKLab colour interpolation.
//                Locks in the properties that motivated OKLab over naive
//                sRGB/HSL: no muddy-grey or spurious-pink midpoints on a
//                white→blue ramp.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

import { describe, it, expect } from 'vitest';
const { lerpHexOklab } = require('../../src/tk/gradient');

function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const WHITE_BLUE_A = '#eef5fc';
const WHITE_BLUE_B = '#163a63';

describe('lerpHexOklab — endpoints and clamping', () => {
    it('t=0 returns the start colour exactly', () => {
        expect(lerpHexOklab(WHITE_BLUE_A, WHITE_BLUE_B, 0)).toBe(WHITE_BLUE_A);
    });

    it('t=1 returns the end colour exactly', () => {
        expect(lerpHexOklab(WHITE_BLUE_A, WHITE_BLUE_B, 1)).toBe(WHITE_BLUE_B);
    });

    it('t<0 clamps to the start colour', () => {
        expect(lerpHexOklab(WHITE_BLUE_A, WHITE_BLUE_B, -3)).toBe(WHITE_BLUE_A);
    });

    it('t>1 clamps to the end colour', () => {
        expect(lerpHexOklab(WHITE_BLUE_A, WHITE_BLUE_B, 9)).toBe(WHITE_BLUE_B);
    });

    it('always emits a valid #rrggbb string', () => {
        expect(lerpHexOklab(WHITE_BLUE_A, WHITE_BLUE_B, 0.37)).toMatch(/^#[0-9a-f]{6}$/);
    });
});

describe('lerpHexOklab — malformed input', () => {
    it('falls back to hexA when hexB is junk', () => {
        expect(lerpHexOklab(WHITE_BLUE_A, 'nope', 0.5)).toBe(WHITE_BLUE_A);
    });

    it('accepts hex without leading #', () => {
        expect(lerpHexOklab('eef5fc', '163a63', 0)).toBe(WHITE_BLUE_A);
    });
});

describe('lerpHexOklab — white→blue stays blue (no pink, no grey)', () => {
    // The reason we use OKLab: HSL inserts pink, naive sRGB inserts grey.
    // Across the whole ramp blue must dominate (b highest) and the colour
    // must not collapse toward neutral grey (channels not all near-equal).
    it('keeps b as the dominant channel at every step', () => {
        for (let i = 0; i <= 10; i++) {
            const { r, g, b } = rgb(lerpHexOklab(WHITE_BLUE_A, WHITE_BLUE_B, i / 10));
            expect(b).toBeGreaterThanOrEqual(g);  // never pink (r/g overtaking b)
            expect(g).toBeGreaterThanOrEqual(r);
        }
    });

    it('midpoint is not a muddy grey (channels not all within 12 of each other)', () => {
        const { r, g, b } = rgb(lerpHexOklab(WHITE_BLUE_A, WHITE_BLUE_B, 0.5));
        expect(b - r).toBeGreaterThan(12);
    });
});

describe('lerpHexOklab — gamma sanity', () => {
    it('red→green midpoint is bright, not the muddy #808000 of naive sRGB', () => {
        const { r, g, b } = rgb(lerpHexOklab('#ff0000', '#00ff00', 0.5));
        // naive sRGB gives r=g=128; gamma-correct interpolation lifts both.
        expect(r).toBeGreaterThan(150);
        expect(g).toBeGreaterThan(150);
        expect(b).toBeLessThan(60);
    });
});
