//  Project:      Claudemeter
//  File:         tests/e2e/harness.js
//  Purpose:      Launch a throwaway VS Code with the extension loaded from source and read its status bar
//  Language:     JavaScript (CommonJS)
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { downloadAndUnzipVSCode, SilentReporter } = require('@vscode/test-electron');
const { _electron: electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRATCH = path.join(ROOT, '.hyperi-ai', 'tmp', 'e2e');
const CACHE = path.join(ROOT, '.vscode-test');

// Pinned so the workbench DOM the harness reads does not change between runs.
const VSCODE_VERSION = '1.143.1';
const THEME = 'Default Dark Modern';
const WINDOW = { width: 1440, height: 900 };

const EXIT = { pass: 0, fail: 1, undetermined: 2 };

// The check ran and the extension did the wrong thing.
class CheckFailure extends Error {}

// The check could not run to a verdict: no display, no download, nothing drawn.
class Undetermined extends Error {}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const paths = (name) => {
    const root = path.join(SCRATCH, name);
    return {
        root,
        userData: path.join(root, 'user-data'),
        extensions: path.join(root, 'extensions'),
        workspace: path.join(root, 'workspace'),
        home: path.join(root, 'home'),
        scenario: path.join(root, 'scenario.json'),
        shots: path.join(SCRATCH, 'shots'),
    };
};

// Variables that would hand the launched VS Code the caller's identity or a parent VS Code's session.
const DROPPED = [/^VSCODE_/, /^CLAUDE/, /^ANTHROPIC_/, /^ELECTRON_RUN_AS_NODE$/];

// True when an Xvfb server owns DISPLAY, read from the running Xvfb processes' arguments.
function isXvfbDisplay(display) {
    const number = /^:(\d+)/.exec(display ?? '')?.[1];
    if (number === undefined) return false;
    const out = spawnSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
    return out.stdout.split('\n').some((args) => new RegExp(`^\\S*Xvfb :${number}(\\s|$)`).test(args));
}

function launchEnv(dirs, isolated, extra) {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined || DROPPED.some((re) => re.test(key))) continue;
        env[key] = value;
    }
    // Electron draws on Wayland whenever WAYLAND_DISPLAY is set, which would put the window on the desktop.
    if (isXvfbDisplay(env.DISPLAY)) {
        delete env.WAYLAND_DISPLAY;
        env.XDG_SESSION_TYPE = 'x11';
    }
    if (isolated) {
        env.HOME = dirs.home;
        env.XDG_CONFIG_HOME = path.join(dirs.home, '.config');
        env.XDG_CACHE_HOME = path.join(dirs.home, '.cache');
        env.XDG_DATA_HOME = path.join(dirs.home, '.local', 'share');
    }
    return { ...env, ...extra };
}

// GNOME keeps its interface font in dconf, and Chromium draws system-ui in it. An empty HOME hides
// that, so the status bar falls back to another font and the gauge circles come from a third.
function copyDesktopSettings(dirs) {
    const real = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const source = path.join(real, 'dconf', 'user');
    if (!fs.existsSync(source)) return;
    const target = path.join(dirs.home, '.config', 'dconf');
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(source, path.join(target, 'user'));
}

function writeSettings(dirs, extra) {
    const settings = {
        'chat.disableAIFeatures': true,
        'extensions.autoCheckUpdates': false,
        'extensions.autoUpdate': false,
        'git.enabled': false,
        'security.workspace.trust.enabled': false,
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'window.zoomLevel': 0,
        'workbench.colorTheme': THEME,
        'workbench.startupEditor': 'none',
        'workbench.secondarySideBar.defaultVisibility': 'hidden',
        'workbench.tips.enabled': false,
        // The simulator commands are hidden unless this is on.
        'claudemeter.debug': true,
        ...extra,
    };
    fs.mkdirSync(path.join(dirs.userData, 'User'), { recursive: true });
    fs.writeFileSync(
        path.join(dirs.userData, 'User', 'settings.json'),
        JSON.stringify(settings, null, 2),
        { encoding: 'utf8' },
    );
}

// Matches on the profile directory, so only this harness's processes are swept.
function pidsOfProfile(dirs) {
    const out = spawnSync('pgrep', ['-f', `[u]ser-data-dir=${dirs.userData}`], { encoding: 'utf8' });
    return out.stdout.split('\n').filter(Boolean).map(Number);
}

// The process that owns the window. Signalling it lets VS Code tear down its children, where
// signalling every child first makes the window report that it terminated unexpectedly.
function mainPidsOfProfile(dirs) {
    return pidsOfProfile(dirs).filter((pid) => {
        const out = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
        return out.stdout.trim() !== '' && !out.stdout.includes('--type=');
    });
}

function killAll(dirs) {
    const stuck = pidsOfProfile(dirs);
    for (const pid of stuck) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch { /* already gone */ }
    }
    return stuck.length;
}

// Every profile launched and not yet closed, swept if this process dies for any reason.
const launched = new Set();

process.on('exit', () => {
    for (const dirs of launched) killAll(dirs);
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => process.exit(EXIT.undetermined));
}

