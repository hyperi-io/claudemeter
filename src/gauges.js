// Project:   Claudemeter
// File:      gauges.js
// Purpose:   The gauge registry - one descriptor per meter claudemeter can
//            draw, saying where its value comes from and what it is called.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Anthropic's usage view gains and drops meters over time (per-model weekly
// caps, surface-scoped caps, credits), so no meter is named in the code that
// reads the payload or renders it. A meter is a descriptor here plus whatever
// the payload supplies, and `claudemeter.gauges.definitions` merges over this
// table - a meter Anthropic adds can be surfaced by editing settings.
//
// Descriptor fields:
//   key            - stable id, used for settings lookups and label overrides
//   shortLabel     - status-bar text, e.g. 'Se'
//   compactLabel   - status-bar text in compact mode, where one panel holds
//                    every meter, e.g. 'S'
//   tooltipLabel   - tooltip heading, e.g. 'Session'
//   order          - ascending display order, left to right
//   source         - where the value comes from:
//                      limitKind    - `limits[]` entry whose `kind` matches
//                      limitGroup   - `limits[]` entries whose `group` matches
//                      scoped       - true to expand into one gauge per
//                                     matching entry, labelled by the payload
//                      percentPath  - dot path to a named percent field, tried
//                                     before limitKind
//                      resetsAtPath - dot path to that field's reset stamp
//   thresholdKey   - suffix under claudemeter.thresholds.<key>; null = none
//   showSettingKey - suffix under claudemeter.statusBar.<key>; null = always on
//   rendering      - 'percent' meters need no code to display; 'tokens' and
//                    'credits' have their own renderers because their display
//                    is not a bare percentage
//
// Every label is data, so a translated set replaces this table rather than the
// code: `claudemeter.gauges.labels` maps a key (or a payload model name) to
// {short, compact, tooltip}.

const BUILTIN_GAUGES = {
    session: {
        key: 'session',
        shortLabel: 'Se',
        compactLabel: 'S',
        tooltipLabel: 'Session',
        order: 10,
        source: {
            limitKind: 'session',
            percentPath: 'five_hour.utilization',
            resetsAtPath: 'five_hour.resets_at',
        },
        thresholdKey: 'session',
        showSettingKey: null,
        rendering: 'percent',
    },
    weekly: {
        key: 'weekly',
        shortLabel: 'Wk',
        compactLabel: 'Wk',
        tooltipLabel: 'Weekly',
        order: 20,
        source: {
            limitKind: 'weekly_all',
            percentPath: 'seven_day.utilization',
            resetsAtPath: 'seven_day.resets_at',
        },
        thresholdKey: 'weekly',
        showSettingKey: null,
        rendering: 'percent',
    },
    // Expands into one gauge per scoped entry the payload carries - today the
    // per-model weekly caps, tomorrow whatever else Anthropic scopes. No group
    // is named, so a cap scoped outside the weekly group still lands here.
    scoped: {
        key: 'scoped',
        shortLabel: '?',
        compactLabel: '?',
        tooltipLabel: 'Scoped',
        order: 30,
        source: { scoped: true },
        thresholdKey: 'scoped',
        showSettingKey: 'showScopedWeekly',
        rendering: 'percent',
    },
    credits: {
        key: 'credits',
        shortLabel: 'Cr',
        compactLabel: 'Cr',
        tooltipLabel: 'Extra Usage',
        order: 40,
        source: { percentPath: 'extra_usage.utilization' },
        thresholdKey: 'credits',
        showSettingKey: 'showCredits',
        rendering: 'credits',
    },
    // The context gauge is local, read from the Claude Code transcript rather
    // than the usage payload, so it carries no source.
    tokens: {
        key: 'tokens',
        shortLabel: 'Tk',
        compactLabel: 'Tk',
        tooltipLabel: 'Context',
        order: 50,
        source: null,
        thresholdKey: 'tokens',
        showSettingKey: null,
        rendering: 'tokens',
    },
};

function getNested(obj, path) {
    if (!obj || typeof path !== 'string') return undefined;
    return path.split('.').reduce((acc, part) => {
        if (acc === null || acc === undefined) return undefined;
        if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
        return acc[part];
    }, obj);
}

// Merge the user's definitions over the built-ins, one level deep per field so
// a definition can override a single label without restating the source.
function mergeDefinitions(overrides = {}) {
    const merged = {};
    for (const [key, gauge] of Object.entries(BUILTIN_GAUGES)) {
        merged[key] = { ...gauge, source: gauge.source ? { ...gauge.source } : null };
    }
    if (!overrides || typeof overrides !== 'object') return merged;

    for (const [key, override] of Object.entries(overrides)) {
        if (!override || typeof override !== 'object') continue;
        const base = merged[key] || { key, order: 100, rendering: 'percent' };
        merged[key] = {
            ...base,
            ...override,
            key,
            source: override.source
                ? { ...(base.source || {}), ...override.source }
                : (base.source || null),
        };
    }
    return merged;
}

function pick(value, fallback) {
    return (typeof value === 'string' && value.length > 0) ? value : fallback;
}

function lookupOverride(overrides, name) {
    if (!overrides || typeof overrides !== 'object' || typeof name !== 'string') return null;
    if (overrides[name]) return overrides[name];
    const wanted = name.toLowerCase();
    for (const [key, value] of Object.entries(overrides)) {
        if (key.toLowerCase() === wanted) return value;
    }
    return null;
}

