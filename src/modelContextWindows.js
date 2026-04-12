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
// Enterprise accounts on Opus 4.6 and Sonnet 4.6 — no explicit suffix required.
// Pro accounts stay at 200K by default (extra-usage pay-as-you-go).
//
// Claude Code strips the [1m]/[Nm] suffix before writing model IDs to the
// JSONL, so JSONL-based detection only works if (a) the user explicitly
// chose a suffixed alias in the picker AND (b) Claude Code writes it through
// (rare) — so we can't rely on it. Instead we use Claude Code's own
// s1mAccessCache in ~/.claude.json as the authoritative eligibility signal.
//
// The suffix parser is still here as a future-proof belt-and-braces for when
// larger contexts (2M, 5M, …) get added.
//
// Detection strategy (priority order):
//   1. Observed tokens > STANDARD_LIMIT → definitive evidence of extended context
//   2. eligibilityLimit from caller (Claude Code's s1mAccessCache says yes)
//   3. aliasDeclaredLimit from claudeCode.selectedModel "opus[1m]"-style setting
//   4. JSONL-declared suffix (future-proofing, rarely present in practice)
//   5. Default: STANDARD_LIMIT (200K)

const STANDARD_LIMIT = 200000;
const FALLBACK_LIMIT = STANDARD_LIMIT;

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
// contextLimit of 0 means "no suffix — use default"
// Returns null for unrecognised formats
function parseModelId(modelId) {
    if (!modelId || typeof modelId !== 'string') return null;

    // Match: claude-{family}-{major}-{minor} with optional context suffix [Nm] or [Nk]
    const match = modelId.match(/^claude-([a-z]+)-(\d+)-(\d+)(?:[^[]*)?(\[\d+[mk]\])?/);
    if (!match) return null;

    const family = match[1];
    const major = parseInt(match[2], 10);
    const minor = parseInt(match[3], 10);

    return {
        family,
        version: parseFloat(`${major}.${minor}`),
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

// Resolve context window limit for a single model ID
// Returns the suffix-declared limit or STANDARD_LIMIT if no suffix
function getModelContextWindow(modelId) {
    const parsed = parseModelId(modelId);
    if (!parsed) return FALLBACK_LIMIT;
    return parsed.contextLimit || STANDARD_LIMIT;
}

// Given observed session state, return the resolved context window in tokens.
//
// DEPRECATED: this function was the entry point for the old
// Math.max-based resolver, which treated `maxObservedTokens` as a
// definitive limit when it exceeded 200K. That caused the 2026-04
// ratchet bug where the stored session limit would creep up to
// match the raw observed usage, producing a permanent ~100% Tk%.
//
// It is kept only as a thin delegator to contextWindowResolver so
// any remaining callers (inside or outside the repo) transparently
// get the fixed behaviour. New code should call
// `resolveContextWindow` directly with the richer signal set.
function resolveSessionContextWindow(
    modelIds,
    maxObservedTokens = 0,
    aliasDeclaredLimit = 0,
    eligibilityLimit = 0
) {
    const { resolveContextWindow } = require('./contextWindowResolver');
    const result = resolveContextWindow({
        modelIds,
        observedFloor: maxObservedTokens,
        aliasDeclaredLimit,
        jsonlDeclaredLimit: getHighestDeclaredLimit(modelIds),
        s1mHasAccess: eligibilityLimit >= 1_000_000 ? true : null,
    });
    return result.limit;
}

// Return context window info for tooltip display
function getPlanContextSummary() {
    return [
        { label: 'Default', limit: STANDARD_LIMIT },
    ];
}

module.exports = {
    parseModelId,
    parseModelAlias,
    parseContextSuffix,
    getHighestDeclaredLimit,
    getModelContextWindow,
    resolveSessionContextWindow,
    getPlanContextSummary,
    FALLBACK_LIMIT,
    STANDARD_LIMIT,
};
