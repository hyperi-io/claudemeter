// The PNG encoder at byte level: signature, header, CRCs and a zlib round trip of the pixels.

import { describe, it, expect } from 'vitest';
const { encodePng, crc32 } = require('../../src/png');
const { decodePng } = require('../common/pngDecode');

describe('crc32', () => {
    it.each([
        ['the standard check string', '123456789', 0xcbf43926],
        ['empty input', '', 0],
        ['one byte', 'a', 0xe8b7be43],
    ])('%s', (_name, text, expected) => {
        expect(crc32(Buffer.from(text))).toBe(expected);
    });
});

describe('encodePng', () => {
    const pixels = (w, h, fn) => {
        const data = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
        return data;
    };

    it('writes the signature, an RGBA 8-bit IHDR with the right size, and IEND last', () => {
        const png = encodePng(7, 3, pixels(7, 3, () => [1, 2, 3, 4]));
        const decoded = decodePng(png);
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect([decoded.width, decoded.height]).toEqual([7, 3]);
        expect([...decoded.header.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
        expect(decoded.types).toEqual(['IHDR', 'IDAT', 'IEND']);
    });

    it('round-trips every pixel through zlib, alpha included', () => {
        const source = pixels(9, 5, (x, y) => [x * 20, y * 40, (x + y) * 10, x === y ? 0 : 255 - x]);
        const decoded = decodePng(encodePng(9, 5, source));
        expect(new Uint8Array(decoded.pixels)).toEqual(source);
        expect(decoded.at(3, 3)).toEqual([60, 120, 60, 0]);
    });

    it('fails every CRC check when a byte is flipped', () => {
        const png = Buffer.from(encodePng(4, 4, pixels(4, 4, () => [9, 9, 9, 255])));
        png[png.length - 20] ^= 0xff;
        expect(() => decodePng(png)).toThrow(/bad CRC/);
    });

    it.each([
        ['too few bytes', 4, 4, 10],
        ['too many bytes', 2, 2, 17],
        ['an empty buffer for a real size', 3, 3, 0],
    ])('rejects %s', (_name, w, h, length) => {
        expect(() => encodePng(w, h, new Uint8Array(length))).toThrow(RangeError);
    });

    it('compresses a flat image well below its raw size', () => {
        const png = encodePng(480, 256, pixels(480, 256, () => [0, 0, 0, 0]));
        expect(png.length).toBeLessThan(1000);
    });
});
