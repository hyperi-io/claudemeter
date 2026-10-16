// extension.js on real modules and real files in a sandboxed home. Web usage
// comes from the on-disk usage cache, and with no usable token a miss fails locally.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { createHomeSandbox, ROOT } = require('../common/homeSandbox');

// Captured before the clock is faked: waits on real file I/O need real time.
const realSetTimeout = setTimeout;
const pause = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));

const TRANSCRIPT_ID = '0b9e2a4c-5d1f-4e3a-9c7b-2f8d6a1e4b3c';
const FOREVER = 10 * 365 * 24 * 3600 * 1000;

let sb;
let h;
let heldLocks;
let mtimeSeq;

function load(rel) {
    return require(path.join(ROOT, rel));
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
}

// claudeConfigReader memoises on mtime + size, so each rewrite gets a new mtime.
function writeIdentity(oauthAccount) {
    const file = path.join(sb.claudeDir, '.claude.json');
    writeJson(file, { oauthAccount });
    const stamp = Math.floor(Date.now() / 1000) + (++mtimeSeq);
    fs.utimesSync(file, stamp, stamp);
}

function writeCredentials(oauth) {
    writeJson(path.join(sb.claudeDir, '.credentials.json'), { claudeAiOauth: oauth });
}

function usage(percent, accountInfo) {
    const { processApiResponse } = load('src/apiSchema');
    const hours = (n) => new Date(Date.now() + n * 3600 * 1000).toISOString();
    return processApiResponse(
        { five_hour: { utilization: percent, resets_at: hours(3) }, seven_day: { utilization: 20, resets_at: hours(72) } },
        null, null, accountInfo,
    );
}

function cacheFile() {
    return path.join(load('src/utils').PATHS.CONFIG_DIR, 'usage-cache.json');
}

function writeCache(account, usageData, fetchedAt = Date.now() + FOREVER) {
    writeJson(cacheFile(), { usageData, fetchedAt, account });
}

// Another window holding the lock, taken with the extension's own lock code.
async function holdLock(target) {
    const lock = await load('src/sessionTracker').acquireFileLock(target);
    heldLocks.push(lock);
    return lock;
}

function releaseLock(lock) {
    fs.rmSync(lock.path, { force: true });
    heldLocks = heldLocks.filter((l) => l !== lock);
}

function transcriptFile() {
    const { ClaudeDataLoader } = load('src/claudeDataLoader');
    const dirName = new ClaudeDataLoader(sb.workspace, () => {}).projectDirName;
    return path.join(sb.claudeDir, 'projects', dirName, `${TRANSCRIPT_ID}.jsonl`);
}

function appendTurn(contextTokens) {
    const file = transcriptFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const turn = {
        type: 'assistant',
        timestamp: new Date().toISOString(),
        cwd: sb.workspace,
        message: {
            model: 'claude-sonnet-4-5',
            usage: { input_tokens: 0, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: contextTokens },
        },
    };
    fs.appendFileSync(file, JSON.stringify(turn) + '\n');
}

function debugLog() {
    try {
        return fs.readFileSync(load('src/utils').getDefaultDebugLogPath(), 'utf8');
    } catch {
        return '';
    }
}

function countLog(pattern) {
    return (debugLog().match(new RegExp(pattern, 'g')) || []).length;
}

function tooltip() {
    const tip = vscode._getStatusBarItems()[0]?.tooltip;
    return typeof tip === 'string' ? tip : (tip?.value ?? '');
}

// The session percent the tooltip shows, or null when no web usage is drawn.
function sessionShown() {
    const m = tooltip().match(/\*\*Session - (\d+)%\*\*/);
    return m ? Number(m[1]) : null;
}

