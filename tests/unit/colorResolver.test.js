import { describe, it, expect, beforeEach } from 'vitest';
const vscode = require('vscode');
const { resolveColor, resolveRotGradient, getColorMode } = require('../../src/colorResolver');

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

describe('resolveRotGradient — rot ramp anchors', () => {
    beforeEach(() => {
        vscode._resetConfigValues();
    });

    it('defaults to the built-in near-white to deep-navy ramp', () => {
        expect(resolveRotGradient()).toEqual({ start: '#eef5fc', end: '#163a63' });
    });

    it('takes the start from colors.rotLight and the end from colors.rotDeep', () => {
        vscode._setConfigValues({ 'colors.rotLight': '#ffffff', 'colors.rotDeep': '#c4a7ff' });

        expect(resolveRotGradient()).toEqual({ start: '#ffffff', end: '#c4a7ff' });
    });

    it('overrides one anchor and keeps the built-in for the other', () => {
        vscode._setConfigValues({ 'colors.rotDeep': '#8fd3ff' });

        expect(resolveRotGradient()).toEqual({ start: '#eef5fc', end: '#8fd3ff' });
    });

    it('ignores a malformed override', () => {
        vscode._setConfigValues({ 'colors.rotDeep': 'navy' });

        expect(resolveRotGradient().end).toBe('#163a63');
    });
});
