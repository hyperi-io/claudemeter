//  Project:      Claudemeter
//  File:         tests/e2e/run.js
//  Purpose:      Drive a throwaway VS Code through the simulator states and check the status bar and tooltip
//  Language:     JavaScript (CommonJS)
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED
//
//  Description:
//      Exit 0 is a pass, 1 a fail and 2 could-not-determine. --live skips the simulator and
//      reads the real login, so it needs the caller's credentials and a network.

const fs = require('node:fs');
const path = require('node:path');

const { TIER_RECOMMENDATIONS } = require('../../src/tk/recommendations');
const h = require('./harness');
const { OFFLINE_SETTINGS, SCENARIOS, seedHome } = require('./fixtures');

const { CheckFailure, Undetermined } = h;

const LIVE = process.argv.includes('--live');
h.watchdog(15);
const TK_LABEL = /^Tk /;

const parseRgb = (css) => (css.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
const sameColor = (a, b) => parseRgb(a).join() === parseRgb(b).join();

function check(condition, message) {
    if (!condition) throw new CheckFailure(message);
}

const gauge = (items, label) => h.itemByText(items, new RegExp(`^${label} `));

// How each scenario should draw. A tier is the colour a gauge must have, 'rot' is the gradient between the rot tiers.
// The percentages are what the tooltip must name. A shape is 'dots', 'strip' or the exact glyph names, and clock names
// the countdown icon (history by default). pace is the text the Wk gauge must end with, absent when it shows none.
const DOTS = { se: 'dots', wk: 'dots', tk: 'dots' };
const EXPECTED = {
    normal: { se: 'normal', wk: 'normal', tk: 'normal', tier: 'normal', session: 8, weekly: 40, context: 12 },
    warning: { se: 'warning', wk: 'warning', tk: 'warning', tier: 'warning', session: 85, weekly: 82, context: 95 },
    error: { se: 'error', wk: 'error', tk: 'error', tier: 'error', session: 95, weekly: 93, context: 97 },
    rotLight: { se: 'normal', wk: 'normal', tk: 'rot', tier: 'rotLight', session: 20, weekly: 45, context: 45 },
    rotDeep: { se: 'normal', wk: 'normal', tk: 'rot', tier: 'rotDeep', session: 20, weekly: 45, context: 70 },
    rotLightForced: { se: 'normal', wk: 'normal', tk: 'rotLight', tier: 'rotLight', session: 20, weekly: 45, context: 45 },
    rotDeepForced: { se: 'normal', wk: 'normal', tk: 'rotDeep', tier: 'rotDeep', session: 20, weekly: 45, context: 70 },
};
for (const want of Object.values(EXPECTED)) want.shape = DOTS;

Object.assign(EXPECTED, {
    stripNormal: {
        se: 'normal', wk: 'normal', tk: 'normal', tier: 'normal', session: 20, weekly: 40, context: 12,
        shape: { se: ['bar-1', 'bar-2', 'barh-3', 'barh-4', 'barh-4'], wk: 'strip', tk: 'strip' },
        sentences: [/^Se 50% at reset$/, /^Wk 40% at reset$/, /^Tk compacts in \S+$/],
    },
    stripRunsOut: {
        se: 'warning', wk: 'normal', tk: 'normal', tier: 'normal', session: 72, weekly: 70, context: 12,
        shape: { se: ['bar-4', 'bar-6', 'barh-8', 'blocked', 'blocked'], wk: 'strip', tk: 'strip' },
        pace: '+13',
        sentences: [/^Se out in \d+m, \d+h\d\d blocked$/, /^Wk 70% at reset$/, /^Tk compacts in \S+$/],
    },
    stripMeasuring: {
        se: 'normal', wk: 'normal', tk: 'normal', tier: 'normal', session: 20, weekly: 40, context: 12,
        shape: DOTS,
        sentences: [],
    },
    stripTk: {
        se: 'normal', wk: 'normal', tk: 'rot', tier: 'rotLight', session: 20, weekly: 40, context: 50,
        shape: { se: 'dots', wk: 'dots', tk: ['bar-3', 'bar-4', 'barh-6', 'barh-7', 'barh-8'] },
        sentences: [/^Tk compacts in \S+$/],
    },
});

const glyphNames = (item) => item.icons.filter((n) => n.startsWith('claudemeter-')).map((n) => n.slice('claudemeter-'.length));
const GLYPHS = { strip: /^(bar|barh)-[1-8]$|^blocked$/, dots: /^dot(-empty)?$/ };

function shapeProblem(kind, item, label) {
    const names = glyphNames(item);
    if (Array.isArray(kind)) {
        return names.join(' ') === kind.join(' ') ? null : `${label} draws ${names.join(' ') || 'no icons'}, wanted ${kind.join(' ')}`;
    }
    return names.length === 5 && names.every((n) => GLYPHS[kind].test(n)) ? null : `${label} draws ${names.join(' ') || 'no icons'}, wanted a ${kind} of 5`;
}

function clockProblem(kind, item, label) {
    const other = kind === 'watch' ? 'history' : 'watch';
    return item.icons.includes(kind) && !item.icons.includes(other) ? null : `${label} clock icons are ${item.icons.join(' ')}, wanted ${kind}`;
}

function paceProblem(pace, item) {
    const shown = item.text.match(/ (\+\d+)$/)?.[1] ?? null;
    return shown === (pace ?? null) ? null : `Wk pace reads ${shown}, wanted ${pace ?? 'none'} (${item.text})`;
}

// Text lines from a tier's recommendation, which the tooltip prints only while that tier is active.
const recommendation = (tier) => (TIER_RECOMMENDATIONS[tier] ?? '').split('  \n')[0];
const ALL_RECOMMENDATIONS = ['rotLight', 'rotDeep', 'warning', 'error'].map(recommendation);

function colorProblem(kind, item, theme, label) {
    const colour = item.color;
    switch (kind) {
        case 'normal':
            return sameColor(colour, theme.foreground) ? null : `${label} is ${colour}, wanted the foreground ${theme.foreground}`;
        case 'rot': {
            const plain = [theme.foreground, theme.warning, theme.error].some((c) => sameColor(colour, c));
            return plain ? `${label} is ${colour}, wanted a rot blue` : null;
        }
        default:
            return sameColor(colour, theme[kind]) ? null : `${label} is ${colour}, wanted ${kind} ${theme[kind]}`;
    }
}

async function statusBarShot(page, items, file) {
    await h.dismissHover(page);
    const pad = 4;
    const left = Math.min(...items.map((i) => i.box.x)) - pad;
    const right = Math.max(...items.map((i) => i.box.x + i.box.width)) + pad;
    const top = Math.min(...items.map((i) => i.box.y));
    const height = Math.max(...items.map((i) => i.box.height));
    await page.screenshot({ path: file, clip: { x: left, y: top, width: right - left, height } });
}

// Waits for the status bar to draw what the scenario asks for, then returns it. A scenario that never lands is the extension ignoring it.
async function settle(session, name) {
    const want = EXPECTED[name];
    const theme = await h.readThemeColors(session.page);
    const deadline = Date.now() + 20_000;
    let problem = 'status bar not read';
    while (Date.now() < deadline) {
        const items = await h.readStatusBar(session.page);
        const se = gauge(items, 'Se');
        const wk = gauge(items, 'Wk');
        const tk = gauge(items, 'Tk');
        if (se && wk && tk && TK_LABEL.test(tk.text)) {
            problem = colorProblem(want.se, se, theme, 'Se')
                ?? colorProblem(want.wk, wk, theme, 'Wk')
                ?? colorProblem(want.tk, tk, theme, 'Tk')
                ?? shapeProblem(want.shape.se, se, 'Se')
                ?? shapeProblem(want.shape.wk, wk, 'Wk')
                ?? shapeProblem(want.shape.tk, tk, 'Tk')
                ?? clockProblem(want.clock?.se ?? 'history', se, 'Se')
                ?? clockProblem(want.clock?.wk ?? 'history', wk, 'Wk')
                ?? paceProblem(want.pace, wk);
            if (problem === null) return items;
        } else {
            problem = `status bar read ${items.map((i) => i.text).join(' | ')}`;
        }
        await h.sleep(500);
    }
    throw new CheckFailure(`${name}: ${problem}`);
}

async function checkScenario(session, name, report) {
    const want = EXPECTED[name];
    await h.applyScenario(session, SCENARIOS[name]);
    const items = await settle(session, name);
    const se = gauge(items, 'Se');

    if (name === 'rotDeep' || name === 'rotDeepForced') {
        const light = report.rotLightColor;
        const deep = parseRgb(gauge(items, 'Tk').color);
        check(light !== undefined, `${name}: no rotLight colour to compare against`);
        const bluer = (c) => c[2] - c[0];
        check(bluer(deep) > bluer(light), `${name}: Tk rgb(${deep}) is no bluer than rotLight rgb(${light})`);
    }
    if (name === 'rotLight') report.rotLightColor = parseRgb(gauge(items, 'Tk').color);

    await statusBarShot(session.page, items, path.join(session.dirs.shots, `${name}-statusbar.png`));
    const hover = await h.hoverItem(session.page, se, /Session - /);
    const text = await hover.innerText();
    // The shot comes after the live checks, because the hover closes soon after a screenshot.
    if (want.sentences) await checkChart(hover, name, want, report);
    await h.shootHover(session.page, hover, path.join(session.dirs.shots, `${name}-tooltip.png`));
    check(/Zaphod/.test(text), `${name}: tooltip does not name the seeded account`);
    for (const [heading, percent] of [['Session', want.session], ['Weekly', want.weekly], ['Current context', want.context]]) {
        const line = text.split('\n').find((l) => l.startsWith(heading));
        check(line === `${heading} - ${percent}%`, `${name}: tooltip reads "${line}", wanted "${heading} - ${percent}%"`);
    }
    const named = recommendation(want.tier);
    if (named) check(text.includes(named), `${name}: tooltip lacks "${named}"`);
    for (const other of ALL_RECOMMENDATIONS.filter((r) => r !== named)) {
        check(!text.includes(other), `${name}: tooltip carries the wrong tier text "${other}"`);
    }
    await h.dismissHover(session.page);
    report.lines.push(`${name}: ${items.filter((i) => i.text !== 'Claude').reverse().map((i) => `${i.text} [${glyphNames(i).join(' ')}] ${i.color}`).join(' | ')}`);
}

// The chart image in the open tooltip: a PNG data URI drawn at twice its shown size, with the range links and the sentences.
async function checkChart(hover, name, want, report) {
    // The image decodes and the hover settles a moment after it opens, and a tooltip refresh can reopen it.
    const read = () => hover.locator('img[width="240"]').first().evaluate((el) => ({
        src: el.src.slice(0, 22),
        alt: el.alt,
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
        width: Math.round(el.getBoundingClientRect().width),
        height: Math.round(el.getBoundingClientRect().height),
    }), undefined, { timeout: 1_000 }).catch(() => null);
    let m = await read();
    for (let i = 0; i < 20 && !(m && m.naturalWidth > 0 && m.width > 0); i++) {
        await h.sleep(500);
        m = await read();
    }
    if (!m) {
        const seen = await hover.evaluate((el) => `${[...el.querySelectorAll('img')].map((i) => `[${i.alt.slice(0, 30)}|${i.naturalWidth}]`).join('')} ${el.innerText.replace(/\s+/g, ' ').slice(0, 160)}`).catch((e) => `hover gone: ${e.message.slice(0, 80)}`);
        throw new CheckFailure(`${name}: the tooltip has no chart image (${seen})`);
    }
    check(m.src === 'data:image/png;base64,', `${name}: the chart src starts "${m.src}"`);
    check(m.naturalWidth === 480 && m.naturalHeight === 256, `${name}: the chart PNG is ${m.naturalWidth}x${m.naturalHeight}, wanted 480x256`);
    check(m.width === 240 && m.height === 128, `${name}: the chart shows at ${m.width}x${m.height}, wanted 240x128, so <img width> did not apply`);

    const sentences = m.alt ? m.alt.split('; ') : [];
    check(sentences.length === want.sentences.length, `${name}: the chart alt has ${sentences.length} sentences, wanted ${want.sentences.length} (${m.alt})`);
    // The sentences print wrapped, so they are matched across line breaks, and no wrapped line may be wider than the chart.
    const text = await hover.innerText();
    const flat = text.replace(/\s+/g, ' ');
    want.sentences.forEach((pattern, i) => {
        check(pattern.test(sentences[i]), `${name}: alt sentence ${i + 1} reads "${sentences[i]}"`);
        check(flat.includes(sentences[i]), `${name}: the sentence "${sentences[i]}" is not printed under the chart`);
    });
    const hoverWidth = await hover.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    check(hoverWidth < 2 * m.width, `${name}: the tooltip is ${hoverWidth}px wide for a ${m.width}px chart, so a line is not wrapping`);
    report.lines.push(`${name} chart: ${m.naturalWidth}x${m.naturalHeight} shown ${m.width}x${m.height}, tooltip ${hoverWidth}px wide`);
}

async function checkGlyphFont(session, report) {
    const items = await h.readStatusBar(session.page);
    const fonts = await h.glyphFonts(session.page, gauge(items, 'Se'));
    check(fonts.length > 0, 'no font was read for the Se gauge');
    report.lines.push(`gauge fonts: ${fonts.map((f) => `${f.family} x${f.glyphs}`).join(', ')}`);
}

async function checkNopilotLinks(session, report) {
    const { page } = session;
    await h.applyScenario(session, SCENARIOS.normal);
    const items = await h.waitForItems(page, (all) => gauge(all, 'Se') && gauge(all, 'Tk'), 'the Se and Tk gauges');
    const hover = await h.hoverItem(page, gauge(items, 'Se'), /Nopilot/);
    const link = hover.getByRole('link', { name: /Nopilot - disable/ });
    await link.click({ timeout: 10_000 });
    const picker = page.locator('.quick-input-widget').filter({ visible: true });
    await picker.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
        throw new CheckFailure('clicking the Nopilot link opened no quick pick');
    });
    report.lines.push(`nopilot link: opened a quick pick headed "${(await picker.innerText()).split('\n')[0]}"`);
    await page.screenshot({ path: path.join(session.dirs.shots, 'nopilot-quickpick.png') });
    await page.keyboard.press('Escape');
    await picker.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);

    const again = await h.hoverItem(page, gauge(await h.readStatusBar(page), 'Se'), /Nopilot/);
    await again.getByRole('link', { name: /\(hide\)/ }).click({ timeout: 10_000 });
    const toast = page.locator('.notifications-toasts').getByText(/Nopilot hidden/);
    await toast.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
        throw new CheckFailure('clicking (hide) showed no "Nopilot hidden" notice');
    });
    const file = path.join(session.dirs.userData, 'User', 'settings.json');
    const deadline = Date.now() + 10_000;
    let written = false;
    while (!written && Date.now() < deadline) {
        written = fs.readFileSync(file, 'utf8').includes('"claudemeter.nopilot.enabled": false');
        if (!written) await h.sleep(300);
    }
    check(written, 'clicking (hide) did not write claudemeter.nopilot.enabled=false to settings.json');
    await h.dismissHover(page);
    // The tooltip holds for up to 30s between changes, so the offer leaves on the next refresh.
    const gone = Date.now() + 45_000;
    let offered = true;
    while (offered && Date.now() < gone) {
        const after = await h.hoverItem(page, gauge(await h.readStatusBar(page), 'Se'), /Session - /);
        offered = /Nopilot/.test(await after.innerText());
        await h.dismissHover(page);
        if (offered) await h.sleep(3_000);
    }
    check(!offered, 'the Nopilot offer is still in the tooltip 45s after (hide)');
    report.lines.push('hide link: notice shown, setting written, offer gone from the tooltip');
}

