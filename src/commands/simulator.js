// Project:   Claudemeter
// File:      commands/simulator.js
// Purpose:   Register the 12 dev-only F5 simulator commands.
//
//            All commands are gated by the `config.claudemeter.debug`
//            enablement clause in package.json - they only appear in
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

// Shared validator for 0..100 inputs (blank clears).
const percentValidator = (s) =>
    s === '' || (Number.isFinite(Number(s)) && Number(s) >= 0 && Number(s) <= 100)
        ? null
        : 'Enter 0-100 or leave blank';

// Bind a percent-input simulator command. Hides the
// register-input-box-handler boilerplate that was duplicated 6x before.
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
const CONTEXT_WINDOW_CHOICES = {
    '200k': 200_000,
    '1m': 1_000_000,
    '2m': 2_000_000,
};

// The plan-and-credits combinations the context-window rules distinguish.
const PLAN_SIGNAL_CHOICES = {
    'live': null,
    'max': { organizationType: 'claude_max', subscriptionType: 'max', creditsEnabled: null },
    'pro, credits on': { organizationType: 'claude_pro', subscriptionType: 'pro', creditsEnabled: true },
    'pro, credits off': { organizationType: 'claude_pro', subscriptionType: 'pro', creditsEnabled: false },
    'enterprise': { organizationType: 'claude_enterprise', subscriptionType: null, creditsEnabled: false },
    'no plan signal': { organizationType: null, subscriptionType: null, creditsEnabled: null },
};

// Parse "Fable=72, Opus=15" into the scoped-gauge list, or null if any pair is
// malformed so the input box can reject it.
function parseScopedInput(text) {
    const entries = [];
    for (const part of String(text).split(',')) {
        const [label, percent] = part.split('=');
        const name = (label || '').trim();
        const value = Number((percent || '').trim());
        if (!name || !Number.isFinite(value) || value < 0 || value > 100) return null;
        entries.push({ label: name, percent: value });
    }
    return entries.length > 0 ? entries : null;
}

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
        // Absolute-tokens input - different validator (>=0, no upper cap)
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
        // Scoped gauges take a whole list rather than one model's percent, so
        // a simulated set can cover models this account has never used.
        vscode.commands.registerCommand('claudemeter.simulate.scopedWeekly', async () => {
            const v = await vscode.window.showInputBox({
                prompt: 'Force scoped weekly caps as "Label=percent" pairs, comma separated (e.g. "Fable=72, Opus=15"). Blank to clear.',
                validateInput: (s) => s === '' || parseScopedInput(s) !== null
                    ? null : 'Enter Label=percent pairs, or leave blank',
            });
            if (v === undefined) return;
            simulator.setScopedWeekly(v === '' ? null : parseScopedInput(v));
            await performFetch(false);
        }),
        // Forces the resolved context window so the Tk gauge can be driven at
        // any window size from any account.
        quickPickCommand({
            id: 'claudemeter.simulate.contextWindow',
            items: ['live', '200k', '1m', '2m'],
            placeHolder: 'Force the context window',
            onPick: (choice) => simulator.setContextWindow(
                choice === 'live' ? null : CONTEXT_WINDOW_CHOICES[choice]
            ),
            performFetch,
        }),
        // Forces the plan signals the context-window rules read, so the credits
        // caveat can be seen without a second account.
        quickPickCommand({
            id: 'claudemeter.simulate.planSignals',
            items: Object.keys(PLAN_SIGNAL_CHOICES),
            placeHolder: 'Force the plan signals the window rules read',
            onPick: (choice) => simulator.setPlanSignals(PLAN_SIGNAL_CHOICES[choice]),
            performFetch,
        }),
        // Stands in for the global threshold-icon setting for this session
        // only. Every other simulate command is in-memory and cleared by
        // Clear All; writing the real setting would outlive the dev host.
        quickPickCommand({
            id: 'claudemeter.simulate.thresholdIcons',
            items: ['live', 'on', 'off'],
            placeHolder: 'Show threshold glyphs on the usage gauges?',
            onPick: (choice) => simulator.setThresholdIcons(
                choice === 'live' ? null : choice === 'on'
            ),
            performFetch,
        }),
        percentCommand({
            id: 'claudemeter.simulate.creditsPercent',
            prompt: 'Force credits % (0-100, blank to clear). Requires real monthlyCredits data and claudemeter.statusBar.showCredits=true.',
            setter: simulator.setCreditsPercent,
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