// The Tk token count the tooltip shows, e.g. '50.0K', or null.
function contextShown() {
    const m = tooltip().match(/Tokens (\S+) \//);
    return m ? m[1] : null;
}

function visibleTexts() {
    return vscode._getStatusBarItems().filter((i) => i.visible).map((i) => i.text);
}

function sessionRecords() {
    try {
        return JSON.parse(fs.readFileSync(load('src/utils').PATHS.SESSION_DATA_FILE, 'utf8')).sessions || [];
    } catch {
        return [];
    }
}

// Polls across real file I/O, optionally moving the fake clock between checks.
async function until(cond, { tries = 300, advanceMs = 0 } = {}) {
    for (let i = 0; i < tries; i++) {
        if (await cond()) return;
        if (advanceMs) await vi.advanceTimersByTimeAsync(advanceMs);
        await pause(5);
    }
    throw new Error(`condition not met: ${cond.toString()}`);
}

// Lets in-flight file I/O land before a negative assertion.
async function settle(ms = 100) {
    await pause(ms);
    await vi.advanceTimersByTimeAsync(0);
}

function buildHarness() {
    const extension = load('extension.js');
    const context = {
        subscriptions: [],
        extension: { packageJSON: { version: 'test' } },
        extensionMode: vscode.ExtensionMode.Test,
        globalState: { get: () => undefined, update: async () => {} },
    };
    const fireIdentityChange = async (fileName = '.claude.json') => {
        const watcher = vscode._getWatchers().find((w) => w.pattern.pattern === fileName);
        for (const fn of watcher.listeners.change) await fn();
        await settle(20);
    };
    return {
        extension,
        context,
        fireIdentityChange,
        runCommand: (id) => vscode._getCommand(id)(),
        activate: async () => {
            sb.assertContained();
            await extension.activate(context);
            await settle(20);
        },
    };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    sb = createHomeSandbox('claudemeter-ext-');
    heldLocks = [];
    mtimeSeq = 0;
    vscode._resetConfigValues();
    vscode._resetCommands();
    vscode._resetWorkspace();
    vscode._resetOutputChannels();
    vscode._resetStatusBarItems();
    vscode.workspace.workspaceFolders = [{ uri: { fsPath: sb.workspace } }];
    // The debug log records each fetch. Service status is off because it calls status.claude.com.
    vscode._setConfigValues({ debug: true, fetchOnStartup: false, 'statusBar.showServiceStatus': false });

    writeIdentity({ accountUuid: 'acct-a', organizationUuid: 'org-1', organizationType: 'claude_max' });
    writeCredentials({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x', scopes: [] });
    writeCache('acct-a', usage(11, { name: 'A' }));
    appendTurn(50_000);
    h = buildHarness();
});

afterEach(async () => {
    await h.extension.deactivate();
    for (const d of h.context.subscriptions) {
        try { d?.dispose?.(); } catch { /* already gone */ }
    }
    await pause(50);
    // Discards pending fake timers, so nothing waiting on a lock resumes later.
    vi.useRealTimers();
    for (const lock of heldLocks) fs.rmSync(lock.path, { force: true });
    await pause(20);
    vscode.workspace.workspaceFolders = undefined;
    sb.restore();
});

describe('activation order', () => {
    it('registers commands before the status bar exists', async () => {
        await h.activate();
        const items = vscode._getStatusBarItems();
        expect(items.length).toBeGreaterThan(0);
        for (const item of items) expect(item.commandsAtCreation).toContain('claudemeter.fetchNow');
    });

    it('keeps its commands when a setup step throws', async () => {
        vscode._setConfigInspectValues('statusBar.use24HourTime', { globalValue: true });
        vscode._setConfigUpdateError(new Error('Unable to write into user settings'));
        await h.activate();
        expect(debugLog()).toMatch(/Setup step failed \(deprecated settings\)/);
        expect(vscode._getCommand('claudemeter.fetchNow')).toBeTypeOf('function');
        expect(vscode._getCommand('claudemeter.dumpState')).toBeTypeOf('function');
        expect(contextShown()).toBe('50.0K');
    });
});

describe('debug log path', () => {
    it('does not write the default path into user settings', async () => {
        await h.activate();
        const keys = vscode._getWrittenValues().map((w) => w.key);
        expect(keys).not.toContain('debugLogFile');
    });

    it('removes a previously persisted default path, which carries the OS username', async () => {
        const { getDefaultDebugLogPath } = load('src/utils');
        vscode._setConfigInspectValues('debugLogFile', { globalValue: getDefaultDebugLogPath(), defaultValue: '' });
        await h.activate();
        expect(vscode._getWrittenValues()).toContainEqual({
            key: 'debugLogFile', value: undefined, target: vscode.ConfigurationTarget.Global,
        });
    });

    it('leaves a path the user chose alone', async () => {
        vscode._setConfigInspectValues('debugLogFile', { globalValue: '~/my.log', defaultValue: '' });
        await h.activate();
        expect(vscode._getWrittenValues().map((w) => w.key)).not.toContain('debugLogFile');
    });
});

describe('Tk display does not wait on the session tracker', () => {
    it('draws the Tk value when persisting fails', async () => {
        // A directory at the history file's path fails every write.
        fs.mkdirSync(load('src/utils').PATHS.SESSION_DATA_FILE, { recursive: true });
        await h.activate();
        expect(contextShown()).toBe('50.0K');
        await until(() => /Session history write failed/.test(debugLog()));
    });

    it('draws the Tk value while the tracker lock is stalled', async () => {
        const sessionFile = load('src/utils').PATHS.SESSION_DATA_FILE;
        await holdLock(sessionFile);
        await h.activate();
        expect(contextShown()).toBe('50.0K');
        await settle();
        expect(fs.existsSync(sessionFile)).toBe(false);
    });

    it('Start New Session still starts a session on the tracker', async () => {
        await h.activate();
        const original = vscode.window.showInputBox;
        vscode.window.showInputBox = async () => 'auth work';
        try {
            const run = h.runCommand('claudemeter.startNewSession');
            // The tracker lock polls on the faked clock while activation's write holds it.
            await until(() => sessionRecords().some((s) => s.description === 'auth work'), { advanceMs: 10 });
            await run;
        } finally {
            vscode.window.showInputBox = original;
        }
    });

    it('persists through recordTokens, never adopting another window\'s session', async () => {
        const now = new Date().toISOString();
        writeJson(load('src/utils').PATHS.SESSION_DATA_FILE, {
            sessions: [{
                sessionId: 'session-other-window',
                startTime: now,
                description: 'another window',
                tokenUsage: { current: 999, limit: 200000, remaining: 199001, lastUpdate: now },
            }],
            totals: { totalSessions: 1, totalTokensUsed: 999, lastSessionDate: now },
        });
        await h.activate();
        await until(() => sessionRecords().some((s) => s.tokenUsage?.current === 50_000));
        const sessions = sessionRecords();
        expect(sessions.find((s) => s.sessionId === 'session-other-window').tokenUsage.current).toBe(999);
        expect(sessions.filter((s) => s.tokenUsage?.current === 50_000)).toHaveLength(1);
        expect(sessions).toHaveLength(2);
    });
});

describe('identity file re-read', () => {
    // Off macOS the token and the plan both come from .credentials.json, so the re-seed is unobservable.
    it.skip('keeps the token-seeded plan when ~/.claude.json changes (needs the macOS Keychain as a token store apart from .credentials.json -- not mocking)', () => {});

    it('keeps the /profile rate-limit tier across the re-read', async () => {
        writeCache('acct-a', usage(11, { name: 'A', rateLimitTier: 'default_claude_max_5x' }));
        await h.activate();
        await h.runCommand('claudemeter.fetchNow');
        expect(tooltip()).toContain('Max 5x');
        writeIdentity({ accountUuid: 'acct-a', organizationUuid: 'org-1', organizationType: 'claude_max' });
        await h.fireIdentityChange('.claude.json');
        expect(tooltip()).toContain('Max 5x');
        expect(tooltip()).not.toContain('Max 20x');
    });

    it('does not copy /profile identity into the credentials record', async () => {
        // A copied email would differ from the on-disk identity and read as a switch.
        writeCache('acct-a', usage(11, { name: 'A', email: 'a@example.com', orgName: 'Org' }));
        await h.activate();
        await h.runCommand('claudemeter.fetchNow');
        expect(sessionShown()).toBe(11);
        writeIdentity({ accountUuid: 'acct-a', organizationUuid: 'org-1', organizationType: 'claude_max' });
        await h.fireIdentityChange('.claude.json');
        expect(sessionShown()).toBe(11);
        expect(debugLog()).not.toMatch(/Account switched/);
    });
});

describe('account switch', () => {
    it('fetches with the new account as the cache key', async () => {
        await h.activate();
        await h.runCommand('claudemeter.fetchNow');
        expect(sessionShown()).toBe(11);
        writeCache('acct-b', usage(22, { name: 'B' }));
        writeIdentity({ accountUuid: 'acct-b', organizationUuid: 'org-1', organizationType: 'claude_max' });
        await h.fireIdentityChange();
        await until(() => sessionShown() === 22);
    });

    it('keys by org uuid when there is no account uuid', async () => {
        writeIdentity({ organizationUuid: 'org-1', organizationType: 'claude_max' });
        writeCache('org-1', usage(33, { name: 'Org' }));
        await h.activate();
        await h.runCommand('claudemeter.fetchNow');
        expect(sessionShown()).toBe(33);
    });

    it('is not absorbed into a fetch already in flight for the old account', async () => {
        await h.activate();
        await h.runCommand('claudemeter.fetchNow');
        expect(sessionShown()).toBe(11);

        // A stale entry behind a busy lock holds this fetch until the lock wait times out.
        writeCache('acct-a', usage(11, { name: 'A' }), 0);
        const lock = await holdLock(cacheFile());
        const manual = h.runCommand('claudemeter.fetchNow');
        await settle(20);

        writeIdentity({ accountUuid: 'acct-b', organizationUuid: 'org-1', organizationType: 'claude_max' });
        await h.fireIdentityChange();
        expect(sessionShown()).toBeNull();

        await until(() => /Discarded usage fetched for the previous account/.test(debugLog()) || sessionShown() === 11,
            { advanceMs: 1000 });
        expect(sessionShown()).toBeNull();

        writeCache('acct-b', usage(22, { name: 'B' }));
        releaseLock(lock);
        await until(() => sessionShown() === 22, { advanceMs: 20 });
        await manual;
    });

    it('drops the old account\'s usage from the screen at once', async () => {
        await h.activate();
        await h.runCommand('claudemeter.fetchNow');
        expect(sessionShown()).toBe(11);
        // The post-switch fetch waits on this lock, so only the switch changes the screen.
        await holdLock(cacheFile());
        writeIdentity({ accountUuid: 'acct-b', organizationUuid: 'org-1', organizationType: 'claude_max' });
        await h.fireIdentityChange();
        expect(sessionShown()).toBeNull();
    });

    it('re-arms the unknown-profile warning', async () => {
        // No plan signal anywhere, so the Tk profile falls through to unknown.
        fs.rmSync(path.join(sb.claudeDir, '.credentials.json'));
        writeIdentity({ accountUuid: 'acct-a' });
        await h.activate();
        expect(contextShown()).toBe('50.0K');
        expect(countLog('profile detection fell through')).toBe(1);
        writeIdentity({ accountUuid: 'acct-b' });
        await h.fireIdentityChange();
        await until(() => countLog('profile detection fell through') === 2);
    });

    it('logs only whether an identity was present, never part of an email', async () => {
        writeIdentity({ emailAddress: 'alice@example.com' });
        await h.activate();
        writeIdentity({ emailAddress: 'bob@example.com' });
        await h.fireIdentityChange();
        await until(() => /Account switched/.test(debugLog()));
        expect(debugLog()).not.toMatch(/alice|bob/);
    });
});

describe('deprecated settings migration', () => {
    it('moves each retired setting to its replacement in every scope, in order', async () => {
        const both = (value) => ({ globalValue: value, workspaceValue: value });
        vscode._setConfigInspectValues('statusBar.use24HourTime', both(true));
        vscode._setConfigInspectValues('statusBar.useCountdownTimer', both(true));
        vscode._setConfigInspectValues('statusBar.useProgressBars', both(true));
        vscode._setConfigInspectValues('statusBar.tokensDisplay', both('both'));
        await h.activate();
        const { Global, Workspace } = vscode.ConfigurationTarget;
        const writes = vscode._getWrittenValues().filter((w) => w.key.startsWith('statusBar.'));
        expect(writes).toEqual([
            { key: 'statusBar.timeFormat', value: '24hour', target: Global },
            { key: 'statusBar.use24HourTime', value: undefined, target: Global },
            { key: 'statusBar.timeFormat', value: '24hour', target: Workspace },
            { key: 'statusBar.use24HourTime', value: undefined, target: Workspace },
            { key: 'statusBar.timeFormat', value: 'countdown', target: Global },
            { key: 'statusBar.useCountdownTimer', value: undefined, target: Global },
            { key: 'statusBar.timeFormat', value: 'countdown', target: Workspace },
            { key: 'statusBar.useCountdownTimer', value: undefined, target: Workspace },
            { key: 'statusBar.usageFormat', value: 'barLight', target: Global },
            { key: 'statusBar.useProgressBars', value: undefined, target: Global },
            { key: 'statusBar.usageFormat', value: 'barLight', target: Workspace },
            { key: 'statusBar.useProgressBars', value: undefined, target: Workspace },
            { key: 'statusBar.tokensDisplay', value: 'extended', target: Global },
            { key: 'statusBar.tokensDisplay', value: 'extended', target: Workspace },
        ]);
    });

    it('leaves a false or unset retired setting alone', async () => {
        vscode._setConfigInspectValues('statusBar.use24HourTime', { globalValue: false });
        vscode._setConfigInspectValues('statusBar.tokensDisplay', { globalValue: 'value' });
        await h.activate();
        expect(vscode._getWrittenValues().filter((w) => w.key.startsWith('statusBar.'))).toEqual([]);
    });
});

describe('legacy settings migration', () => {
    it('selects the profile with the local plan token and a logger', async () => {
        // The ~/.claude.json plan token is the only plan signal here.
        fs.rmSync(path.join(sb.claudeDir, '.credentials.json'));
        writeIdentity({ accountUuid: 'acct-a', organizationType: 'claude_enterprise' });
        vscode._setConfigInspectValues('thresholds.tokens.warning', { globalValue: 70 });
        await h.activate();
        const write = vscode._getWrittenValues().find((w) => w.key === 'thresholds.tokens.profiles');
        expect(Object.keys(write.value)).toEqual(['enterprise']);
        expect(debugLog()).toMatch(/migrated thresholds\.tokens\.warning=70%/);
    });
});

describe('configuration changes', () => {
    it('redraws on any claudemeter setting', async () => {
        await h.activate();
        expect(visibleTexts().some((t) => t.startsWith('Tk '))).toBe(true);
        vscode._setConfigValues({ 'gauges.labels': { tokens: { short: 'Ctx' } } });
        await vscode._fireConfigChange(['claudemeter.gauges.labels']);
        expect(visibleTexts().some((t) => t.startsWith('Ctx '))).toBe(true);
    });

    it('turning tokenOnlyMode on clears web usage and stops the token watcher', async () => {
        await h.activate();
        await h.runCommand('claudemeter.fetchNow');
        expect(sessionShown()).toBe(11);
        vscode._setConfigValues({ tokenOnlyMode: true });
        await vscode._fireConfigChange(['claudemeter.tokenOnlyMode']);
        await settle(20);
        expect(sessionShown()).toBeNull();

        writeCredentials({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x', scopes: [] });
        await settle(200);
        await vi.advanceTimersByTimeAsync(1000);
        await settle();
        expect(debugLog()).not.toMatch(/Credential store changed/);
    });

    it('turning tokenOnlyMode off starts the watcher and fetches without a reload', async () => {
        vscode._setConfigValues({ tokenOnlyMode: true });
        await h.activate();
        expect(sessionShown()).toBeNull();
        writeCredentials({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x', scopes: [] });
        await settle(200);
        await vi.advanceTimersByTimeAsync(1000);
        await settle();
        expect(debugLog()).not.toMatch(/Credential store changed/);

        vscode._setConfigValues({ tokenOnlyMode: false });
        await vscode._fireConfigChange(['claudemeter.tokenOnlyMode']);
        await until(() => sessionShown() === 11);

        writeCredentials({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x', scopes: [] });
        await until(() => /Credential store changed/.test(debugLog()), { advanceMs: 100 });
    });

    it('polls JSONL at the declared 10 s default', async () => {
        await h.activate();
        expect(contextShown()).toBe('50.0K');
        appendTurn(80_000);
        await vi.advanceTimersByTimeAsync(9_000);
        await settle();
        expect(contextShown()).toBe('50.0K');
        await vi.advanceTimersByTimeAsync(1_000);
        await until(() => contextShown() === '80.0K');
    });

    it('re-arms the JSONL poll at a changed interval, replacing the old one', async () => {
        await h.activate();
        vscode._setConfigValues({ localRefreshSeconds: 30 });
        await vscode._fireConfigChange(['claudemeter.localRefreshSeconds']);
        appendTurn(80_000);
        await vi.advanceTimersByTimeAsync(29_000);
        await settle();
        expect(contextShown()).toBe('50.0K');
        await vi.advanceTimersByTimeAsync(1_000);
        await until(() => contextShown() === '80.0K');
    });

    it('caps the shared-cache max age at the 3600 s the refresh timer is capped at', async () => {
        vscode._setConfigValues({ usageRefreshSeconds: 7200 });
        writeCache('acct-a', usage(11, { name: 'A' }), Date.now() - 3599 * 1000);
        await h.activate();
        await h.runCommand('claudemeter.fetchNow');
        expect(sessionShown()).toBe(11);

        // Past the cap the entry is stale, so the fetch waits on the busy lock instead of serving it.
        writeCache('acct-a', usage(22, { name: 'A' }), Date.now() - 3601 * 1000);
        await holdLock(cacheFile());
        const manual = h.runCommand('claudemeter.fetchNow');
        await settle();
        expect(sessionShown()).toBe(11);

        // Once the lock wait times out the stale entry is served as the fallback.
        await until(() => sessionShown() === 22, { advanceMs: 1000 });
        await manual;
    });

    it('re-arms the web refresh at a changed interval, replacing the old one', async () => {
        await h.activate();
        vscode._setConfigValues({ usageRefreshSeconds: 600 });
        await vscode._fireConfigChange(['claudemeter.usageRefreshSeconds']);
        const fetches = countLog('Web usage from shared cache');
        await vi.advanceTimersByTimeAsync(599_000);
        await settle();
        expect(countLog('Web usage from shared cache')).toBe(fetches);
        await vi.advanceTimersByTimeAsync(1_000);
        await until(() => countLog('Web usage from shared cache') === fetches + 1);
        await settle();
        expect(countLog('Web usage from shared cache')).toBe(fetches + 1);
    });
});

describe('Dump State', () => {
    it('reuses one output channel and disposes it with the extension', async () => {
        await h.activate();
        await h.runCommand('claudemeter.dumpState');
        await h.runCommand('claudemeter.dumpState');
        const dumps = vscode._getOutputChannels().filter((c) => c.name === 'Claudemeter - State Dump');
        expect(dumps).toHaveLength(1);
        for (const d of h.context.subscriptions) if (d && typeof d.dispose === 'function') d.dispose();
        expect(dumps[0].disposed).toBe(true);
    });
});
