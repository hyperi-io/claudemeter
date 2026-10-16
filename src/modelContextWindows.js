// Project:   Claudemeter
// File:      modelContextWindows.js
// Purpose:   Resolve context window size from Claude model identifiers and observed usage
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Model ID format from JSONL: "claude-{family}-{major}-{minor}" with optional context suffix
// e.g. "claude-opus-4-6", "claude-sonnet-4-6[1m]", "claude-opus-4-6[2m]"
//
// 1M context is GA (since March 2026) and is the default for Max, Team, and
// Enterprise on Opus 4.6+, Sonnet 4.6+, and Fable 5+ -- no suffix required.
// Pro accounts stay at 200K by default (extra-usage pay-as-you-go).
//
// Claude Code strips the [1m]/[Nm] suffix before writing model IDs to the
// JSONL, so JSONL-based detection only works if (a) the user explicitly
// chose a suffixed alias in the picker AND (b) Claude Code writes it through
// (rare) - so we can't rely on it.
//
// The suffix parser is still here as a future-proof belt-and-braces for when
// larger contexts (2M, 5M, ...) get added.
//
// This module is PARSING-ONLY. It turns model IDs and alias strings into
// {family, version, contextLimit} shapes and pulls out any declared suffix.
// The session limit is decided by contextWindowResolver.resolveContextWindow.

const STANDARD_LIMIT = 200000;

// Parse context suffix like [1m], [2m], [500k] into a token count
// Returns 0 if no suffix or unrecognised format
function parseContextSuffix(suffix) {
    if (!suffix) return 0;

    const mMatch = suffix.match(/^\[(\d+)m\]$/);
    if (mMatch) return parseInt(mMatch[1], 10) * 1000000;

    const kMatch = suffix.match(/^\[(\d+)k\]$/);
    if (kMatch) return parseInt(kMatch[1], 10) * 1000;

    return 0;
}

// Extract context limit from a Claude Code model alias
// e.g. "opus[1m]" -> 1000000, "sonnet" -> 0, "claude-opus-4-6[2m]" -> 2000000
// Works with both short aliases and full model IDs
function parseModelAlias(alias) {
    if (!alias || typeof alias !== 'string') return 0;

    const suffixMatch = alias.match(/\[(\d+[mk])\]$/);
    if (!suffixMatch) return 0;

    return parseContextSuffix(`[${suffixMatch[1]}]`);
}

// Parse "claude-opus-4-6" -> { family: "opus", version: 4.6, contextLimit: 0 }
// Parse "claude-opus-4-6[1m]" -> { family: "opus", version: 4.6, contextLimit: 1000000 }
// Parse "claude-opus-4-6[2m]" -> { family: "opus", version: 4.6, contextLimit: 2000000 }
// contextLimit of 0 means "no suffix - use default"
// Returns null for unrecognised formats
function parseModelId(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;

    // claude-{family}-{major} with OPTIONAL -{minor}, then optional [Nm]/[Nk].
    // Minor optional so claude-fable-5 parses (-> 5.0). (?!\d) excludes a date.
    const match = modelId.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?(?:[^[]*)?(\[\d+[mk]\])?/);
    if (!match) return null;

    const family = match[1];
    const major = parseInt(match[2], 10);
    const minor = match[3] !== undefined ? parseInt(match[3], 10) : null;

    return {
        family,
        version: minor !== null ? parseFloat(`${major}.${minor}`) : major,
        contextLimit: parseContextSuffix(match[4]),
        raw: modelId,
    };
}

// Find the highest context limit declared by any model suffix in the array
// Returns 0 if no model has a context suffix
function getHighestDeclaredLimit(modelIds) {
    if (!modelIds || modelIds.length === 0) return 0;

    let highest = 0;
    for (const id of modelIds) {
        const parsed = parseModelId(id);
        if (parsed && parsed.contextLimit > highest) {
            highest = parsed.contextLimit;
        }
    }
    return highest;
}

module.exports = {
    parseModelId,
    parseModelAlias,
    parseContextSuffix,
    getHighestDeclaredLimit,
    STANDARD_LIMIT,
};
