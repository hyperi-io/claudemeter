// Project:   Claudemeter
// File:      raster.js
// Purpose:   Draw filled rectangles, dashed lines, diamonds and tiny labels into an RGBA pixel buffer.
// Language:  JavaScript (CommonJS)
//
// Colours are [r, g, b, a] with every channel 0-255. Drawing composites over what is already
// there with straight alpha, so a transparent buffer stays transparent where nothing is drawn.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

function createRaster(width, height) {
    return { width, height, data: new Uint8Array(width * height * 4) };
}

function blend(raster, x, y, color) {
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
    const at = (y * raster.width + x) * 4;
    const d = raster.data;
    const sa = color[3] / 255;
    const da = d[at + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    for (let k = 0; k < 3; k++) {
        d[at + k] = Math.round((color[k] * sa + d[at + k] * da * (1 - sa)) / oa);
    }
    d[at + 3] = Math.round(oa * 255);
}

function fillRect(raster, x, y, w, h, color) {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = Math.round(x + w);
    const y1 = Math.round(y + h);
    for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) blend(raster, px, py, color);
    }
}

// A line made of `dash` painted pixels then `gap` clear ones, `thickness` pixels wide.
function dashedLine(raster, x0, y0, x1, y1, color, { dash = 4, gap = 3, thickness = 1 } = {}) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(length));
    for (let i = 0; i <= steps; i++) {
        if (i % (dash + gap) >= dash) continue;
        const t = i / steps;
        fillRect(raster, x0 + (x1 - x0) * t - thickness / 2, y0 + (y1 - y0) * t - thickness / 2, thickness, thickness, color);
    }
}

function diamond(raster, cx, cy, radius, color) {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (Math.abs(dx) + Math.abs(dy) <= radius) blend(raster, Math.round(cx) + dx, Math.round(cy) + dy, color);
        }
    }
}

module.exports = { createRaster, blend, fillRect, dashedLine, diamond };