// A run that outlives its budget is reported as undetermined, and its windows go with it.
function watchdog(minutes) {
    setTimeout(() => {
        console.log(`RESULT: undetermined\nthe run passed its ${minutes} min budget`);
        process.exit(EXIT.undetermined);
    }, minutes * 60_000).unref();
}

async function closeAndSweep(app, dirs) {
    if (app !== undefined) {
        await Promise.race([app.close().catch(() => undefined), sleep(15_000)]);
    }
    for (let i = 0; i < 10 && pidsOfProfile(dirs).length > 0; i++) await sleep(500);
    launched.delete(dirs);
    return killAll(dirs);
}

async function downloadVSCode() {
    try {
        return await downloadAndUnzipVSCode({
            version: VSCODE_VERSION,
            cachePath: CACHE,
            reporter: new SilentReporter(),
        });
    } catch (error) {
        throw new Undetermined(`VS Code ${VSCODE_VERSION} download failed: ${error.message}`);
    }
}

/**
 * Start VS Code and wait for the workbench.
 *
 * @param {object} options
 * @param {string} options.name Profile directory name under the scratch root.
 * @param {boolean} [options.isolated] Give the extension an empty HOME (default). False uses the caller's.
 * @param {(dirs: object) => void} [options.seed] Writes files into the profile before launch.
 * @param {object} [options.settings] Extra user settings.
 * @param {object} [options.env] Extra environment for VS Code.
 * @param {string[]} [options.args] Extra Electron arguments, such as the device scale factor.
 * @returns {Promise<{app, page, dirs, close: () => Promise<number>}>}
 */
async function launch({ name, isolated = true, seed = () => {}, settings = {}, env = {}, args = [] }) {
    const exe = await downloadVSCode();
    const dirs = paths(name);
    if (pidsOfProfile(dirs).length > 0) {
        throw new Undetermined(`a window for the "${name}" profile is already open`);
    }
    fs.rmSync(dirs.root, { recursive: true, force: true });
    for (const dir of [dirs.workspace, dirs.home, dirs.extensions, dirs.shots]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    writeSettings(dirs, settings);
    if (isolated) copyDesktopSettings(dirs);
    seed(dirs);

    launched.add(dirs);
    let app;
    try {
        app = await electron.launch({
            executablePath: exe,
            args: [
                dirs.workspace,
                `--extensionDevelopmentPath=${ROOT}`,
                `--user-data-dir=${dirs.userData}`,
                `--extensions-dir=${dirs.extensions}`,
                '--new-window',
                '--disable-workspace-trust',
                '--skip-welcome',
                '--skip-release-notes',
                '--disable-telemetry',
                '--disable-updates',
                '--disable-gpu',
                ...args,
            ],
            env: launchEnv(dirs, isolated, { CLAUDEMETER_SIMULATE_FILE: dirs.scenario, ...env }),
            timeout: 60_000,
        });
        const page = await app.firstWindow();
        await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });
        await app.evaluate(({ BrowserWindow }, [w, h]) => {
            const win = BrowserWindow.getAllWindows()[0];
            win?.unmaximize();
            win?.setSize(w, h);
        }, [WINDOW.width, WINDOW.height]);
        await sleep(1_000);
        return { app, page, dirs, close: () => closeAndSweep(app, dirs) };
    } catch (error) {
        await closeAndSweep(app, dirs);
        throw new Undetermined(`VS Code did not start: ${error.message}`);
    }
}

// Keys are typed only once the palette input holds focus, so none can reach an editor.
async function runPaletteCommand(page, title) {
    const widget = page.locator('.quick-input-widget');
    const never = () => false;
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (!ready && Date.now() < deadline) {
        await page.keyboard.press('ControlOrMeta+Shift+P');
        const shown = await widget.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, never);
        ready = shown && await page.evaluate(
            () => document.activeElement?.closest('.quick-input-widget') != null,
        );
        if (!ready) await sleep(1_000);
    }
    if (!ready) throw new Undetermined('the command palette did not open');
    await page.keyboard.type(title);
    const offered = await page.locator('.quick-input-list .monaco-list-row.focused')
        .filter({ hasText: title })
        .waitFor({ timeout: 5_000 })
        .then(() => true, never);
    if (!offered) {
        await page.keyboard.press('Escape');
        throw new Undetermined(`the command palette did not offer "${title}"`);
    }
    await page.keyboard.press('Enter');
    await widget.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
}

// Runs in the page. Claudemeter's items are the visible ones whose id names the extension, left to right.
function readItems() {
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    return [...document.querySelectorAll('.statusbar-item')]
        .filter((el) => /claudemeter/i.test(el.id || '') && visible(el))
        .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
        .map((el, index) => {
            const label = el.querySelector('.statusbar-item-label') ?? el;
            const r = el.getBoundingClientRect();
            // Icons draw from a CSS pseudo-element, so they add nothing to the text and are read by class.
            const icons = [...label.querySelectorAll('.codicon')]
                .map((span) => [...span.classList].find((c) => c.startsWith('codicon-') && !c.startsWith('codicon-modifier')))
                .filter(Boolean)
                .map((c) => c.slice('codicon-'.length));
            return {
                index,
                id: el.id,
                icons,
                text: (label.textContent ?? '').replace(/\s+/g, ' ').trim(),
                color: getComputedStyle(label).color,
                box: { x: r.x, y: r.y, width: r.width, height: r.height },
            };
        });
}

