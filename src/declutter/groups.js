//  Project:      Claudemeter
//  File:         src/declutter/groups.js
//  Purpose:      Data: the Nopilot setting groups. No vscode import, no I/O.
//
//                Confirm every id against the running VS Code bundle before
//                adding it - Microsoft renames these, and blogs still
//                recommend chat.commandCenter.enabled, which no longer exists:
//                  rg -o '"chat\.[A-Za-z0-9._]*"' \
//                    <install>/resources/app/out/vs/workbench/workbench.desktop.main.js
//                applySettings() skips undeclared keys, so a rename reads as
//                not-applied instead of leaving dead JSON in user settings.
//
//                The `core` group gates the tooltip offer.
//
//                Scope is Microsoft's AI push and its telemetry. A layout or
//                editor preference is not that, whatever its merits.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const GROUPS = Object.freeze([
    Object.freeze({
        id: 'copilot',
        label: 'Copilot upsell',
        detail: 'Hide the built-in Copilot chat, sign-in button and ghost text',
        // Gates the tooltip offer. Applied -> the offer is done its job.
        core: true,
        picked: true,
        // Surfaced on the pick row: this group has a real cost for anyone
        // running Claude inside VS Code's own chat view rather than the
        // extension panel, because chat.disableAIFeatures gates the agent host.
        note: 'Also turns off VS Code\'s native agent host, where Claude can run in the built-in chat view. The Claude Code extension panel is unaffected.',
        settings: Object.freeze({
            // The master switch. Microsoft's own sanctioned opt-out - it also
            // blocks the auto-install of the Copilot extensions that
            // product.json names as defaultChatAgent.
            'chat.disableAIFeatures': true,
            // Redundant under the master switch, kept explicit so the intent
            // survives if Microsoft narrows what the master switch covers.
            'chat.agent.enabled': false,
            'chat.titleBar.signIn.enabled': false,
            'chat.titleBar.openInAgentsWindow.enabled': false,
            'chat.detectParticipant.enabled': false,
            // "Controls whether to automatically show inline suggestions in
            // the editor" - any provider, not only Copilot.
            'editor.inlineSuggest.enabled': false,
        }),
    }),
    Object.freeze({
        id: 'windows',
        label: 'Panels that open themselves',
        detail: 'No side bar, welcome page or walkthrough opening on a new window',
        picked: true,
        settings: Object.freeze({
            // Default is visibleInWorkspace. Claude Code registers into this
            // container, so hidden is what stops it opening unasked.
            'workbench.secondarySideBar.defaultVisibility': 'hidden',
            // Default is welcomePage - this is the welcome-page-on-startup switch.
            'workbench.startupEditor': 'none',
            'workbench.welcomePage.walkthroughs.openOnInstall': false,
        }),
    }),
    Object.freeze({
        id: 'telemetry',
        label: 'Telemetry and experiments',
        detail: 'Stop usage data, crash reports, A/B experiments and settings-search calls',
        picked: true,
        note: 'Experiments and settings search have their own switches, so telemetry off alone does not stop them. Telemetry needs a restart to take effect.',
        settings: Object.freeze({
            // Enum is all|error|crash|off, default all. off covers crash
            // reporting, superseding the deprecated enableCrashReporter.
            'telemetry.telemetryLevel': 'off',
            'telemetry.feedback.enabled': false,
            // "Fetches experiments to run from a Microsoft online service."
            'workbench.enableExperiments': false,
            // "The natural language search is provided by a Microsoft online service."
            'workbench.settings.enableNaturalLanguageSearch': false,
        }),
    }),
    Object.freeze({
        id: 'nags',
        label: 'Nags',
        detail: 'No extension recommendations, tips, release notes or terminal hints',
        picked: true,
        settings: Object.freeze({
            // The usual re-entry route for a Copilot prompt.
            'extensions.ignoreRecommendations': true,
            'workbench.tips.enabled': false,
            'update.showReleaseNotes': false,
            'terminal.integrated.initialHint': false,
        }),
    }),
]);

// Writing these changes built-in extension enablement, so VS Code restarts the
// extension host and kills this extension mid-write. They are applied last, so
// every other setting has already landed.
const WRITE_LAST = Object.freeze(['chat.disableAIFeatures']);

// The group the tooltip offer is gated on.
function coreGroup() {
    return GROUPS.find((g) => g.core) || null;
}

// Every setting key across every group, deduplicated. Used to report what a
// build no longer declares.
function allSettingKeys() {
    const keys = [];
    for (const group of GROUPS) {
        for (const key of Object.keys(group.settings)) {
            if (!keys.includes(key)) keys.push(key);
        }
    }
    return keys;
}

module.exports = {
    GROUPS,
    WRITE_LAST,
    coreGroup,
    allSettingKeys,
};
