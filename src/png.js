// Project:   Claudemeter
// File:      png.js
// Purpose:   Encode an 8-bit RGBA pixel buffer as a PNG, using only node:zlib.
// Language:  JavaScript (CommonJS)
//
// One IDAT of unfiltered scanlines, no interlace, no ancillary chunks. The extension host
// may predate zlib.crc32, so the CRC table is local.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buf) {
    let c = 0xffffffff;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba - width * height * 4 bytes, straight (not premultiplied) alpha
 * @returns {Buffer} the PNG file
 */
function encodePng(width, height, rgba) {
    if (rgba.length !== width * height * 4) {
        throw new RangeError(`encodePng: ${rgba.length} bytes is not ${width}x${height} RGBA`);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);

    const stride = width * 4;
    const raw = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) {
        raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

module.exports = { encodePng, crc32 };