// A gauge's labels, with the user's override map applied. An override that
// omits `compact` falls back to its `short`, so relabelling a gauge in one
// place relabels it everywhere.
function gaugeLabels(key, labelOverrides = {}, definitions = BUILTIN_GAUGES) {
    const gauge = definitions[key] || BUILTIN_GAUGES[key];
    if (!gauge) return { short: key, compact: key, tooltip: key };
    const override = lookupOverride(labelOverrides, key) || {};
    const short = pick(override.short, gauge.shortLabel);
    return {
        short,
        compact: pick(override.compact, pick(override.short, gauge.compactLabel)),
        tooltip: pick(override.tooltip, gauge.tooltipLabel),
    };
}

// A scoped gauge's status-bar label, abbreviated to two characters to match
// the fixed gauges (Se, Wk, Tk): the first letter, then the next consonant.
// Fable -> Fb, Opus -> Op, Nimbus -> Nm. Falls back to the first two
// characters when no consonant follows, and to the payload name's first letter
// for a one-character name.
function abbreviate(name) {
    const first = name.charAt(0).toUpperCase();
    const rest = name.slice(1);
    const consonant = rest.match(/[bcdfghjklmnpqrstvwxz]/i);
    if (consonant) return first + consonant[0].toLowerCase();
    return rest.length > 0 ? first + rest.charAt(0).toLowerCase() : first;
}

// A scoped gauge's status-bar label, unless the user mapped that name to
// something else.
function scopedShortLabel(name, labelOverrides = {}) {
    if (typeof name !== 'string' || name.length === 0) return BUILTIN_GAUGES.scoped.shortLabel;
    const override = lookupOverride(labelOverrides, name);
    return pick(override?.short, abbreviate(name));
}

// A scoped gauge's tooltip label: the payload's own name unless overridden.
function scopedTooltipLabel(name, labelOverrides = {}) {
    if (typeof name !== 'string' || name.length === 0) return BUILTIN_GAUGES.scoped.tooltipLabel;
    return pick(lookupOverride(labelOverrides, name)?.tooltip, name);
}

// Read every gauge's value out of one usage payload, in display order.
//
// `limits[]` is Anthropic's own normalised view of the meters, so it is the
// primary source; a descriptor's `percentPath` is the named field that
// predates it and serves as the fallback. A scoped descriptor expands into one
// resolved gauge per matching payload entry.
//
// Returns [{key, label, percent, resetsAt, severity, modelId, descriptor}],
// with `percent: null` for a meter the payload does not carry.
function resolveGauges(usage, { definitions = BUILTIN_GAUGES, labelOverrides = {} } = {}) {
    const limits = Array.isArray(usage?.limits) ? usage.limits : [];
    const numeric = limits.filter(l => l && typeof l.percent === 'number');

    const resolved = [];
    const ordered = Object.values(definitions).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

    for (const gauge of ordered) {
        const source = gauge.source;
        if (!source) continue;

        if (source.scoped) {
            const entries = numeric.filter(l =>
                (!source.limitGroup || l.group === source.limitGroup)
                && (!source.limitKind || l.kind === source.limitKind)
                && scopeName(l) !== null);
            for (const entry of entries) {
                const name = scopeName(entry);
                resolved.push({
                    key: `${gauge.key}:${name.toLowerCase()}`,
                    label: scopedTooltipLabel(name, labelOverrides),
                    shortLabel: scopedShortLabel(name, labelOverrides),
                    percent: entry.percent,
                    resetsAt: entry.resets_at || null,
                    severity: entry.severity || null,
                    modelId: entry.scope?.model?.id || null,
                    kind: entry.kind || null,
                    group: entry.group || null,
                    descriptor: gauge,
                });
            }
            continue;
        }

        const labels = gaugeLabels(gauge.key, labelOverrides, definitions);
        const named = source.percentPath ? getNested(usage, source.percentPath) : undefined;
        const entry = source.limitKind
            ? numeric.find(l => l.kind === source.limitKind && scopeName(l) === null)
            : null;

        const percent = typeof named === 'number'
            ? named
            : (entry ? entry.percent : null);
        const resetsAt = typeof named === 'number'
            ? (getNested(usage, source.resetsAtPath) || null)
            : (entry?.resets_at || null);

        resolved.push({
            key: gauge.key,
            label: labels.tooltip,
            shortLabel: labels.short,
            percent,
            resetsAt,
            severity: entry?.severity || null,
            modelId: null,
            kind: entry?.kind || source.limitKind || null,
            group: entry?.group || null,
            descriptor: gauge,
        });
    }

    return resolved;
}

// The name a scoped limit is drawn under, or null when it scopes nothing.
function scopeName(limit) {
    return limit?.scope?.model?.display_name || limit?.scope?.surface?.display_name || null;
}

// Gauges with a renderer of their own: session and weekly draw a reset time,
// credits draws a currency, tokens draws the context bar. Everything else the
// registry resolves is a bare percentage and shares the generic panels, so a
// meter Anthropic adds needs a descriptor and no renderer.
const DEDICATED_PANELS = new Set(['session', 'weekly', 'credits', 'tokens']);

function isGenericPanel(gauge) {
    return !DEDICATED_PANELS.has(gauge?.descriptor?.key ?? gauge?.key);
}

module.exports = {
    BUILTIN_GAUGES,
    DEDICATED_PANELS,
    isGenericPanel,
    abbreviate,
    GAUGES: BUILTIN_GAUGES,
    mergeDefinitions,
    gaugeLabels,
    scopedShortLabel,
    scopedTooltipLabel,
    resolveGauges,
    scopeName,
};
