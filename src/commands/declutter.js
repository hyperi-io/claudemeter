//  Project:      Claudemeter
//  File:         src/commands/declutter.js
//  Purpose:      The Nopilot command: pick which groups to switch off, then
//                write them to user settings.
//
//                Two consent steps, both cancellable - a per-group pick and a
//                modal confirm. Nothing is written on a bare click.
//
//                Writes go through the configuration API at Global scope, not
//                by editing settings.json: the path differs per OS and the API
//                preserves the file's comments and formatting.
//
//                inspect() returning undefined means the running build (or an
//                uninstalled extension) does not declare the key, so it is
//                skipped rather than written.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const { COMMANDS, fileLog, plural } = require('../utils');
const { GROUPS, WRITE_LAST } = require('../declutter/groups');
const {
    pendingSettings,
    pendingGroups,
    globalScopeReader,
    isDeclared,
} = require('../declutter/state');

// The feature's own switch. "Not interested" writes this to false rather than
// hiding a dismissal in globalState, so the user can find and undo it in the
// settings UI.
const ENABLED_SETTING = 'claudemeter.nopilot.enabled';

// Prior user-scope values from the last apply, for the undo command.
const PRIORS_KEY = 'claudemeter.nopilot.priors';

// Root-scope configuration - these settings are VS Code's and other
// extensions', not claudemeter's, so the accessor takes no section.
function rootConfig() {
    return vscode.workspace.getConfiguration();
}

// Build the pick list. Only groups with work left are offered - a group
// already applied is not a choice, it is done.
function buildItems(config) {
    const read = globalScopeReader(config);
    return pendingGroups(read).map((group) => {
        const pending = pendingSettings(group, read);
        return {
            label: group.label,
            description: plural(pending.length, 'setting'),
            detail: group.note ? `${group.detail}. ${group.note}` : group.detail,
            picked: group.picked,
            group,
            pending,
        };
    });
}

// Flatten the picks into one write order, with the host-restarting keys last.
// Recomputed from the group rather than reusing the pending array captured at
// pick time - the quick pick sets ignoreFocusOut, so the user can edit settings
// in between and a stale list would overwrite what they just changed.
function writeOrder(picks, read) {
    const writes = [];
    for (const pick of picks) {
        const pending = read ? pendingSettings(pick.group, read) : pick.pending;
        for (const key of pending) {
            writes.push({ key, target: pick.group.settings[key] });
        }
    }
    const rank = (w) => (WRITE_LAST.includes(w.key) ? 1 : 0);
    return writes.sort((a, b) => rank(a) - rank(b));
}

// Split at the boundary the host teardown sits on. The deferred writes restart
// the extension host, so anything this command still wants to say must be said
// before they are issued.
function splitDeferred(writes) {
    return {
        immediate: writes.filter((w) => !WRITE_LAST.includes(w.key)),
        deferred: writes.filter((w) => WRITE_LAST.includes(w.key)),
    };
}

// We write at Global scope but the gate reads the EFFECTIVE value, so a key
// pinned away from target in a workspace or folder would stay pending forever -
// the offer would return after every apply and re-write Global each time. A key
// whose effective value still differs after its own successful write is
// shadowed, and is reported rather than counted as written.
function isShadowed(key, target) {
    return rootConfig().get(key) !== target;
}

async function applyWrites(config, writes) {
    const written = [];
    const skipped = [];
    const shadowed = [];
    // Prior user-scope value per key, so an apply is reversible. undefined
    // means the key was unset, and undo restores that by unsetting it again.
    const priors = {};
    for (const { key, target } of writes) {
        if (!isDeclared(config, key)) {
            skipped.push(key);
            fileLog(`Nopilot: skipped ${key} - not declared by this build`);
            continue;
        }
        priors[key] = config.inspect(key).globalValue;
        await config.update(key, target, vscode.ConfigurationTarget.Global);
        if (isShadowed(key, target)) {
            shadowed.push(key);
            fileLog(`Nopilot: ${key} written to user settings but overridden at a narrower scope`);
            continue;
        }
        written.push(key);
        fileLog(`Nopilot: wrote ${key}=${JSON.stringify(target)}`);
    }
    return { written, skipped, shadowed, priors };
}

async function reportOutcome(written, skipped, shadowed) {
    const notes = [];
    if (skipped.length) notes.push(` ${plural(skipped.length, 'setting')} not recognised by this build.`);
    if (shadowed.length) notes.push(` ${plural(shadowed.length, 'setting')} overridden by your workspace settings.`);

    if (written.length === 0) {
        vscode.window.showWarningMessage(`Nopilot: nothing changed.${notes.join('')}`);
        return;
    }
    // Several of these apply live; the side bar's default visibility applies
    // to windows opened afterwards, so the reload is offered, not forced.
    const choice = await vscode.window.showInformationMessage(
        `Nopilot: ${plural(written.length, 'setting')} updated.${notes.join('')}`,
        'Reload Window',
        'Undo'
    );
    if (choice === 'Reload Window') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else if (choice === 'Undo') {
        await vscode.commands.executeCommand(COMMANDS.NOPILOT_UNDO);
    }
}

