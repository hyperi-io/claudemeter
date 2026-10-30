//  Project:      Claudemeter
//  File:         tests/e2e/fixtures.js
//  Purpose:      Seed an isolated HOME and define the simulator scenarios the e2e checks and screenshots use
//  Language:     JavaScript (CommonJS)
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const fs = require('node:fs');
const path = require('node:path');

const { processApiResponse } = require('../../src/apiSchema');
const { projectDirName } = require('../../src/projectDir');

const HOUR_MS = 3_600_000;

// The account the tooltip names. Fixed so a screenshot never carries a real identity.
const ACCOUNT = {
    name: 'Zaphod',
    email: 'zaphod@example.com',
    orgName: "Zaphod's Organization",
    organizationType: 'claude_max',
    rateLimitTier: 'default_claude_max_20x',
    subscriptionType: 'max',
    subscriptionStatus: 'active',
    billingType: 'stripe_subscription',
    creditsEnabled: false,
    hasClaudeMax: true,
    hasClaudePro: false,
};

// What the simulator does not set: the reset stamps, the account and the local transcript.
const SESSION_RESETS_IN_MS = 2 * HOUR_MS + 57 * 60_000;
const WEEKLY_RESETS_IN_MS = 3 * 24 * HOUR_MS + 6 * HOUR_MS;
const BASE_TOKENS = 15_300;

