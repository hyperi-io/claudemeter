import { describe, it, expect, beforeEach } from 'vitest';
const vscode = require('vscode');
const { resolveColor, getColorMode } = require('../../src/colorResolver');

describe('colorResolver — three-layer precedence', () => {
    beforeEach(() => {
        vscode._resetConfigValues();
    });

    it('returns user hex when colors.<setting> is a valid 6-hex', () => {
        vscode._setConfigValues({ 'colors.rotLight': '#aabbcc' });

        const r = resolveColor('rotLight');
        expect(r.themeColor).toBe('#aabbcc');
        expect(r.hex).toBe('#aabbcc');
    });

    it('falls through to ThemeColor + colorMap fallback when no override', () => {
        const r = resolveColor('rotDeep');
        expect(r.themeColor).toBeInstanceOf(vscode.ThemeColor);
        expect(r.themeColor.id).toBe('claudemeter.rotDeep');
        expect(r.hex).toBe('#4279a1');
    });

    it('falls through when override is empty string', () => {
        vscode._setConfigValues({ 'colors.warning': '' });

        const r = resolveColor('warning');
        expect(r.themeColor).toBeInstanceOf(vscode.ThemeColor);
        expect(r.hex).toBe('#cca700');
    });

    it('falls through when override is malformed hex', () => {
        vscode._setConfigValues({ 'colors.error': 'not-a-hex' });

        const r = resolveColor('error');
        expect(r.themeColor).toBeInstanceOf(vscode.ThemeColor);
        expect(r.hex).toBe('#cc4540');
    });

    it("returns no-decoration shape for 'normal' tier", () => {
        const r = resolveColor('normal');
        expect(r.themeColor).toBeUndefined();
        expect(r.hex).toBeNull();
    });

    it('returns no-decoration shape for unknown tier name', () => {
        const r = resolveColor('madeUp');
        expect(r.themeColor).toBeUndefined();
        expect(r.hex).toBeNull();
    });

    it('happyHour tier resolves to Gruvbox green from colorMap', () => {
        const r = resolveColor('happyHour');
        expect(r.hex).toBe('#689d6a');
    });

    it('rotLight tier resolves to its fallback hex when no override', () => {
        const r = resolveColor('rotLight');
        expect(r.hex).toBe('#6ca0c4');
    });
});

describe('getColorMode — defensive coercion', () => {
    beforeEach(() => {
        vscode._resetConfigValues();
    });

    it("defaults to 'color' when unset", () => {
        expect(getColorMode()).toBe('color');
    });

    it("returns 'basic' when explicitly set", () => {
        vscode._setConfigValues({ 'statusBar.colorMode': 'basic' });

        expect(getColorMode()).toBe('basic');
    });

    it("coerces unknown values to 'color'", () => {
        vscode._setConfigValues({ 'statusBar.colorMode': 'rainbow' });

        expect(getColorMode()).toBe('color');
    });
});
