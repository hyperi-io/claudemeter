//  Project:      Claudemeter
//  File:         src/tk/colorMap.js
//  Purpose:      SINGLE SOURCE OF TRUTH for Tk-tier colours. Maps each tier
//                to its theme-color ID (used by status bar text), its
//                claudemeter.colors.* setting key (custom hex override), and
//                a fallback hex (used by tooltip HTML inline
//                <span style="color:HEX"> when ThemeColor isn't applicable).
//
//                Both src/colorResolver.js and src/tooltipComposer.js read
//                from this map. No hex constants live anywhere else.
//
//                'normal' maps to null — colorResolver treats null as
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

module.exports = { TIER_COLORS };
