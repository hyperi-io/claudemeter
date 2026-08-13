// Tests for the Nopilot group registry and its applied-state predicates.
// The settings reader is a plain map lookup here - the production reader is
// vscode's configuration API, which these modules never import.

import { describe, it, expect, beforeEach } from 'vitest';
const vscode = require('vscode');
const { GROUPS, WRITE_LAST, coreGroup, allSettingKeys } = require('../../src/declutter/groups');
const {
    pendingSettings,
    isApplied,
    pendingGroups,
    isCoreApplied,
    globalScopeReader,
    isDeclared,
} = require('../../src/declutter/state');
const fs = require('fs');
const path = require('path');
const {
    applyWrites,
    writeOrder,
    splitDeferred,
    explicitOverwrites,
    undoLastApply,
    PRIORS_KEY,
} = require('../../src/commands/declutter');

// Every group picked, with every one of its settings pending.
const allPicks = () => GROUPS.map((group) => ({
    group,
    pending: Object.keys(group.settings),
}));

// Make the build register every key, so isDeclared passes.
const declareAll = () => {
    for (const key of allSettingKeys()) {
        vscode._setConfigInspectValues(key, { defaultValue: 'registered' });
    }
};

// A reader over a plain object, matching vscode's undefined-for-unset shape.
const reader = (values) => (key) => values[key];

// Every setting of every group already at its target value.
const allApplied = () => {
    const values = {};
    for (const group of GROUPS) Object.assign(values, group.settings);
    return values;
};

