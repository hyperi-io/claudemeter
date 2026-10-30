// The raster primitives probed pixel by pixel on a small buffer.

import { describe, it, expect } from 'vitest';
const { createRaster, blend, fillRect, dashedLine, diamond } = require('../../src/raster');

const px = (r, x, y) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];
const alphaRow = (r, y) => Array.from({ length: r.width }, (_, x) => (px(r, x, y)[3] > 0 ? 1 : 0)).join('');

describe('blend and fillRect', () => {
    it('starts transparent and paints an opaque colour as it is', () => {
        const r = createRaster(4, 4);
        expect(px(r, 1, 1)).toEqual([0, 0, 0, 0]);
        fillRect(r, 1, 1, 2, 2, [10, 20, 30, 255]);
        expect(px(r, 1, 1)).toEqual([10, 20, 30, 255]);
        expect(px(r, 2, 2)).toEqual([10, 20, 30, 255]);
        expect(px(r, 3, 3)).toEqual([0, 0, 0, 0]);
    });

    it.each([
        ['half-alpha over transparent keeps the colour and the alpha', [0, 0, 0, 0], [200, 100, 50, 128], [200, 100, 50, 128]],
        ['opaque over anything replaces it', [9, 9, 9, 255], [1, 2, 3, 255], [1, 2, 3, 255]],
        ['zero alpha changes nothing', [9, 9, 9, 255], [1, 2, 3, 0], [9, 9, 9, 255]],
        ['half-alpha white over opaque black lands on mid grey', [0, 0, 0, 255], [255, 255, 255, 128], [128, 128, 128, 255]],
    ])('%s', (_name, under, over, expected) => {
        const r = createRaster(1, 1);
        r.data.set(under);
        blend(r, 0, 0, over);
        expect(px(r, 0, 0)).toEqual(expected);
    });

    it('clips to the buffer without throwing', () => {
        const r = createRaster(3, 3);
        fillRect(r, -2, -2, 4, 4, [1, 1, 1, 255]);
        fillRect(r, 2, 2, 10, 10, [2, 2, 2, 255]);
        blend(r, 99, 99, [3, 3, 3, 255]);
        expect(px(r, 0, 0)[3]).toBe(255);
        expect(px(r, 1, 1)[3]).toBe(255);
        expect(px(r, 2, 2)).toEqual([2, 2, 2, 255]);
        expect(px(r, 2, 0)[3]).toBe(0);
    });
});

describe('dashedLine', () => {
    it.each([
        ['dash 2 gap 2', { dash: 2, gap: 2 }, '11001100110011001100'],
        ['dash 3 gap 1', { dash: 3, gap: 1 }, '11101110111011101110'],
        ['dash 1 gap 4', { dash: 1, gap: 4 }, '10000100001000010000'],
    ])('draws a horizontal line with %s', (_name, style, pattern) => {
        const r = createRaster(20, 3);
        dashedLine(r, 0, 1.5, 19, 1.5, [0, 0, 0, 255], { ...style, thickness: 1 });
        expect(alphaRow(r, 1).slice(0, 20)).toBe(pattern);
        expect(alphaRow(r, 0)).toBe('0'.repeat(20));
    });

    it('draws a sloped line from end to end', () => {
        const r = createRaster(10, 10);
        dashedLine(r, 0, 0, 9, 9, [0, 0, 0, 255], { dash: 100, gap: 1 });
        expect(px(r, 0, 0)[3]).toBe(255);
        expect(px(r, 5, 5)[3]).toBe(255);
        expect(px(r, 9, 9)[3]).toBe(255);
        expect(px(r, 9, 0)[3]).toBe(0);
    });

    it('survives a zero-length line', () => {
        const r = createRaster(3, 3);
        dashedLine(r, 1, 1, 1, 1, [0, 0, 0, 255]);
        expect(px(r, 1, 1)[3]).toBe(255);
    });
});

describe('diamond', () => {
    it('fills the plus-shaped diamond of its radius and nothing outside', () => {
        const r = createRaster(7, 7);
        diamond(r, 3, 3, 2, [5, 5, 5, 255]);
        const rows = Array.from({ length: 7 }, (_, y) => alphaRow(r, y));
        expect(rows).toEqual(['0000000', '0001000', '0011100', '0111110', '0011100', '0001000', '0000000']);
    });
});
