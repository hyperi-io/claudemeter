// Minimal vscode API stub for vitest unit tests.
//
// claudemeter source files require('vscode') at top level. In the VS Code
// extension host this module is provided by the runtime, but under vitest
// there is no host, so we alias 'vscode' to this stub via vitest.config.mjs.
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
    _updateError = null;
    _resetConfigInspectValues();
    _resetWrittenValues();
}

// VS Code rejects config.update() when it cannot write settings.json (a
// read-only or unparseable file). Set to make every update reject with it.
let _updateError = null;

function _setConfigUpdateError(error) {
    _updateError = error;
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
            // Effective value: a recorded workspace value outranks anything
            // written at Global, matching VS Code's scope precedence.
            const record = _inspectRecords[key];
            if (record && record.workspaceValue !== undefined) return record.workspaceValue;
            if (key in _configValues) return _configValues[key];
            return defaultValue;
        },
        inspect(key) {
            // Real VS Code ALWAYS returns a record - Configuration.inspect()
            // constructs one unconditionally - so an unrecorded key must come
            // back as an all-undefined record, not as undefined. Returning
            // undefined here would let a test prove a defence production does
            // not have.
            return _inspectRecords[key] || { key, defaultValue: undefined };
        },
        async update(key, value, target) {
            if (_updateError) throw _updateError;
            _writtenValues.push({ key, value, target });
            // Mirror the write into BOTH the effective store and the inspect
            // record's globalValue, so a read-back sees what production sees.
            if (target === ConfigurationTarget.Global) {
                _setConfigInspectValues(key, { globalValue: value });
            }
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

// Tooltips are MarkdownStrings. `value` is what a test reads back to assert on
// rendered copy; `isTrusted` is what makes a `command:` link executable, so a
// test asserting escaping needs both.
class MarkdownString {
    constructor(value = '') {
        this.value = value;
        this.isTrusted = false;
        this.supportThemeIcons = false;
    }

    appendMarkdown(v) {
        this.value += v;
        return this;
    }
}

// `visible` mirrors show()/hide() so a test can assert what the user can see
// and click. Every item is kept, in creation order, with the command ids
// registered at the moment it was created.
let _statusBarItems = [];

function createStatusBarItem(alignment, priority) {
    const item = {
        alignment,
        priority,
        text: '',
        tooltip: undefined,
        color: undefined,
        backgroundColor: undefined,
        command: undefined,
        visible: false,
        commandsAtCreation: [..._commands.keys()],
        show() { this.visible = true; },
        hide() { this.visible = false; },
        dispose() {},
    };
    _statusBarItems.push(item);
    return item;
}

function _getStatusBarItems() {
    return _statusBarItems.slice();
}

function _resetStatusBarItems() {
    _statusBarItems = [];
}

// The window's remote authority: undefined locally, e.g. 'ssh-remote' remotely.
const env = {
    remoteName: undefined,
    openExternal: () => Promise.resolve(true),
    clipboard: { writeText: () => Promise.resolve() },
};

// Which host runs claudemeter in a remote window. Unset reads as the client,
// and each _setRemoteName call resets it.
const ExtensionKind = { UI: 1, Workspace: 2 };
let _extensionKind;

function _setRemoteName(name, extensionKind) {
    env.remoteName = name;
    _extensionKind = extensionKind;
}

function getExtension(id) {
    return _extensionKind ? { id, extensionKind: _extensionKind, packageJSON: undefined } : undefined;
}

// Registered command handlers, and every executeCommand call in order. An
// executed id with a registered handler runs it, as the real registry does.
let _commands = new Map();
let _executed = [];

const commands = {
    registerCommand(id, handler) {
        _commands.set(id, handler);
        return { dispose: () => { if (_commands.get(id) === handler) _commands.delete(id); } };
    },
    async executeCommand(id, ...args) {
        _executed.push(id);
        const handler = _commands.get(id);
        return handler ? handler(...args) : undefined;
    },
};

function _getCommand(id) {
    return _commands.get(id);
}

function _getExecutedCommands() {
    return _executed.slice();
}

function _resetCommands() {
    _commands = new Map();
    _executed = [];
}

// Configuration-change listeners, fired by _fireConfigChange with the keys a
// test says changed.
let _configListeners = [];

function onDidChangeConfiguration(listener) {
    _configListeners.push(listener);
    return { dispose: () => { _configListeners = _configListeners.filter((l) => l !== listener); } };
}

async function _fireConfigChange(changedKeys) {
    const event = {
        affectsConfiguration: (section) => changedKeys.some(
            (key) => key === section || key.startsWith(`${section}.`)
        ),
    };
    for (const listener of _configListeners.slice()) await listener(event);
}

// Every watcher created, with its pattern and its listeners, so a test can
// fire a filesystem event.
let _watchers = [];

function createFileSystemWatcher(pattern) {
    const watcher = {
        pattern,
        listeners: { change: [], create: [], delete: [] },
        onDidChange(fn) { this.listeners.change.push(fn); return { dispose() {} }; },
        onDidCreate(fn) { this.listeners.create.push(fn); return { dispose() {} }; },
        onDidDelete(fn) { this.listeners.delete.push(fn); return { dispose() {} }; },
        dispose() {},
    };
    _watchers.push(watcher);
    return watcher;
}

function _getWatchers() {
    return _watchers.slice();
}

function _resetWorkspace() {
    _configListeners = [];
    _watchers = [];
}

// Output channels created, so a test can count them and read their lines.
let _outputChannels = [];

function createOutputChannel(name) {
    const channel = {
        name,
        lines: [],
        disposed: false,
        appendLine(line) { this.lines.push(line); },
        append(text) { this.lines.push(text); },
        show() {},
        clear() { this.lines = []; },
        dispose() { this.disposed = true; },
    };
    _outputChannels.push(channel);
    return channel;
}

function _getOutputChannels() {
    return _outputChannels.slice();
}

function _resetOutputChannels() {
    _outputChannels = [];
}

module.exports = {
    env,
    commands,
    extensions: {
        getExtension,
    },
    ExtensionKind,
    workspace: {
        getConfiguration,
        createFileSystemWatcher,
        onDidChangeConfiguration,
        workspaceFolders: undefined,
    },
    window: {
        createOutputChannel,
        createStatusBarItem,
        createTerminal: () => ({ show() {}, sendText() {}, dispose() {} }),
        showInformationMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined),
        showWarningMessage: () => Promise.resolve(undefined),
        showQuickPick: () => Promise.resolve(undefined),
        showInputBox: () => Promise.resolve(undefined),
    },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
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
        parse: (s) => ({ toString: () => s }),
    },
    ThemeColor,
    MarkdownString,
    ConfigurationTarget,
    _setConfigValues,
    _resetConfigValues,
    _setConfigInspectValues,
    _resetConfigInspectValues,
    _setConfigUpdateError,
    _getStatusBarItems,
    _resetStatusBarItems,
    _getWrittenValues,
    _resetWrittenValues,
    _setRemoteName,
    _getCommand,
    _getExecutedCommands,
    _resetCommands,
    _fireConfigChange,
    _getWatchers,
    _resetWorkspace,
    _getOutputChannels,
    _resetOutputChannels,
};