// Light theme: the chart draws with the light palette.
async function checkChartLight(session, report) {
    const { page } = session;
    await h.applyScenario(session, SCENARIOS.stripRunsOut);
    const items = await h.waitForItems(page, (all) => gauge(all, 'Se') && gauge(all, 'Tk'), 'the Se and Tk gauges');
    const hover = await h.hoverItem(page, gauge(items, 'Se'), /Session - /);
    await checkChart(hover, 'light', EXPECTED.stripRunsOut, report);
    await h.shootHover(page, hover, path.join(session.dirs.shots, 'chart-light-tooltip.png'));
    await h.dismissHover(page);
}

async function checkLive(session, report) {
    const items = await h.waitForItems(session.page, (all) => gauge(all, 'Se') && gauge(all, 'Wk'), 'the Se and Wk gauges from the real login', 90_000);
    check(glyphNames(gauge(items, 'Se')).length === 5, `Se draws ${glyphNames(gauge(items, 'Se')).join(' ') || 'no icons'}, wanted 5 glyphs`);
    const hover = await h.hoverItem(session.page, gauge(items, 'Se'), /Session - \d+%/);
    check(/Weekly - \d+%/.test(await hover.innerText()), 'the live tooltip has no weekly line');
    report.lines.push(`live: ${items.map((i) => i.text.replace(/\d+[hdm].*$/, '').trim()).join(' | ')}`);
    const fonts = await h.glyphFonts(session.page, gauge(items, 'Se'));
    report.lines.push(`gauge fonts: ${fonts.map((f) => `${f.family} x${f.glyphs}`).join(', ')}`);
}

