//  Project:      Claudemeter
//  File:         tests/e2e/show.js
//  Purpose:      Open the pinned VS Code on the host display with the extension loaded, for a person to look at
//  Language:     JavaScript (CommonJS)
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED
//
//  Description:
//      Usage: show.js [--state <scenario>] [--ttl <minutes>] | show.js --close. No state uses the
//      real login. The window stays up until it is closed or the ttl passes.

const h = require('./harness');
const { OFFLINE_SETTINGS, SCENARIOS, seedHome } = require('./fixtures');

const PROFILE = 'show';
const DEFAULT_TTL_MINUTES = 30;

const option = (name) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? undefined : process.argv[at + 1];
};

async function close() {
    const stopped = await h.stopProfile(PROFILE);
    console.log(`closed ${stopped} process(es) of the ${PROFILE} window`);
}

async function show() {
    const state = option('--state');
    const ttl = Number(option('--ttl') ?? DEFAULT_TTL_MINUTES);
    if (state !== undefined && !SCENARIOS[state]) {
        throw new h.Undetermined(`no state "${state}", choose from ${Object.keys(SCENARIOS).join(', ')}`);
    }
    if (!(ttl > 0)) throw new h.Undetermined(`--ttl wants minutes, got "${option('--ttl')}"`);

    h.watchdog(ttl + 2);
    h.buildBundle();
    const session = await h.launch(state === undefined
        ? { name: PROFILE, isolated: false }
        : { name: PROFILE, seed: seedHome, settings: OFFLINE_SETTINGS });
    try {
        if (state !== undefined) {
            await h.waitForItems(session.page, (all) => h.itemByText(all, /^Se /), 'the Se gauge from the seeded cache');
            await h.applyScenario(session, SCENARIOS[state]);
        }
        console.log(`window up: pid ${session.app.process().pid}, ${state === undefined ? 'live login' : `state ${state}`}, closes itself after ${ttl} min`);
        console.log('close: npm run show:close');
        await session.app.waitForEvent('close', { timeout: ttl * 60_000 }).catch(() => undefined);
    } finally {
        await session.close();
    }
}

const main = process.argv.includes('--close') ? close : show;
main().then(
    () => process.exit(h.EXIT.pass),
    (error) => {
        console.log(`RESULT: undetermined\n${error instanceof h.Undetermined ? error.message : error.stack}`);
        process.exit(h.EXIT.undetermined);
    },
);
