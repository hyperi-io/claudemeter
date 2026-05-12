import { describe, it, expect, beforeEach } from 'vitest';
const vscode = require('vscode');
const { migrateLegacySettings } = require('../../src/tk/migrate');
const { PROFILES } = require('../../src/tk/profiles');

const makeLogger = () => {
    const lines = [];
    return { lines, appendLine: (s) => lines.push(s) };
};

describe('migrateLegacySettings — happy paths', () => {
    beforeEach(() => vscode._resetConfigValues());

    it('migrates legacy 70% warning on 1M window for max-20x profile', async () => {
        vscode._setConfigInspectValues('thresholds.tokens.warning', { globalValue: 70 });
        const logger = makeLogger();
        const profile = PROFILES['max-20x'];

        const result = await migrateLegacySettings(vscode, 1_000_000, profile, logger);

        // 70% of 1M = 700K used → runway = 1M - 700K - 33K (compactReserve) = 267K
        expect(result.migrated).toEqual(['thresholds.tokens.warning']);
        const writes = vscode._getWrittenValues();
        const writeNew = writes.find(w => w.key === 'thresholds.tokens.profiles.max-20x.thresholds.warningRunwayTokens');
        expect(writeNew?.value).toBe(267_000);
        expect(writeNew?.target).toBe(vscode.ConfigurationTarget.Global);

        const writeDelete = writes.find(w => w.key === 'thresholds.tokens.warning' && w.value === undefined);
        expect(writeDelete).toBeDefined();
    });

    it('migrates legacy 80% error on 200K window for pro profile', async () => {
        vscode._setConfigInspectValues('thresholds.tokens.error', { globalValue: 80 });
        const logger = makeLogger();
        const profile = PROFILES.pro;

        const result = await migrateLegacySettings(vscode, 200_000, profile, logger);

        // 80% of 200K = 160K used → runway = 200K - 160K - 33K = 7K
        expect(result.migrated).toEqual(['thresholds.tokens.error']);
        const writes = vscode._getWrittenValues();
        const writeNew = writes.find(w => w.key === 'thresholds.tokens.profiles.pro.thresholds.errorRunwayTokens');
        expect(writeNew?.value).toBe(7_000);
    });

    it('migrates both legacy keys when both are set', async () => {
        vscode._setConfigInspectValues('thresholds.tokens.warning', { globalValue: 70 });
        vscode._setConfigInspectValues('thresholds.tokens.error',   { globalValue: 80 });
        const logger = makeLogger();

        const result = await migrateLegacySettings(vscode, 1_000_000, PROFILES['max-20x'], logger);

        expect(result.migrated.sort()).toEqual([
            'thresholds.tokens.error',
            'thresholds.tokens.warning',
        ]);
    });
});

describe('migrateLegacySettings — idempotency', () => {
    beforeEach(() => vscode._resetConfigValues());

    it('does not overwrite when new key already set (idempotency check)', async () => {
        vscode._setConfigInspectValues('thresholds.tokens.warning', { globalValue: 70 });
        vscode._setConfigInspectValues(
            'thresholds.tokens.profiles.max-20x.thresholds.warningRunwayTokens',
            { globalValue: 50_000 }  // already user-customised
        );
        const logger = makeLogger();

        const result = await migrateLegacySettings(vscode, 1_000_000, PROFILES['max-20x'], logger);

        expect(result.migrated).toEqual([]);
        expect(result.skipped).toEqual(['thresholds.tokens.warning']);
        // No writes recorded — neither write nor delete
        expect(vscode._getWrittenValues()).toEqual([]);
    });

    it('repeat run after successful migration is a no-op (legacy key gone)', async () => {
        // First run: migrate
        vscode._setConfigInspectValues('thresholds.tokens.warning', { globalValue: 70 });
        await migrateLegacySettings(vscode, 1_000_000, PROFILES['max-20x'], makeLogger());

        // Simulate second run — legacy key has been deleted (mock cleared via update(undefined))
        vscode._resetWrittenValues();
        // After delete, inspect should NOT have the legacy key any more
        vscode._setConfigInspectValues('thresholds.tokens.warning', { globalValue: undefined });
        // And the new key has been recorded
        vscode._setConfigInspectValues(
            'thresholds.tokens.profiles.max-20x.thresholds.warningRunwayTokens',
            { globalValue: 267_000 }
        );

        const result = await migrateLegacySettings(vscode, 1_000_000, PROFILES['max-20x'], makeLogger());
        expect(result.migrated).toEqual([]);
        expect(vscode._getWrittenValues()).toEqual([]);
    });
});

describe('migrateLegacySettings — defensive paths', () => {
    beforeEach(() => vscode._resetConfigValues());

    it('skips when no profile detected', async () => {
        const logger = makeLogger();
        const result = await migrateLegacySettings(vscode, 1_000_000, null, logger);
        expect(result.migrated).toEqual([]);
        expect(logger.lines.some(l => l.includes('skipping'))).toBe(true);
    });

    it('skips when no contextWindow', async () => {
        const logger = makeLogger();
        const result = await migrateLegacySettings(vscode, 0, PROFILES.pro, logger);
        expect(result.migrated).toEqual([]);
    });

    it('skips legacy key not user-set at global scope', async () => {
        // Legacy key is at default value (no globalValue)
        vscode._setConfigInspectValues('thresholds.tokens.warning', { defaultValue: 65 });
        const logger = makeLogger();
        const result = await migrateLegacySettings(vscode, 1_000_000, PROFILES['max-20x'], logger);
        expect(result.migrated).toEqual([]);
    });

    it('skips when computed runway would be <=0 on extremely tight thresholds', async () => {
        // 99% on 200K = 198K used → runway = 200K - 198K - 33K = -31K (negative)
        vscode._setConfigInspectValues('thresholds.tokens.warning', { globalValue: 99 });
        const logger = makeLogger();
        const result = await migrateLegacySettings(vscode, 200_000, PROFILES.pro, logger);
        expect(result.migrated).toEqual([]);
        expect(result.skipped).toEqual(['thresholds.tokens.warning']);
        expect(logger.lines.some(l => l.includes('runway<=0'))).toBe(true);
    });

    it('logs but continues when workspace-scoped value also exists', async () => {
        vscode._setConfigInspectValues('thresholds.tokens.warning', {
            globalValue: 70,
            workspaceValue: 75,  // user has a workspace override too
        });
        const logger = makeLogger();
        const result = await migrateLegacySettings(vscode, 1_000_000, PROFILES['max-20x'], logger);
        expect(result.migrated).toEqual(['thresholds.tokens.warning']);
        expect(logger.lines.some(l => l.includes('workspace scope'))).toBe(true);
    });
});

describe('migrateLegacySettings — return shape', () => {
    beforeEach(() => vscode._resetConfigValues());

    it('returns {migrated, skipped} object', async () => {
        vscode._setConfigInspectValues('thresholds.tokens.warning', { globalValue: 70 });
        const result = await migrateLegacySettings(vscode, 1_000_000, PROFILES['max-20x'], makeLogger());
        expect(result).toEqual({ migrated: ['thresholds.tokens.warning'], skipped: [] });
    });
});
