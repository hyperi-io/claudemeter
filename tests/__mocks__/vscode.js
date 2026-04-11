// Minimal vscode API stub for vitest unit tests.
//
// claudemeter source files require('vscode') at top level. In the VS Code
// extension host this module is provided by the runtime, but under vitest
// there is no host, so we alias 'vscode' to this stub via vitest.config.js.
//
// Keep this stub as small as possible: only the shapes that module-load
// time needs. If a test exercises a code path that calls a real vscode
// API, add that API here with a sensible default.

function getConfiguration() {
    return {
        get(_key, defaultValue) {
            return defaultValue;
        },
    };
}

module.exports = {
    workspace: {
        getConfiguration,
        createFileSystemWatcher: () => ({
            onDidChange: () => {},
            onDidCreate: () => {},
            onDidDelete: () => {},
            dispose: () => {},
        }),
    },
    window: {
        createOutputChannel: () => ({
            appendLine: () => {},
            append: () => {},
            show: () => {},
            dispose: () => {},
        }),
        createStatusBarItem: () => ({
            show: () => {},
            hide: () => {},
            dispose: () => {},
        }),
        showInformationMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 1 },
    RelativePattern: class {
        constructor(base, pattern) {
            this.base = base;
            this.pattern = pattern;
        }
    },
    Uri: {
        file: (p) => ({ fsPath: p }),
    },
};