const readStatusBar = (page) => page.evaluate(readItems);

// The theme's own colours for each tier, resolved the way the status bar resolves them.
const readThemeColors = (page) => page.evaluate(() => {
    // The theme variables are set on the workbench element, not the root.
    const style = getComputedStyle(document.querySelector('.monaco-workbench'));
    const read = (name) => {
        const probe = document.createElement('span');
        probe.style.color = style.getPropertyValue(name).trim();
        document.body.appendChild(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
    };
    return {
        foreground: read('--vscode-statusBar-foreground'),
        warning: read('--vscode-charts-yellow'),
        error: read('--vscode-claudemeter-outageRed'),
        rotLight: read('--vscode-claudemeter-rotLight'),
        rotDeep: read('--vscode-claudemeter-rotDeep'),
    };
});

// A timeout is Undetermined: the extension drew nothing to judge.
async function waitForItems(page, predicate, what, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let items = [];
    while (Date.now() < deadline) {
        items = await readStatusBar(page);
        if (predicate(items)) return items;
        await sleep(500);
    }
    const seen = items.map((i) => i.text).join(' | ') || 'no claudemeter items';
    throw new Undetermined(`${what} did not appear in ${timeoutMs / 1000}s (status bar: ${seen})`);
}

// The font the gauge circles in one item were drawn with, read from Chromium's own font matching.
async function glyphFonts(page, item) {
    const cdp = await page.context().newCDPSession(page);
    try {
        await cdp.send('DOM.enable');
        await cdp.send('CSS.enable');
        const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
        const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
            nodeId: root.nodeId,
            selector: '.statusbar-item .statusbar-item-label',
        });
        for (const nodeId of nodeIds) {
            const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId });
            if (outerHTML.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() !== item.text) continue;
            const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
            return fonts.map((f) => ({ family: f.familyName, glyphs: f.glyphCount }));
        }
        return [];
    } finally {
        await cdp.detach().catch(() => undefined);
    }
}

async function applyScenario(session, scenario) {
    fs.writeFileSync(session.dirs.scenario, JSON.stringify(scenario), 'utf8');
    await runPaletteCommand(session.page, 'Simulate Scenario From File');
    // The command re-reads the transcript and redraws asynchronously.
    await sleep(1_500);
}

const itemByText = (items, pattern) => items.find((i) => pattern.test(i.text));

const hoverLocator = (page, expected) => page
    .locator('.monaco-hover.workbench-hover')
    .filter({ visible: true, hasText: expected });

// The status bar's tooltip, shown by resting the pointer on the item.
async function hoverItem(page, item, expected) {
    await page.mouse.move(0, 0);
    await sleep(300);
    const x = item.box.x + item.box.width / 2;
    const y = item.box.y + item.box.height / 2;
    await page.mouse.move(x - 2, y);
    await page.mouse.move(x, y, { steps: 4 });
    const hover = hoverLocator(page, expected ?? /\S/).first();
    try {
        await hover.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
        throw new Undetermined(`no hover${expected ? ` containing ${expected}` : ''} appeared over "${item.text}"`);
    }
    // The markdown renders its images after the first paint.
    await sleep(500);
    return hover;
}

// Shoots the open hover by its box. Locator.screenshot closes a tall hover, because it scrolls the page to fit it.
async function shootHover(page, hover, file) {
    const box = await hover.boundingBox({ timeout: 5_000 });
    if (!box) throw new Undetermined('the hover has no box to shoot');
    await page.screenshot({ path: file, clip: box });
}

async function dismissHover(page) {
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    await sleep(300);
}

// Stops the window started with this profile, found by its user-data-dir and never by name. The
// owning process gets a polite signal first, and whatever is left after 10s is killed.
async function stopProfile(name) {
    const dirs = paths(name);
    const mains = mainPidsOfProfile(dirs);
    for (const pid of mains) {
        try {
            process.kill(pid, 'SIGTERM');
        } catch { /* already gone */ }
    }
    for (let i = 0; i < 20 && pidsOfProfile(dirs).length > 0; i++) await sleep(500);
    return mains.length + killAll(dirs);
}

// The bundle is what VS Code loads, so it is rebuilt before every run.
function buildBundle() {
    execFileSync('node', ['esbuild.js'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
}

module.exports = {
    ROOT,
    SCRATCH,
    THEME,
    WINDOW,
    VSCODE_VERSION,
    EXIT,
    CheckFailure,
    Undetermined,
    sleep,
    launch,
    runPaletteCommand,
    readStatusBar,
    readThemeColors,
    waitForItems,
    applyScenario,
    itemByText,
    hoverItem,
    hoverLocator,
    glyphFonts,
    dismissHover,
    shootHover,
    buildBundle,
    stopProfile,
    watchdog,
};
