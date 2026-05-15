// Project:   Claudemeter
// File:      commands/simulator.js
// Purpose:   Register the 12 dev-only F5 simulator commands.
//
//            All commands are gated by the `config.claudemeter.debug`
//            enablement clause in package.json — they only appear in
//            the command palette when claudemeter.debug=true. Each
//            command sets a simulator override and triggers an
//            immediate re-fetch so the change is visible without
//            waiting for the auto-refresh tick.
//
//            Pulled out of extension.js so the command-registration
//            block doesn't grow alongside it, and so the input-validator
//            patterns can be deduped here.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const vscode = require('vscode');
const simulator = require('../simulator');
const { CONFIG_NAMESPACE } = require('../utils');

// Shared validator for 0..100 inputs (blank clears).
const percentValidator = (s) =>
    s === '' || (Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 100)
        ? null
        : 'Enter 0-100 or leave blank';

// Bind a percent-input simulator command. Hides the
// register-input-box-handler boilerplate that was duplicated 6× before.
function percentCommand({ id, prompt, setter, performFetch }) {
    return vscode.commands.registerCommand(id, async () => {
        const v = await vscode.window.showInputBox({ prompt, validateInput: percentValidator });
        if (v === undefined) return;
        setter(v === '' ? null : Number(v));
        await performFetch(false);
    });
}

// Bind a quick-pick simulator command.
function quickPickCommand({ id, items, placeHolder, onPick, performFetch }) {
    return vscode.commands.registerCommand(id, async () => {
        const choice = await vscode.window.showQuickPick(items, { placeHolder });
        if (!choice) return;
        await onPick(choice);
        await performFetch(false);
    });
}

/**
 * Register every claudemeter.simulate.* command with VS Code. Caller
 * passes a performFetch callback (extension.js owns the fetch lifecycle)
 * so this module stays unaware of the surrounding state.
 *
 * @param {vscode.ExtensionContext} context
 * @param {(silent: boolean) => Promise<void>} performFetch
 */
function registerSimulatorCommands(context, performFetch) {
    context.subscriptions.push(
        // Tier-quickpick: snap the Tk gauge to a specific level
        quickPickCommand({
            id: 'claudemeter.simulate.tokenLevel',
            items: ['live', 'normal', 'rotLight', 'rotDeep', 'warning', 'error'],
            placeHolder: 'Force Tk gauge to which tier?',
            onPick: (choice) => simulator.setTokenLevel(choice === 'live' ? null : choice),
            performFetch,
        }),
        // Absolute-tokens input — different validator (>=0, no upper cap)
        vscode.commands.registerCommand('claudemeter.simulate.tokenUsed', async () => {
            const v = await vscode.window.showInputBox({
                prompt: 'Force absolute tokens used (number, blank to clear)',
                validateInput: (s) => s === '' || (Number.isFinite(Number(s)) && Number(s) >= 0)
                    ? null : 'Enter non-negative number or leave blank',
            });
            if (v === undefined) return;
            simulator.setTokenUsed(v === '' ? null : Number(v));
            await performFetch(false);
        }),
        percentCommand({
            id: 'claudemeter.simulate.sessionPercent',
            prompt: 'Force session % (0-100, blank to clear)',
            setter: simulator.setSessionPercent,
            performFetch,
        }),
        percentCommand({
            id: 'claudemeter.simulate.weeklyPercent',
            prompt: 'Force weekly % (0-100, blank to clear)',
            setter: simulator.setWeeklyPercent,
            performFetch,
        }),
        percentCommand({
            id: 'claudemeter.simulate.sonnetPercent',
            prompt: 'Force Sonnet % (0-100, blank to clear). Requires claudemeter.statusBar.showSonnet=true.',
            setter: simulator.setSonnetPercent,
            performFetch,
        }),
        percentCommand({
            id: 'claudemeter.simulate.opusPercent',
            prompt: 'Force Opus % (0-100, blank to clear). Requires claudemeter.statusBar.showOpus=true.',
            setter: simulator.setOpusPercent,
            performFetch,
        }),
        percentCommand({
            id: 'claudemeter.simulate.creditsPercent',
            prompt: 'Force credits % (0-100, blank to clear). Requires real monthlyCredits data and claudemeter.statusBar.showCredits=true.',
            setter: simulator.setCreditsPercent,
            performFetch,
        }),
        quickPickCommand({
            id: 'claudemeter.simulate.legacyScraper',
            items: ['off (HTTP fetcher)', 'on (legacy browser scraper)'],
            placeHolder: 'Toggle claudemeter.useLegacyScraper for this workspace',
            onPick: async (choice) => {
                const enable = choice.startsWith('on');
                await vscode.workspace.getConfiguration(CONFIG_NAMESPACE).update(
                    'useLegacyScraper', enable, vscode.ConfigurationTarget.Workspace
                );
                vscode.window.showInformationMessage(
                    `Legacy scraper ${enable ? 'enabled' : 'disabled'} for this workspace.`
                );
            },
            performFetch,
        }),
        quickPickCommand({
            id: 'claudemeter.simulate.happyHour',
            items: ['live', 'on', 'off'],
            placeHolder: 'Force happy-hour state',
            onPick: (choice) => simulator.setHappyHour(choice === 'live' ? null : choice === 'on'),
            performFetch,
        }),
        quickPickCommand({
            id: 'claudemeter.simulate.colorMode',
            items: ['live', 'color', 'basic'],
            placeHolder: 'Force colorMode',
            onPick: (choice) => simulator.setColorMode(choice === 'live' ? null : choice),
            performFetch,
        }),
        quickPickCommand({
            id: 'claudemeter.simulate.profileOverride',
            items: ['live', 'pro', 'max-5x', 'max-20x', 'max-unknown', 'team-standard', 'enterprise', 'unknown'],
            placeHolder: 'Force Tk profile',
            onPick: (choice) => simulator.setProfileOverride(choice === 'live' ? null : choice),
            performFetch,
        }),
        vscode.commands.registerCommand('claudemeter.simulate.clear', async () => {
            simulator.clearAll();
            vscode.window.showInformationMessage('Claudemeter simulator cleared — back to live data.');
            await performFetch(false);
        }),
    );
}

module.exports = { registerSimulatorCommands };
