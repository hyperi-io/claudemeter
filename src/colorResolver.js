// Project:   Claudemeter
// File:      src/colorResolver.js
// Purpose:   Three-layer colour resolution for Tk gauge tiers.
//
//            Layers (highest precedence first):
//              1. claudemeter.colors.<settingKey> - user-set hex (regex-validated)
//              2. vscode.ThemeColor(themeId) - picks up workbench.colorCustomizations
//              3. colorMap fallback hex
//
//            Returns {themeColor, hex} so callers can pick the right
//            field for their context: StatusBarItem.color accepts string
//            OR ThemeColor.
//
//            'normal' tier returns {themeColor: undefined, hex: null}.
//            Unknown tier name returns the same no-decoration shape.
//
//            ALL tier hex values come from src/tk/colorMap.js - this
//            module holds NO hex constants. Single source of truth.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const { CONFIG_NAMESPACE } = require('./utils');
const { TIER_COLORS, ROT_GRADIENT } = require('./tk/colorMap');

/**
 * Resolve the colour for a Tk-tier name.
 *
 * @param {'normal'|'rotLight'|'rotDeep'|'warning'|'error'|string} tier
 * @returns {{themeColor: string|vscode.ThemeColor|undefined, hex: string|null}}
 */
function resolveColor(tier) {
    const entry = TIER_COLORS[tier];
    if (!entry) {
        // 'normal' tier or unknown - no decoration
        return { themeColor: undefined, hex: null };
    }
    const customHex = customTierHex(entry);
    if (customHex) {
        return { themeColor: customHex, hex: customHex };
    }
    return {
        themeColor: new vscode.ThemeColor(entry.theme),
        hex: entry.hex,
    };
}

// The user's claudemeter.colors.<setting> hex for a tier, or null.
function customTierHex(entry) {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const customHex = config.get(entry.setting, '');
    return typeof customHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(customHex) ? customHex : null;
}

/**
 * Anchors of the continuous Tk rot gradient. colors.rotLight sets the start
 * and colors.rotDeep the end, each falling back to ROT_GRADIENT. The ramp
 * is a hex interpolation, so the theme colours (layer 2) cannot take part:
 * an unset anchor keeps the built-in hex, not the theme's.
 *
 * @returns {{start: string, end: string}}
 */
function resolveRotGradient() {
    return {
        start: customTierHex(TIER_COLORS.rotLight) || ROT_GRADIENT.start,
        end: customTierHex(TIER_COLORS.rotDeep) || ROT_GRADIENT.end,
    };
}

/**
 * Read claudemeter.statusBar.colorMode. Defensive: any value other
 * than 'basic' is coerced to 'color'.
 *
 * @returns {'color'|'basic'}
 */
function getColorMode() {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const v = config.get('statusBar.colorMode', 'color');
    return v === 'basic' ? 'basic' : 'color';
}

module.exports = {
    resolveColor,
    resolveRotGradient,
    getColorMode,
};
