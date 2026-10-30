// Project:   Claudemeter
// File:      projectionText.js
// Purpose:   One-line projections under the tooltip chart, from the burn analyses.
// Language:  JavaScript (CommonJS)
//
// The same sentences are the chart's alt text and the lines under it. No vscode import.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const { MINUTE_MS } = require('./burn');
const { gaugeLabels } = require('./gauges');

// "50m", "1h20", "2h", "3d 5h". Rounded to the minute, and never negative.
function formatSpan(ms) {
    const totalMinutes = Math.max(0, Math.round(ms / MINUTE_MS));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return minutes > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${hours}h`;
    return `${minutes}m`;
}

// One short line for a usage gauge: where the burn lands, which the status bar does not show.
// Null while there is no open window or too few samples to project.
function usageText(analysis, now) {
    if (!analysis || analysis.state !== 'ok') return null;
    if (analysis.latest.pct >= 100) return `blocked for ${formatSpan(analysis.resetsAt - now)}`;
    if (analysis.runsOut && analysis.exhaustsAt !== null && analysis.exhaustsAt < analysis.resetsAt) {
        return `out in ${formatSpan(analysis.exhaustsAt - now)}, ${formatSpan(analysis.resetsAt - analysis.exhaustsAt)} blocked`;
    }
    return `${Math.min(100, Math.round(analysis.projectedAtReset))}% at reset`;
}

// One short line for Tk: how long until auto-compact. Null while measuring or with the context flat.
function tkText(analysis) {
    if (!analysis || analysis.state !== 'ok') return null;
    if (analysis.pctOfCompact >= 100) return 'at auto-compact';
    if (analysis.runwayMinutes === null) return null;
    return `compacts in ${formatSpan(analysis.runwayMinutes * MINUTE_MS)}`;
}

/**
 * One line per gauge that has something to say, in chart order, the label apart so it can be coloured.
 *
 * @param {{session?: object, weekly?: object, tokens?: object, now: number, labels?: object}} analyses - labels are the gauges' short labels
 * @returns {{key: string, label: string, text: string}[]}
 */
function projectionLines({ session, weekly, tokens, now, labels = {} }) {
    return [
        ['session', usageText(session, now)],
        ['weekly', usageText(weekly, now)],
        ['tokens', tkText(tokens)],
    ]
        .filter(([, text]) => text)
        .map(([key, text]) => ({ key, label: labels[key] ?? gaugeLabels(key).short, text }));
}

// The same lines as plain strings, for the chart's alt text.
function projectionSentences(analyses) {
    return projectionLines(analyses).map((l) => `${l.label} ${l.text}`);
}

module.exports = { formatSpan, projectionLines, projectionSentences };
