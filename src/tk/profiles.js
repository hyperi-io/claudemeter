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
//                No profile turns rot off. Rot is gated on the WINDOW in
//                thresholds.js (>200K), not on the profile, because on macOS
//                the credentials live in the Keychain and detection often
//                falls back to 'unknown' - profile-gating would switch rot
//                off for exactly the 1M sessions that need it.
//
//                The context window is a property of the MODEL and the
//                SURFACE, not the plan: in Claude Code every paid plan gets
//                1M on Sonnet 5 / Fable 5 / Opus 4.6+. Do not reintroduce
//                per-plan window assumptions here - contextWindowResolver
//                owns the window and these profiles only carry thresholds.
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
    rotLightTokens:  400_000,
    rotDeepTokens:   650_000,
});

const PROFILES = Object.freeze({
    pro: Object.freeze({
        name: 'pro',
        description: 'Pro. 1M in Claude Code on Sonnet 5 / Fable 5, and on Opus once usage credits are enabled.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    'max-5x': Object.freeze({
        name: 'max-5x',
        description: 'Max 5x. 1M in Claude Code, no credits needed.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    'max-20x': Object.freeze({
        name: 'max-20x',
        description: 'Max 20x. 1M in Claude Code, no credits needed.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    'max-unknown': Object.freeze({
        name: 'max-unknown',
        description: 'Max plan, rateLimitTier not detected. Same thresholds as the known Max tiers.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    'team-standard': Object.freeze({
        name: 'team-standard',
        description: 'Team Standard. 1M in Claude Code, no credits needed.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    enterprise: Object.freeze({
        name: 'enterprise',
        description: 'Anthropic Enterprise. 1M in Claude Code, same as every other paid plan.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),

    unknown: Object.freeze({
        name: 'unknown',
        description: 'Detection fallback. Standard thresholds - the window comes from contextWindowResolver, not from here.',
        thresholds: Object.freeze({ ...STANDARD_RUNWAY, ...STANDARD_ROT }),
    }),
});

module.exports = { PROFILES };