// The cache is what the extension reads before it would touch the network, and the 1h refresh keeps it fresh for the run.
function writeUsageCache(dirs, now) {
    const raw = {
        five_hour: { utilization: 8, resets_at: new Date(now + SESSION_RESETS_IN_MS).toISOString() },
        seven_day: { utilization: 40, resets_at: new Date(now + WEEKLY_RESETS_IN_MS).toISOString() },
    };
    const usageData = processApiResponse(raw, null, null, ACCOUNT);
    const file = path.join(dirs.home, '.config', 'claudemeter', 'usage-cache.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ usageData, fetchedAt: now, account: null }), 'utf8');
}

// One assistant turn in the layout Claude Code writes, which the Tk gauge reads as the live context.
function writeTranscript(dirs, now) {
    const dir = path.join(dirs.home, '.claude', 'projects', projectDirName(fs.realpathSync(dirs.workspace)));
    fs.mkdirSync(dir, { recursive: true });
    const turn = {
        type: 'assistant',
        timestamp: new Date(now).toISOString(),
        cwd: dirs.workspace,
        message: {
            model: 'claude-opus-4-8',
            usage: {
                input_tokens: 300,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: BASE_TOKENS - 300,
                output_tokens: 50,
            },
        },
    };
    // The reader takes a transcript only if its name is a UUID.
    const file = path.join(dir, '0e2e0e2e-0000-4000-8000-000000000001.jsonl');
    fs.writeFileSync(file, `${JSON.stringify(turn)}\n`, 'utf8');
}

function seedHome(dirs) {
    const now = Date.now();
    writeUsageCache(dirs, now);
    writeTranscript(dirs, now);
}

// Settings that keep the run offline and the seeded data live for its whole length.
const OFFLINE_SETTINGS = {
    'claudemeter.statusBar.showServiceStatus': false,
    'claudemeter.usageRefreshSeconds': 3600,
    'claudemeter.sessionWindowMinutes': 600,
    'claudemeter.sessionMaxAgeMinutes': 600,
    'claudemeter.localRefreshSeconds': 60,
};

const WINDOW_1M = {
    contextWindow: 1_000_000,
    profileOverride: 'max-20x',
    colorMode: 'color',
    thresholdIcons: false,
};

// Token counts on a 1M window under the max-20x profile: rot from 400K and 650K, warning from 947K, error from 962K.
const SCENARIOS = {
    normal: { ...WINDOW_1M, sessionPercent: 8, weeklyPercent: 40, tokenUsed: 120_000 },
    warning: { ...WINDOW_1M, sessionPercent: 85, weeklyPercent: 82, tokenUsed: 950_000 },
    error: { ...WINDOW_1M, sessionPercent: 95, weeklyPercent: 93, tokenUsed: 970_000 },
    rotLight: { ...WINDOW_1M, sessionPercent: 20, weeklyPercent: 45, tokenUsed: 450_000 },
    rotDeep: { ...WINDOW_1M, sessionPercent: 20, weeklyPercent: 45, tokenUsed: 700_000 },
    rotLightForced: { ...WINDOW_1M, sessionPercent: 20, weeklyPercent: 45, tokenLevel: 'rotLight', tokenUsed: 450_000 },
    rotDeepForced: { ...WINDOW_1M, sessionPercent: 20, weeklyPercent: 45, tokenLevel: 'rotDeep', tokenUsed: 700_000 },
};

// Strip states. History rows are [minutes ago, 5h %, weekly %] and Tk rows [minutes ago, tokens], both
// resolved against the moment of drawing, so a state looks the same whenever it is applied.
const STEADY_TK = [[40, 60_000], [30, 75_000], [20, 90_000], [10, 105_000], [0, 120_000]];
const STRIP_SCENARIOS = {
    // 10 points an hour on a 5h window that began 2h ago: no run-out, nothing ahead of the week's pace.
    stripNormal: {
        ...WINDOW_1M,
        sessionPercent: 20,
        weeklyPercent: 40,
        tokenUsed: 120_000,
        usageHistory: {
            fiveResetsInMin: 180,
            weekResetsInMin: 3 * 24 * 60,
            samples: [[120, 0, 40], [100, 3.3, 40], [80, 6.7, 40], [60, 10, 40], [40, 13.3, 40], [20, 16.7, 40], [0, 20, 40]],
        },
        tkSeries: STEADY_TK,
    },
    // 30 points an hour from 72% hits 100% an hour before the 5h reset, and the week is 13 points ahead of the clock.
    stripRunsOut: {
        ...WINDOW_1M,
        sessionPercent: 72,
        weeklyPercent: 70,
        tokenUsed: 120_000,
        usageHistory: {
            fiveResetsInMin: 180,
            weekResetsInMin: 3 * 24 * 60,
            samples: [[45, 49.5, 70], [30, 57, 70], [15, 64.5, 70], [0, 72, 70]],
        },
        tkSeries: STEADY_TK,
    },
    // Two samples and two turns are too few to read a burn from.
    stripMeasuring: {
        ...WINDOW_1M,
        sessionPercent: 20,
        weeklyPercent: 40,
        tokenUsed: 120_000,
        usageHistory: { fiveResetsInMin: 180, weekResetsInMin: 3 * 24 * 60, samples: [[2, 19, 40], [0, 20, 40]] },
        tkSeries: [[2, 100_000], [0, 120_000]],
    },
    // 12K tokens a minute, half-way up the context and into the rot zone, about 40 minutes from auto-compact.
    stripTk: {
        ...WINDOW_1M,
        sessionPercent: 20,
        weeklyPercent: 40,
        tokenUsed: 500_000,
        usageHistory: { fiveResetsInMin: 180, weekResetsInMin: 3 * 24 * 60, samples: [[2, 19, 40], [0, 20, 40]] },
        tkSeries: [[35, 100_000], [30, 150_000], [25, 200_000], [20, 260_000], [15, 320_000], [10, 380_000], [5, 440_000], [0, 500_000]],
    },
};
Object.assign(SCENARIOS, STRIP_SCENARIOS);

// The README shots: a quiet account on the strip, every gauge in a warning tier with Se projected to run
// out, and the tooltip over a run-out. Rows are as in STRIP_SCENARIOS.
const ASSET_SCENARIOS = {
    default: STRIP_SCENARIOS.stripNormal,
    allWarnings: {
        ...WINDOW_1M,
        sessionPercent: 85,
        weeklyPercent: 85,
        tokenUsed: 950_000,
        thresholdIcons: true,
        usageHistory: {
            fiveResetsInMin: 180,
            weekResetsInMin: 3 * 24 * 60,
            samples: [[45, 73.75, 85], [30, 77.5, 85], [15, 81.25, 85], [0, 85, 85]],
        },
        tkSeries: [[20, 700_000], [15, 780_000], [10, 840_000], [5, 900_000], [0, 950_000]],
    },
    runsOut: STRIP_SCENARIOS.stripRunsOut,
};

module.exports = { ACCOUNT, SCENARIOS, ASSET_SCENARIOS, OFFLINE_SETTINGS, BASE_TOKENS, seedHome };
