// Project:   Claudemeter
// File:      agents/limits.js
// Purpose:   Helpers shared by the supplementary agent providers: window labels and the headline limit.
// Language:  JavaScript (CommonJS)
//
// A provider's usage is { plan, limits: [{ label, percent, windowMinutes, resetsAt }], notes }, with
// resetsAt in epoch ms. Window lengths come from the provider, never from here.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// A window length as "5h", "7d" or "90m".
function windowLabel(minutes) {
    if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60}h`;
    return `${Math.round(minutes)}m`;
}

// The limit the status bar shows for an agent: the fullest, and of equals the one that resets first.
function headlineLimit(limits) {
    let best = null;
    for (const limit of limits || []) {
        if (!best || limit.percent > best.percent) best = limit;
        else if (limit.percent === best.percent && (limit.resetsAt ?? Infinity) < (best.resetsAt ?? Infinity)) best = limit;
    }
    return best;
}

module.exports = { windowLabel, headlineLimit };