// Restore every key to the user-scope value it held before the last apply.
// undefined restores "unset", which is what config.update(key, undefined) does.
async function undoLastApply(context) {
    const priors = context.globalState.get(PRIORS_KEY);
    if (!priors || Object.keys(priors).length === 0) {
        vscode.window.showInformationMessage('Nopilot: nothing to undo.');
        return;
    }
    const config = rootConfig();
    const keys = Object.keys(priors);
    // Same teardown constraint as the apply: the host-restarting key goes last.
    keys.sort((a, b) => (WRITE_LAST.includes(a) ? 1 : 0) - (WRITE_LAST.includes(b) ? 1 : 0));
    for (const key of keys) {
        await config.update(key, priors[key], vscode.ConfigurationTarget.Global);
        fileLog(`Nopilot: undo restored ${key}=${JSON.stringify(priors[key])}`);
    }
    await context.globalState.update(PRIORS_KEY, undefined);
    vscode.window.showInformationMessage(
        `Nopilot: restored ${plural(keys.length, 'setting')} to their previous values.`
    );
}

// Keys the user has already set at their own scope to something other than our
// target. Overwriting a deliberate choice needs naming in the confirm, not
// burying in a count.
function explicitOverwrites(config, writes) {
    return writes
        .map((w) => w.key)
        .filter((key) => config.inspect(key).globalValue !== undefined);
}

async function runNopilot(context) {
    const config = rootConfig();
    const items = buildItems(config);

    if (items.length === 0) {
        vscode.window.showInformationMessage(
            'Nopilot: every setting is already applied.'
        );
        return;
    }

    const picks = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: 'Nopilot - disable Copilot forced upsell',
        placeHolder: 'Untick anything you want to keep, then press Enter',
        ignoreFocusOut: true,
    });
    if (!picks || picks.length === 0) return;

    const writes = writeOrder(picks, globalScopeReader(config));
    const overwrites = explicitOverwrites(config, writes);
    const detail = [
        ...writes.map((w) => `${w.key} -> ${JSON.stringify(w.target)}`),
        ...(overwrites.length
            ? ['', `${plural(overwrites.length, 'setting')} already set by you will be replaced.`]
            : []),
    ].join('\n');
    const confirmed = await vscode.window.showInformationMessage(
        `Write ${plural(writes.length, 'setting')} to your user settings?`,
        { modal: true, detail },
        'Apply'
    );
    if (confirmed !== 'Apply') return;

    const { immediate, deferred } = splitDeferred(writes);
    let result;
    try {
        result = await applyWrites(config, immediate);
    } catch (err) {
        fileLog(`Nopilot: aborted - ${err && err.message}`);
        vscode.window.showErrorMessage(
            `Nopilot stopped part-way: ${err && err.message}. Settings may be partly applied - run it again to finish.`
        );
        return;
    }

    // Record priors BEFORE the deferred writes for the same reason the report
    // goes first - the host teardown may end this command mid-flight.
    const priors = { ...result.priors };
    for (const { key } of deferred) {
        if (isDeclared(config, key)) priors[key] = config.inspect(key).globalValue;
    }
    await context.globalState.update(PRIORS_KEY, priors);

    // Report BEFORE the deferred writes. They restart the extension host, so
    // this command may not get another turn to say anything.
    await reportOutcome(
        result.written.concat(deferred.map((w) => w.key)),
        result.skipped,
        result.shadowed
    );

    try {
        await applyWrites(config, deferred);
    } catch (err) {
        fileLog(`Nopilot: deferred write failed - ${err && err.message}`);
    }
}

/**
 * Register the Nopilot commands.
 *
 * @param {vscode.ExtensionContext} context
 * @param {() => void} onChanged - called after settings are written or the
 *   feature is switched off, so the status bar can drop the tooltip line.
 */
function registerDeclutterCommands(context, onChanged) {
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.NOPILOT, async () => {
            await runNopilot(context);
            if (onChanged) onChanged();
        }),
        vscode.commands.registerCommand(COMMANDS.NOPILOT_DISMISS, async () => {
            await rootConfig().update(
                ENABLED_SETTING,
                false,
                vscode.ConfigurationTarget.Global
            );
            if (onChanged) onChanged();
            // A click that makes something vanish needs to say what it did.
            const choice = await vscode.window.showInformationMessage(
                'Nopilot hidden. Re-enable it with the claudemeter.nopilot.enabled setting.',
                'Undo'
            );
            if (choice === 'Undo') {
                await rootConfig().update(
                    ENABLED_SETTING,
                    undefined,
                    vscode.ConfigurationTarget.Global
                );
                if (onChanged) onChanged();
            }
        }),
        vscode.commands.registerCommand(COMMANDS.NOPILOT_UNDO, async () => {
            await undoLastApply(context);
            if (onChanged) onChanged();
        })
    );
}

module.exports = {
    registerDeclutterCommands,
    ENABLED_SETTING,
    PRIORS_KEY,
    // Exported for tests - pure enough to drive with a fake config.
    buildItems,
    applyWrites,
    writeOrder,
    splitDeferred,
    explicitOverwrites,
    undoLastApply,
    GROUPS,
};
