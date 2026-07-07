//  Project:      Claudemeter
//  File:         src/tk/colorMap.js
//  Purpose:      SINGLE SOURCE OF TRUTH for Tk-tier colours. Maps each tier
//                to its theme-color ID (used by status bar text), its
//                claudemeter.colors.* setting key (custom hex override), and
//                a fallback hex (used when ThemeColor isn't applicable).
//
//                src/colorResolver.js reads TIER_COLORS (status-bar text
//                colour) and src/statusBar.js reads ROT_GRADIENT directly
//                for the continuous rot ramp. No hex constants live
//                anywhere else.
//
//                'normal' maps to null - colorResolver treats null as
//                "no decoration, default text colour".
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const TIER_COLORS = Object.freeze({
    rotLight: Object.freeze({
        theme:   'claudemeter.rotLight',
        setting: 'colors.rotLight',
        hex:     '#6ca0c4',
    }),
    rotDeep: Object.freeze({
        theme:   'claudemeter.rotDeep',
        setting: 'colors.rotDeep',
        hex:     '#4279a1',
    }),
    warning: Object.freeze({
        theme:   'charts.yellow',
        setting: 'colors.warning',
        hex:     '#cca700',
    }),
    error: Object.freeze({
        theme:   'claudemeter.outageRed',
        setting: 'colors.error',
        hex:     '#cc4540',
    }),
    happyHour: Object.freeze({
        theme:   'claudemeter.happyHourGreen',
        setting: 'colors.happyHour',
        hex:     '#689d6a',
    }),
    normal: null,
});

// Anchors for the continuous rot gauge gradient (interpolated in OKLab by
// src/tk/gradient.js). The gauge ramps from `start` at the rot floor
// (~400K) to `end` just before the yellow threshold, replacing the two
// discrete rotLight/rotDeep swatches above for the multi-panel Tk colour.
// rotLight/rotDeep remain in use for compact mode and tier-snap testing.
const ROT_GRADIENT = Object.freeze({
    start: '#eef5fc',   // near-white blue (rot floor)
    end:   '#163a63',   // deep navy (pre-yellow)
});

module.exports = { TIER_COLORS, ROT_GRADIENT };
