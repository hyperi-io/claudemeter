// Project:   Claudemeter
// File:      modelContextWindows.js
// Purpose:   Resolve context window size from Claude model identifiers using semver ranges
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Model ID format from JSONL: "claude-{family}-{major}-{minor}"
// e.g. "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"
//
// Ranges use decimal version (4.6, 4.5, 5.0) parsed from the model ID.
// Checked top-to-bottom; first match wins.
// 1:1 overrides (by exact model ID) take priority over ranges.

// Exact model ID overrides — use when a specific model deviates from its range
const MODEL_OVERRIDES = {
    // Example: 'claude-opus-4-5': 200000,
};

// Semver-style ranges checked in order. First match wins.
// Each entry: { min, max, limit }
//   min/max are inclusive decimals (e.g. 4.6)
//   max: null means "no upper bound" (future-proofing)
const CONTEXT_WINDOW_RANGES = [
    { min: 4.6, max: null, limit: 1000000 },
    { min: 0,   max: 4.5,  limit: 200000 },
];

const FALLBACK_LIMIT = 1000000;

// Parse "claude-opus-4-6" -> { family: "opus", version: 4.6 }
// Parse "claude-sonnet-4-6" -> { family: "sonnet", version: 4.6 }
// Returns null for unrecognised formats
function parseModelId(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;

    // Match: claude-{family}-{major}-{minor}
    const match = modelId.match(/^claude-([a-z]+)-(\d+)-(\d+)/);
    if (!match) return null;

    const family = match[1];
    const major = parseInt(match[2], 10);
    const minor = parseInt(match[3], 10);

    return {
        family,
        version: parseFloat(`${major}.${minor}`),
        raw: modelId,
    };
}

// Resolve context window limit for a single model ID
function getModelContextWindow(modelId) {
    if (MODEL_OVERRIDES[modelId] !== undefined) {
        return MODEL_OVERRIDES[modelId];
    }

    const parsed = parseModelId(modelId);
    if (!parsed) return FALLBACK_LIMIT;

    for (const range of CONTEXT_WINDOW_RANGES) {
        const aboveMin = parsed.version >= range.min;
        const belowMax = range.max === null || parsed.version <= range.max;

        if (aboveMin && belowMax) {
            return range.limit;
        }
    }

    return FALLBACK_LIMIT;
}

// Given an array of model IDs seen in a session, return the highest context window.
// The session shares one context across model swaps, so the max is correct.
function resolveSessionContextWindow(modelIds) {
    if (!modelIds || modelIds.length === 0) return FALLBACK_LIMIT;

    let highest = 0;
    for (const modelId of modelIds) {
        const limit = getModelContextWindow(modelId);
        if (limit > highest) {
            highest = limit;
        }
    }

    return highest || FALLBACK_LIMIT;
}

module.exports = {
    parseModelId,
    getModelContextWindow,
    resolveSessionContextWindow,
    FALLBACK_LIMIT,
    MODEL_OVERRIDES,
    CONTEXT_WINDOW_RANGES,
};
