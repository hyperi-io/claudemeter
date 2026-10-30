//  Project:      Claudemeter
//  File:         tests/e2e/assets.js
//  Purpose:      Regenerate the README screenshots from simulator states in the pinned VS Code
//  Language:     JavaScript (CommonJS)
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED
//
//  Description:
//      Usage: assets.js [--out <dir>]. The output directory defaults to the repo's assets/.
//      Hand-made logos and icons are never touched, only the files in SHOTS.

const fs = require('node:fs');
const path = require('node:path');

const h = require('./harness');
const { ASSET_SCENARIOS, OFFLINE_SETTINGS, seedHome } = require('./fixtures');

const { CheckFailure, Undetermined } = h;

h.watchdog(10);

// One entry per README image. A new state is a new line here and a scenario in fixtures.js.
const SHOTS = [
    { file: 'status-bar-default.png', scenario: 'default', target: 'statusbar' },
    { file: 'status-bar-all-warnings.png', scenario: 'allWarnings', target: 'statusbar' },
    { file: 'tooltip.png', scenario: 'runsOut', target: 'tooltip' },
];

// Twice the pixels, so the circles and text stay sharp when the README scales the image.
const SCALE = 2;

function outputDir() {
    const at = process.argv.indexOf('--out');
    if (at === -1) return path.join(h.ROOT, 'assets');
    const value = process.argv[at + 1];
    if (!value) throw new Undetermined('--out needs a directory');
    return path.resolve(h.ROOT, value);
}

const gauge = (items, label) => h.itemByText(items, new RegExp(`^${label} `));

// Crops to the claudemeter cluster, so the shot carries none of the editor's own status items.
async function statusBarShot(page, file) {
    await h.dismissHover(page);
    const items = await h.waitForItems(page, (all) => gauge(all, 'Se') && gauge(all, 'Tk'), 'the Se and Tk gauges');
    // The strip and the dots are icon-font glyphs, so none drawn means the font did not load and the shot would be wrong.
    const icons = (label) => gauge(items, label).icons.filter((n) => n.startsWith('claudemeter-'));
    for (const label of ['Se', 'Wk', 'Tk']) {
        if (icons(label).length !== 5) {
            throw new Undetermined(`${label} drew ${icons(label).length} icon-font glyphs instead of 5, so the shot would not match`);
        }
    }
    console.log(`gauges: Se ${icons('Se').join(' ')} | Wk ${icons('Wk').join(' ')} | Tk ${icons('Tk').join(' ')}`);
    const pad = 6;
    const left = Math.min(...items.map((i) => i.box.x)) - pad;
    const right = Math.max(...items.map((i) => i.box.x + i.box.width)) + pad;
    const top = Math.min(...items.map((i) => i.box.y));
    const height = Math.max(...items.map((i) => i.box.height));
    await page.screenshot({ path: file, clip: { x: left, y: top, width: right - left, height } });
}

// A tooltip refresh can close the hover under the shot, so the chart must be decoded and the hover
// still open after the capture, or the hover is opened again. Never writes a blank asset.
async function tooltipShot(page, file) {
    let seen = 'hover closed after the shot';
    for (let attempt = 0; attempt < 3; attempt++) {
        const hover = await h.hoverItem(page, gauge(await h.readStatusBar(page), 'Se'), /Session - /);
        // The chart decodes after the hover opens.
        const chart = hover.locator('img[width="240"]').first();
        const decoded = () => chart.evaluate((el) => el.naturalWidth > 0, undefined, { timeout: 1_000 }).catch(() => false);
        for (let i = 0; i < 20 && !(await decoded()); i++) await h.sleep(500);
        if (await decoded()) {
            await h.shootHover(page, hover, file);
            const held = await decoded();
            await h.dismissHover(page);
            if (held) return;
        } else {
            seen = await hover.evaluate((el) => [...el.querySelectorAll('img')].map((i) => `${i.getAttribute('width')}:${i.naturalWidth}`).join(' ')).catch((e) => e.message.slice(0, 80));
            await h.dismissHover(page);
        }
    }
    throw new Error(`tooltip.png: the chart was not captured with the hover open, three times (images: ${seen})`);
}

const sizeOf = (file) => (fs.existsSync(file) ? fs.statSync(file).size : null);

async function main() {
    const out = outputDir();
    fs.mkdirSync(out, { recursive: true });
    h.buildBundle();
    const session = await h.launch({
        name: 'asset-run',
        seed: seedHome,
        settings: OFFLINE_SETTINGS,
        args: [`--force-device-scale-factor=${SCALE}`],
    });
    const rows = [];
    try {
        await h.waitForItems(session.page, (all) => gauge(all, 'Se'), 'the Se gauge from the seeded cache');
        let applied = null;
        for (const shot of SHOTS) {
            const scenario = ASSET_SCENARIOS[shot.scenario];
            if (!scenario) throw new CheckFailure(`${shot.file}: no scenario named ${shot.scenario}`);
            if (applied !== shot.scenario) {
                await h.applyScenario(session, scenario);
                await h.sleep(1_500);
                applied = shot.scenario;
            }
            const file = path.join(out, shot.file);
            const before = sizeOf(path.join(h.ROOT, 'assets', shot.file));
            const take = shot.target === 'tooltip' ? tooltipShot : statusBarShot;
            await take(session.page, file);
            rows.push({ file: shot.file, before, after: sizeOf(file) });
        }
    } finally {
        await session.close();
    }
    for (const r of rows) {
        console.log(`${r.file}: ${r.before === null ? 'not in assets/' : `${r.before} B in assets/`} -> ${r.after} B`);
    }
    console.log(`written to ${out}`);
}

main().then(
    () => {
        console.log('RESULT: pass');
        process.exit(h.EXIT.pass);
    },
    (error) => {
        const verdict = error instanceof CheckFailure ? 'fail' : 'undetermined';
        console.log(`RESULT: ${verdict}\n${error instanceof CheckFailure || error instanceof Undetermined ? error.message : error.stack}`);
        process.exit(verdict === 'fail' ? h.EXIT.fail : h.EXIT.undetermined);
    },
);
