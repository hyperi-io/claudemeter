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
const { TIER_COLORS } = require('./tk/colorMap');

/**
 * Resolve the colour for a Tk-tier name.
 *
 * @param {'normal'|'rotLight'|'rotDeep'|'warning'|'error'|'happyHour'|string} tier
 * @returns {{themeColor: string|vscode.ThemeColor|undefined, hex: string|null}}
 */
function resolveColor(tier) {
    const entry = TIER_COLORS[tier];
    if (!entry) {
        // 'normal' tier or unknown - no decoration
        return { themeColor: undefined, hex: null };
    }
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const customHex = config.get(entry.setting, '');
    if (typeof customHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(customHex)) {
        return { themeColor: customHex, hex: customHex };
    }
    return {
        themeColor: new vscode.ThemeColor(entry.theme),
        hex: entry.hex,
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
    getColorMode,
};
