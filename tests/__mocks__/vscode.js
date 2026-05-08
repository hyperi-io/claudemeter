// Minimal vscode API stub for vitest unit tests.
//
// claudemeter source files require('vscode') at top level. In the VS Code
// extension host this module is provided by the runtime, but under vitest
// there is no host, so we alias 'vscode' to this stub via vitest.config.js.
//
// Keep this stub as small as possible: only the shapes that module-load
// time needs. If a test exercises a code path that calls a real vscode
// API, add that API here with a sensible default.

// Parameterizable config store. Tests call _setConfigValues / _resetConfigValues
// to inject values; production-path code uses the getConfiguration stub which
// returns defaultValue for any key not present in _configValues.
let _configValues = {};

function _setConfigValues(values) {
    _configValues = { ..._configValues, ...values };
}

function _resetConfigValues() {
    _configValues = {};
    _resetConfigInspectValues();
    _resetWrittenValues();
}

// Inspect-record store for config.inspect() calls.
// record = { globalValue, workspaceValue, workspaceFolderValue, defaultValue }
let _inspectRecords = {};

function _setConfigInspectValues(key, record) {
    _inspectRecords[key] = { ..._inspectRecords[key], ...record };
}

function _resetConfigInspectValues() {
    _inspectRecords = {};
}

// Write-tracking for config.update() calls. Tests can assert on these.
let _writtenValues = [];

function _getWrittenValues() {
    return _writtenValues.slice();
}

function _resetWrittenValues() {
    _writtenValues = [];
}

// ConfigurationTarget enum values
const ConfigurationTarget = Object.freeze({
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
});

function getConfiguration() {
    return {
        get(key, defaultValue) {
            if (key in _configValues) return _configValues[key];
            return defaultValue;
        },
        inspect(key) {
            return _inspectRecords[key];  // undefined if not recorded
        },
        async update(key, value, target) {
            _writtenValues.push({ key, value, target });
            // Mirror writes into _configValues for subsequent get() in same test
            if (value === undefined) {
                delete _configValues[key];
            } else {
                _configValues[key] = value;
            }
        },
    };
}

class ThemeColor {
    constructor(id) { this.id = id; }
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
    ThemeColor,
    ConfigurationTarget,
    _setConfigValues,
    _resetConfigValues,
    _setConfigInspectValues,
    _resetConfigInspectValues,
    _getWrittenValues,
    _resetWrittenValues,
};