// Each check is one verdict. A failure keeps the rest running, an undetermined check is reported as such.
async function runChecks(checks, results) {
    for (const { name, run } of checks) {
        const started = Date.now();
        try {
            await run();
            results.push({ name, verdict: 'pass', ms: Date.now() - started });
        } catch (error) {
            const verdict = error instanceof CheckFailure ? 'fail' : 'undetermined';
            results.push({ name, verdict, detail: error.message, ms: Date.now() - started });
            if (verdict === 'undetermined') return;
        }
    }
}

async function withSession(options, work, results) {
    let session;
    try {
        session = await h.launch(options);
        await work(session);
    } catch (error) {
        const verdict = error instanceof CheckFailure ? 'fail' : 'undetermined';
        results.push({ name: options.name, verdict, detail: error.message, ms: 0 });
    } finally {
        if (session) {
            const killed = await session.close();
            if (killed > 0) console.log(`killed ${killed} straggler process(es) for ${options.name}`);
        }
    }
}

async function main() {
    const results = [];
    const report = { lines: [] };
    try {
        h.buildBundle();
    } catch (error) {
        results.push({ name: 'build', verdict: 'undetermined', detail: `esbuild failed: ${error.message}`, ms: 0 });
    }

    if (results.length === 0 && LIVE) {
        await withSession({ name: 'live', isolated: false }, async (session) => {
            await runChecks([{ name: 'live status bar and tooltip', run: () => checkLive(session, report) }], results);
        }, results);
    } else if (results.length === 0) {
        await withSession({ name: 'main', seed: seedHome, settings: OFFLINE_SETTINGS }, async (session) => {
            await h.waitForItems(session.page, (all) => gauge(all, 'Se'), 'the Se gauge from the seeded cache');
            const checks = Object.keys(EXPECTED).map((name) => ({
                name: `scenario ${name}`,
                run: () => checkScenario(session, name, report),
            }));
            checks.push({ name: 'gauge circle font', run: () => checkGlyphFont(session, report) });
            await runChecks(checks, results);
        }, results);
        await withSession({
            name: 'chart',
            seed: seedHome,
            settings: { ...OFFLINE_SETTINGS, 'workbench.colorTheme': 'Default Light Modern' },
        }, async (session) => {
            await runChecks([{ name: 'chart in the light theme', run: () => checkChartLight(session, report) }], results);
        }, results);
        await withSession({
            name: 'nopilot',
            seed: seedHome,
            settings: { ...OFFLINE_SETTINGS, 'chat.disableAIFeatures': undefined },
        }, async (session) => {
            await runChecks([{ name: 'tooltip command links', run: () => checkNopilotLinks(session, report) }], results);
        }, results);
    }

    for (const r of results) {
        const detail = r.detail ? ` - ${r.detail}` : '';
        console.log(`${r.verdict.toUpperCase().padEnd(12)} ${r.name} (${(r.ms / 1000).toFixed(1)}s)${detail}`);
    }
    for (const line of report.lines) console.log(`  ${line}`);
    const verdict = results.some((r) => r.verdict === 'fail')
        ? 'fail'
        : results.some((r) => r.verdict === 'undetermined') || results.length === 0
            ? 'undetermined'
            : 'pass';
    console.log(`RESULT: ${verdict}`);
    console.log(`screenshots: ${path.join(h.SCRATCH, 'shots')}`);
    return verdict;
}

main().then(
    (verdict) => process.exit({ pass: h.EXIT.pass, fail: h.EXIT.fail, undetermined: h.EXIT.undetermined }[verdict]),
    (error) => {
        console.log(`RESULT: undetermined\nharness error: ${error instanceof Undetermined ? error.message : error.stack}`);
        process.exit(h.EXIT.undetermined);
    },
);
