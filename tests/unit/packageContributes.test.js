// Contract tests over package.json `contributes`: what VS Code lets a
// workspace override, which settings are live, and which colours exist.

import { describe, it, expect } from 'vitest';
const pkg = require('../../package.json');

const settings = pkg.contributes.configuration.properties;
const colourIds = pkg.contributes.colors.map((c) => c.id);

describe('debug-log settings', () => {
    it('cannot be set by a workspace, so a cloned repo cannot aim the log at a user file', () => {
        for (const key of ['claudemeter.debug', 'claudemeter.debugLogFile', 'claudemeter.debugLogMaxSizeKB']) {
            expect(settings[key].scope, key).toBe('machine');
        }
    });

    it('does not promise an auto-populated path', () => {
        expect(settings['claudemeter.debugLogFile'].description).not.toMatch(/auto-populated/i);
    });
});

describe('legacy Tk percent thresholds', () => {
    it('are marked deprecated but still declared, so migration can find them', () => {
        for (const key of ['claudemeter.thresholds.tokens.warning', 'claudemeter.thresholds.tokens.error']) {
            expect(settings[key], key).toBeDefined();
            expect(settings[key].deprecationMessage, key).toMatch(/thresholds\.tokens\.profiles/);
            expect(settings[key].markdownDeprecationMessage, key).toMatch(/thresholds\.tokens\.profiles/);
        }
    });
});

describe('colour settings nothing reads', () => {
    it('drops the happy-hour colour setting and its theme colour', () => {
        expect(settings['claudemeter.colors.happyHour']).toBeUndefined();
        expect(colourIds).not.toContain('claudemeter.happyHourGreen');
    });

    it('describes colorMode without features that do not exist', () => {
        const text = settings['claudemeter.statusBar.colorMode'].markdownDescription;
        expect(text).not.toMatch(/happy-hour/i);
        expect(text).not.toContain('●');
        // eslint-disable-next-line no-control-regex
        expect(text).toMatch(/^[\x00-\x7F]*$/);
    });
});
