//  Project:      Claudemeter
//  File:         src/tk/profiles.js
//  Purpose:      Data: built-in Tk-threshold profiles per Claude account tier.
//
//                Each profile carries threshold values + optional UI overrides.
//                Detection-signal mapping is NOT on the profile object - it
//                lives in src/tk/profileSelector.js as an explicit priority
//                chain. Profiles are pure data; selection is pure code.
//
//                Adding a new tier: add an entry here AND add an explicit
//                branch to selectProfile() in profileSelector.js. No
//                iteration-order coupling - the profile name is the only
//                link between the two files.
//
//                'team-premium' is intentionally absent - it ships when the
//                verbatim Anthropic detection strings are observable.
//
//                'enterprise' has rotEnabled: false because the typical
//                500K window means rotDeep (500K) and rotLight (300K)
//                tiers are unreachable / no-ops - error fires first at
//                ~462K. Honest beats inert.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

// Standard threshold values shared by most profiles
const STANDARD_RUNWAY = Object.freeze({
    compactReserveTokens: 33_000,
    warningRunwayTokens:  20_000,
    errorRunwayTokens:     5_000,
});

const STANDARD_ROT = Object.freeze({
    rotEnabled:       true,
    rotLightTokens:  300_000,
    rotDeepTokens:   500_000,
});

const NO_ROT = Object.freeze({ rotEnabled: false });

const PROFILES = Object.freeze({
    pro: Object.freeze({
        name: 'pro',
        description: 'Pro — 200K Sonnet/Opus. Auto-compact at ~83% of window.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...NO_ROT }),
    }),

    'max-5x': Object.freeze({
        name: 'max-5x',
        description: 'Max 5x ($100/mo) — 1M Opus auto. Multi-needle rot tiers active.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    'max-20x': Object.freeze({
        name: 'max-20x',
        description: 'Max 20x ($200/mo) — 1M Opus auto. Multi-needle rot tiers active.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    'max-unknown': Object.freeze({
        name: 'max-unknown',
        description: 'Max plan, rateLimitTier not detected. Treats as 1M Opus auto.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    'team-standard': Object.freeze({
        name: 'team-standard',
        description: 'Team Standard — 1M Opus auto. Multi-needle rot tiers active.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    enterprise: Object.freeze({
        name: 'enterprise',
        description: 'Anthropic Enterprise — typical 500K window. Rot tiers disabled (rotDeep at 500K is unreachable on a 500K window).',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...NO_ROT }),
    }),

    unknown: Object.freeze({
        name: 'unknown',
        description: 'Detection fallback. Conservative: assumes 200K window, no rot tiers.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...NO_ROT }),
    }),
});

module.exports = { PROFILES };
