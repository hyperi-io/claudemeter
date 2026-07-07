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
//                500K window makes rotDeep (650K) unreachable and leaves
//                rot largely inert - the auto-compact/error runway fires
//                first. Honest beats inert.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

// Standard threshold values shared by most profiles
const STANDARD_RUNWAY = Object.freeze({
    compactReserveTokens: 33_000,
    warningRunwayTokens:  20_000,
    errorRunwayTokens:     5_000,
});

// Rot tiers calibrated for Opus 4.8's long-context curve (see
// docs/context-rot.md, re-check 7 Jul 2026). 4.8 degrades ~half as fast as
// 4.7 across 256K->1M (retains ~79% of its 256K GraphWalks BFS at 1M, vs
// 4.7's ~52%), so the blue tiers sit later than the earlier 300K/500K
// defaults - which were calibrated on the steeper 4.7-era curve and fired
// while 4.8 at 256K still scores 85.9% BFS. Held toward the CAG-biased-early
// end of the doc's 4.8-reasoned bands (400-550K / 650-800K). Still a
// judgement call - no third-party binned 4.8 data exists in the 256K->1M gap.
const STANDARD_ROT = Object.freeze({
    rotEnabled:       true,
    rotLightTokens:  400_000,
    rotDeepTokens:   650_000,
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
        description: 'Anthropic Enterprise — typical 500K window. Rot tiers disabled (rotDeep at 650K is unreachable on a 500K window).',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...NO_ROT }),
    }),

    unknown: Object.freeze({
        name: 'unknown',
        description: 'Detection fallback. Conservative: assumes 200K window, no rot tiers.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...NO_ROT }),
    }),
});

module.exports = { PROFILES };