describe('GROUPS registry', () => {
    it('is frozen all the way down', () => {
        expect(Object.isFrozen(GROUPS)).toBe(true);
        for (const group of GROUPS) {
            expect(Object.isFrozen(group)).toBe(true);
            expect(Object.isFrozen(group.settings)).toBe(true);
        }
    });

    it('gives every group an id, a label and at least one setting', () => {
        for (const group of GROUPS) {
            expect(typeof group.id).toBe('string');
            expect(group.id.length).toBeGreaterThan(0);
            expect(typeof group.label).toBe('string');
            expect(Object.keys(group.settings).length).toBeGreaterThan(0);
        }
    });

    it('uses unique group ids', () => {
        const ids = GROUPS.map((g) => g.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('carries only primitive target values', () => {
        // state.js compares with strict equality - an object target would
        // silently never read as applied.
        for (const group of GROUPS) {
            for (const value of Object.values(group.settings)) {
                expect(['boolean', 'string', 'number']).toContain(typeof value);
            }
        }
    });

    it('names exactly one core group, and it is the Copilot one', () => {
        expect(GROUPS.filter((g) => g.core)).toHaveLength(1);
        expect(coreGroup().id).toBe('copilot');
    });

    it('gates the Copilot group on the master switch', () => {
        expect(coreGroup().settings['chat.disableAIFeatures']).toBe(true);
    });

    it('states the agent-host trade-off on the Copilot group', () => {
        // Without this the pick silently breaks anyone running Claude in
        // VS Code's built-in chat view.
        expect(coreGroup().note).toMatch(/agent host/i);
    });

    it('ticks every group by default', () => {
        for (const group of GROUPS) {
            expect(group.picked).toBe(true);
        }
    });

    it('touches no setting outside VS Code core', () => {
        // Scope is Microsoft's AI push and telemetry. A third party's setting
        // is not that, however tempting - claudeCode.preferredLocation was
        // dropped for exactly this reason.
        for (const key of allSettingKeys()) {
            expect(key).toMatch(/^(chat|editor|workbench|telemetry|extensions|update|terminal)\./);
        }
    });

    it('does not carry a setting id the running build dropped', () => {
        // chat.commandCenter.enabled is recommended by every guide and does
        // not exist in current VS Code.
        expect(allSettingKeys()).not.toContain('chat.commandCenter.enabled');
    });

    it('lists every key once across all groups', () => {
        const keys = allSettingKeys();
        expect(new Set(keys).size).toBe(keys.length);
        const total = GROUPS.reduce((n, g) => n + Object.keys(g.settings).length, 0);
        expect(keys).toHaveLength(total);
    });
});

describe('pendingSettings', () => {
    it('returns every key when nothing is set', () => {
        const core = coreGroup();
        const pending = pendingSettings(core, reader({}));
        expect(pending).toEqual(Object.keys(core.settings));
    });

    it('returns nothing when all are already at target', () => {
        const core = coreGroup();
        expect(pendingSettings(core, reader(allApplied()))).toEqual([]);
    });

    it('returns only the keys that differ', () => {
        const core = coreGroup();
        const values = { ...allApplied(), 'chat.agent.enabled': true };
        expect(pendingSettings(core, reader(values))).toEqual(['chat.agent.enabled']);
    });

    it('treats a wrong-but-set value as pending, not applied', () => {
        const group = GROUPS.find((g) => g.id === 'telemetry');
        const values = { ...allApplied(), 'telemetry.telemetryLevel': 'error' };
        expect(pendingSettings(group, reader(values))).toContain('telemetry.telemetryLevel');
    });

    it('degrades to empty on a missing group rather than throwing', () => {
        expect(pendingSettings(null, reader({}))).toEqual([]);
        expect(pendingSettings({}, reader({}))).toEqual([]);
    });
});

describe('isApplied', () => {
    it('is false on an untouched install', () => {
        expect(isApplied(coreGroup(), reader({}))).toBe(false);
    });

    it('is true once every setting matches', () => {
        expect(isApplied(coreGroup(), reader(allApplied()))).toBe(true);
    });

    it('is false when one setting of many is missing', () => {
        const values = allApplied();
        delete values['editor.inlineSuggest.enabled'];
        expect(isApplied(coreGroup(), reader(values))).toBe(false);
    });
});

describe('pendingGroups', () => {
    it('returns all groups on an untouched install', () => {
        expect(pendingGroups(reader({}))).toHaveLength(GROUPS.length);
    });

    it('returns none when everything is applied', () => {
        expect(pendingGroups(reader(allApplied()))).toEqual([]);
    });

    it('drops only the groups that are fully applied', () => {
        const nags = GROUPS.find((g) => g.id === 'nags');
        const ids = pendingGroups(reader({ ...nags.settings })).map((g) => g.id);
        expect(ids).not.toContain('nags');
        expect(ids).toContain('copilot');
    });

    it('preserves registry order', () => {
        const ids = pendingGroups(reader({})).map((g) => g.id);
        expect(ids).toEqual(GROUPS.map((g) => g.id));
    });
});

describe('isCoreApplied - the tooltip gate', () => {
    it('is false on an untouched install, so the offer shows', () => {
        expect(isCoreApplied(reader({}))).toBe(false);
    });

    it('is true once the Copilot group is applied, so the offer stops', () => {
        expect(isCoreApplied(reader({ ...coreGroup().settings }))).toBe(true);
    });

    it('is true on the master switch alone', () => {
        // Gating on all six would resurrect the offer permanently: the group
        // includes provider-agnostic keys a user may legitimately turn back on.
        expect(isCoreApplied(reader({ 'chat.disableAIFeatures': true }))).toBe(true);
    });

    it('stays false when a sibling is set but the master switch is not', () => {
        expect(isCoreApplied(reader({ 'chat.agent.enabled': false }))).toBe(false);
    });

    it('ignores the other groups', () => {
        const nags = GROUPS.find((g) => g.id === 'nags');
        expect(isCoreApplied(reader({ ...nags.settings }))).toBe(false);
    });
});

describe('WRITE_LAST ordering', () => {
    it('defers the setting that restarts the extension host', () => {
        // Writing chat.disableAIFeatures flips builtin extension enablement,
        // so VS Code tears down the host and kills any write still queued.
        expect(WRITE_LAST).toContain('chat.disableAIFeatures');
    });

    it('names only keys that exist in the registry', () => {
        for (const key of WRITE_LAST) {
            expect(allSettingKeys()).toContain(key);
        }
    });

    it('sorts the deferred key last whatever order the picks arrive in', () => {
        const picks = allPicks();
        const forward = writeOrder(picks).map((w) => w.key);
        const reversed = writeOrder(picks.slice().reverse()).map((w) => w.key);
        expect(forward[forward.length - 1]).toBe('chat.disableAIFeatures');
        expect(reversed[reversed.length - 1]).toBe('chat.disableAIFeatures');
    });

    it('defers it even when the copilot group is the only pick', () => {
        const only = allPicks().filter((p) => p.group.id === 'copilot');
        const keys = writeOrder(only).map((w) => w.key);
        expect(keys[keys.length - 1]).toBe('chat.disableAIFeatures');
    });

    it('splits the deferred key out so the report can precede the teardown', () => {
        const { immediate, deferred } = splitDeferred(writeOrder(allPicks()));
        expect(deferred.map((w) => w.key)).toEqual(['chat.disableAIFeatures']);
        expect(immediate.map((w) => w.key)).not.toContain('chat.disableAIFeatures');
        expect(immediate).toHaveLength(allSettingKeys().length - 1);
    });
});

describe('applyWrites - the actual write path', () => {
    beforeEach(() => {
        vscode._resetConfigValues();
        declareAll();
    });

    it('writes every key at Global scope, deferred one last', async () => {
        const config = vscode.workspace.getConfiguration();
        const { written } = await applyWrites(config, writeOrder(allPicks()));
        const writes = vscode._getWrittenValues();
        expect(writes).toHaveLength(allSettingKeys().length);
        for (const w of writes) expect(w.target).toBe(vscode.ConfigurationTarget.Global);
        expect(written[written.length - 1]).toBe('chat.disableAIFeatures');
    });

    it('skips a key the build does not register, and never writes it', async () => {
        const config = vscode.workspace.getConfiguration();
        // A key Microsoft renamed away has no defaultValue.
        vscode._setConfigInspectValues('chat.agent.enabled', { defaultValue: undefined });
        const { written, skipped } = await applyWrites(config, writeOrder(allPicks()));
        expect(skipped).toEqual(['chat.agent.enabled']);
        expect(written).not.toContain('chat.agent.enabled');
        const keys = vscode._getWrittenValues().map((w) => w.key);
        expect(keys).not.toContain('chat.agent.enabled');
    });

    it('reports a key a narrower scope overrides instead of counting it written', async () => {
        const config = vscode.workspace.getConfiguration();
        // Workspace pins it away from target, so the Global write cannot win.
        vscode._setConfigInspectValues('workbench.tips.enabled', {
            defaultValue: true,
            workspaceValue: true,
        });
        const nags = GROUPS.find((g) => g.id === 'nags');
        const writes = writeOrder([{ group: nags, pending: Object.keys(nags.settings) }]);
        const { written, shadowed } = await applyWrites(config, writes);
        expect(shadowed).toEqual(['workbench.tips.enabled']);
        expect(written).not.toContain('workbench.tips.enabled');
    });
});

describe('isDeclared', () => {
    it('rejects a key with no defaultValue, since inspect always returns a record', () => {
        const config = vscode.workspace.getConfiguration();
        expect(isDeclared(config, 'chat.thisWasRenamedAway')).toBe(false);
    });

    it('accepts a key the build registers', () => {
        vscode._setConfigInspectValues('chat.agent.enabled', { defaultValue: true });
        const config = vscode.workspace.getConfiguration();
        expect(isDeclared(config, 'chat.agent.enabled')).toBe(true);
    });
});

describe('globalScopeReader', () => {
    it('reads our own scope, not a narrower one', () => {
        vscode._resetConfigValues();
        vscode._setConfigInspectValues('workbench.tips.enabled', {
            defaultValue: true,
            globalValue: false,
            workspaceValue: true,
        });
        const read = globalScopeReader(vscode.workspace.getConfiguration());
        expect(read('workbench.tips.enabled')).toBe(false);
    });

    it('falls back to the default when we have written nothing', () => {
        vscode._resetConfigValues();
        vscode._setConfigInspectValues('workbench.tips.enabled', { defaultValue: true });
        const read = globalScopeReader(vscode.workspace.getConfiguration());
        expect(read('workbench.tips.enabled')).toBe(true);
    });
});

describe('explicitOverwrites - what the confirm must disclose', () => {
    beforeEach(() => {
        vscode._resetConfigValues();
        declareAll();
    });

    it('names only keys the user had already set at their own scope', () => {
        vscode._setConfigInspectValues('workbench.tips.enabled', {
            defaultValue: true,
            globalValue: true,
        });
        const config = vscode.workspace.getConfiguration();
        const writes = writeOrder(allPicks());
        expect(explicitOverwrites(config, writes)).toEqual(['workbench.tips.enabled']);
    });

    it('is empty when nothing was set by the user', () => {
        const config = vscode.workspace.getConfiguration();
        expect(explicitOverwrites(config, writeOrder(allPicks()))).toEqual([]);
    });
});

describe('undoLastApply', () => {
    const fakeContext = (priors) => {
        const store = { [PRIORS_KEY]: priors };
        return {
            globalState: {
                get: (k) => store[k],
                update: async (k, v) => { store[k] = v; },
            },
            _store: store,
        };
    };

    beforeEach(() => {
        vscode._resetConfigValues();
        declareAll();
    });

    it('restores each key to its prior value', async () => {
        const context = fakeContext({ 'workbench.tips.enabled': true });
        await undoLastApply(context);
        const writes = vscode._getWrittenValues();
        expect(writes).toContainEqual({
            key: 'workbench.tips.enabled',
            value: true,
            target: vscode.ConfigurationTarget.Global,
        });
    });

    it('unsets a key that was unset before the apply', async () => {
        const context = fakeContext({ 'workbench.tips.enabled': undefined });
        await undoLastApply(context);
        expect(vscode._getWrittenValues()[0].value).toBeUndefined();
    });

    it('restores the host-restarting key last, as the apply does', async () => {
        const context = fakeContext({
            'chat.disableAIFeatures': undefined,
            'workbench.tips.enabled': undefined,
        });
        await undoLastApply(context);
        const keys = vscode._getWrittenValues().map((w) => w.key);
        expect(keys[keys.length - 1]).toBe('chat.disableAIFeatures');
    });

    it('clears the record so a second undo is a no-op', async () => {
        const context = fakeContext({ 'workbench.tips.enabled': true });
        await undoLastApply(context);
        expect(context._store[PRIORS_KEY]).toBeUndefined();
        vscode._resetWrittenValues();
        await undoLastApply(context);
        expect(vscode._getWrittenValues()).toEqual([]);
    });

    it('does nothing when there is no record at all', async () => {
        await undoLastApply(fakeContext(undefined));
        expect(vscode._getWrittenValues()).toEqual([]);
    });
});

describe('README stays in step with the registry', () => {
    it('documents every setting Nopilot writes, and no others', () => {
        const readme = fs.readFileSync(
            path.join(__dirname, '..', '..', 'README.md'),
            'utf8'
        );
        const section = readme.slice(readme.indexOf('## Nopilot'));
        const table = section.slice(0, section.indexOf('\n## ', 3));
        for (const key of allSettingKeys()) {
            expect(table).toContain(`\`${key}\``);
        }
    });
});
