//  Project:      Claudemeter
//  File:         src/tk/gradient.js
//  Purpose:      Reliable colour interpolation for the rot gauge, done in
//                OKLab space.
//
//                Why OKLab and not plain RGB or HSL: a white->blue ramp is
//                the pathological case for both naive approaches.
//                  - sRGB channel-lerp passes through a muddy, too-dark
//                    midpoint because the gamma curve is never undone.
//                  - HSL/HSV lerp injects a spurious pink band, since
//                    white has no defined hue and the hue wheel takes the
//                    wrong arc.
//                OKLab is perceptually uniform: equal t-steps look like
//                equal visual steps, with no grey or pink artefacts. For a
//                light->dark same-hue blue ramp it is the gold standard.
//
//                Rectangular OKLab (not polar OKLCH) is deliberate: both
//                endpoints are already blue, so there is no hue-wrap
//                ambiguity to resolve and the a/b axes interpolate cleanly.
//
//                Pure JS - no vscode dependency, no deps, fully testable.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

// --- sRGB <-> linear-light (gamma decode/encode) ---

function srgbChannelToLinear(c8) {
    const c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearChannelToSrgb(c) {
    const clamped = Math.max(0, Math.min(1, c));
    const v = clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
    return Math.round(v * 255);
}

// --- linear-light RGB <-> OKLab (Björn Ottosson's reference matrices) ---

function linearRgbToOklab(r, g, b) {
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    const l_ = Math.cbrt(l);
    const m_ = Math.cbrt(m);
    const s_ = Math.cbrt(s);

    return [
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ];
}

function oklabToLinearRgb(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    return [
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
}

// --- hex parsing / formatting ---

// Accepts '#rrggbb' or 'rrggbb'. Trusts internal callers to pass a valid
// 6-digit hex (colorMap values + regex-validated user overrides); returns
// null only for clearly malformed input so callers can fall back.
function hexToRgb8(hex) {
    if (typeof hex !== 'string') return null;
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb8ToHex(r, g, b) {
    const h = (v) => v.toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Interpolate between two hex colours in OKLab space.
 *
 * @param {string} hexA - start colour ('#rrggbb'), returned at t<=0
 * @param {string} hexB - end colour ('#rrggbb'), returned at t>=1
 * @param {number} t    - position in [0,1] (clamped)
 * @returns {string} interpolated '#rrggbb', or hexA unchanged if either
 *                   input fails to parse
 */
function lerpHexOklab(hexA, hexB, t) {
    const a = hexToRgb8(hexA);
    const b = hexToRgb8(hexB);
    if (!a || !b) return hexA;

    const clampedT = t <= 0 ? 0 : t >= 1 ? 1 : t;

    const labA = linearRgbToOklab(
        srgbChannelToLinear(a[0]),
        srgbChannelToLinear(a[1]),
        srgbChannelToLinear(a[2]),
    );
    const labB = linearRgbToOklab(
        srgbChannelToLinear(b[0]),
        srgbChannelToLinear(b[1]),
        srgbChannelToLinear(b[2]),
    );

    const L = labA[0] + (labB[0] - labA[0]) * clampedT;
    const aa = labA[1] + (labB[1] - labA[1]) * clampedT;
    const bb = labA[2] + (labB[2] - labA[2]) * clampedT;

    const [lr, lg, lb] = oklabToLinearRgb(L, aa, bb);
    return rgb8ToHex(
        linearChannelToSrgb(lr),
        linearChannelToSrgb(lg),
        linearChannelToSrgb(lb),
    );
}

module.exports = { lerpHexOklab };
