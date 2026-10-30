// Decodes the PNGs src/png.js writes: 8-bit RGBA, no interlace, filter 0. Checks every chunk CRC on the way.

const zlib = require('zlib');
const { crc32 } = require('../../src/png');

const SIGNATURE = '89504e470d0a1a0a';

function decodePng(buf) {
    if (buf.subarray(0, 8).toString('hex') !== SIGNATURE) throw new Error('bad signature');
    const chunks = [];
    for (let at = 8; at < buf.length;) {
        const length = buf.readUInt32BE(at);
        const type = buf.toString('latin1', at + 4, at + 8);
        const body = buf.subarray(at + 8, at + 8 + length);
        const stored = buf.readUInt32BE(at + 8 + length);
        if (crc32(buf.subarray(at + 4, at + 8 + length)) !== stored) throw new Error(`bad CRC in ${type}`);
        chunks.push({ type, body });
        at += 12 + length;
    }
    const header = chunks[0].body;
    const width = header.readUInt32BE(0);
    const height = header.readUInt32BE(4);
    const raw = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.body)));
    const stride = width * 4;
    const pixels = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
        if (raw[y * (stride + 1)] !== 0) throw new Error(`row ${y} uses filter ${raw[y * (stride + 1)]}`);
        raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    }
    return {
        width,
        height,
        header,
        types: chunks.map((c) => c.type),
        pixels,
        at: (x, y) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)],
    };
}

module.exports = { decodePng };
