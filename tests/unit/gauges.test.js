// The gauge registry is the seam that keeps Anthropic's changing usage view
// out of the rendering code. These tests hold that seam: a meter that arrives
// in the payload must surface without a code change, and a meter shaped
// differently must surface with a settings entry alone.

import { describe, it, expect } from 'vitest';
const {
    BUILTIN_GAUGES,
    mergeDefinitions,
    gaugeLabels,
    scopedShortLabel,
    scopedTooltipLabel,
    resolveGauges,
    isGenericPanel,
} = require('../../src/gauges');
const { processApiResponse } = require('../../src/apiSchema');

// The live payload shape, trimmed to the fields the registry reads.
const LIVE_PAYLOAD = {
    five_hour: { utilization: 7, resets_at: '2026-08-03T03:50:00Z' },
    seven_day: { utilization: 2, resets_at: '2026-08-08T06:00:00Z' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [
        { kind: 'session', group: 'session', percent: 7, severity: 'normal', resets_at: '2026-08-03T03:50:00Z', scope: null },
        { kind: 'weekly_all', group: 'weekly', percent: 2, severity: 'normal', resets_at: '2026-08-08T06:00:00Z', scope: null },
        {
            kind: 'weekly_scoped', group: 'weekly', percent: 72, severity: 'normal',
            resets_at: '2026-08-08T05:59:00Z',
            scope: { model: { id: null, display_name: 'Fable' }, surface: null },
        },
    ],
};

describe('resolveGauges', () => {
    it('resolves session and weekly from the payload', () => {
        const gauges = resolveGauges(LIVE_PAYLOAD);
        expect(gauges.find(g => g.key === 'session').percent).toBe(7);
        expect(gauges.find(g => g.key === 'weekly').percent).toBe(2);
    });

    it('expands a scoped entry into its own gauge, labelled by the payload', () => {
        const fable = resolveGauges(LIVE_PAYLOAD).find(g => g.key === 'scoped:fable');
        expect(fable.label).toBe('Fable');
        expect(fable.shortLabel).toBe('Fb');
        expect(fable.percent).toBe(72);
        expect(fable.resetsAt).toBe('2026-08-08T05:59:00Z');
    });

    it('returns gauges in display order', () => {
        const keys = resolveGauges(LIVE_PAYLOAD).map(g => g.key);
        expect(keys.indexOf('session')).toBeLessThan(keys.indexOf('weekly'));
        expect(keys.indexOf('weekly')).toBeLessThan(keys.indexOf('scoped:fable'));
    });

    it('reports a meter the payload omits as null rather than dropping it', () => {
        const gauges = resolveGauges({ limits: [] });
        expect(gauges.find(g => g.key === 'session').percent).toBeNull();
    });

    it('ignores a limits entry with no numeric percent', () => {
        const gauges = resolveGauges({ limits: [{ kind: 'session', group: 'session', percent: null }] });
        expect(gauges.find(g => g.key === 'session').percent).toBeNull();
    });

    it('prefers a named percent field over the limits entry', () => {
        // The named fields are what shipped, so they stay authoritative where
        // the payload still carries them.
        const gauges = resolveGauges({
            five_hour: { utilization: 40, resets_at: null },
            limits: [{ kind: 'session', group: 'session', percent: 7, scope: null }],
        });
        expect(gauges.find(g => g.key === 'session').percent).toBe(40);
    });
});

// The question this file exists to answer: what does it cost to support the
// next throttle Anthropic ships?
describe('a new limit Anthropic has not shipped yet', () => {
    it('a new scoped cap needs no code and no settings', () => {
        const payload = {
            ...LIVE_PAYLOAD,
            limits: [
                ...LIVE_PAYLOAD.limits,
                {
                    kind: 'weekly_scoped', group: 'weekly', percent: 55, severity: 'warning',
                    resets_at: '2026-08-09T00:00:00Z',
                    scope: { model: { id: 'claude-nimbus-6', display_name: 'Nimbus' }, surface: null },
                },
            ],
        };

        const nimbus = resolveGauges(payload).find(g => g.label === 'Nimbus');
        expect(nimbus.percent).toBe(55);
        expect(nimbus.shortLabel).toBe('Nm');
        expect(nimbus.modelId).toBe('claude-nimbus-6');

        // ...and it reaches the rendered payload the status bar consumes.
        const processed = processApiResponse(payload, null, null, null);
        expect(processed.scopedWeekly.map(s => s.label)).toEqual(['Fable', 'Nimbus']);
    });

    it('a scoped cap outside the weekly group still surfaces', () => {
        // The built-in scoped descriptor names no group, so a daily or monthly
        // per-model cap lands in the same place as today's weekly ones.
        const payload = {
            limits: [
                { kind: 'daily_scoped', group: 'daily', percent: 44, scope: { model: { id: 'claude-zephyr-7', display_name: 'Zephyr' } } },
            ],
        };
        const processed = processApiResponse(payload, null, null, null);
        expect(processed.scopedWeekly).toEqual([
            expect.objectContaining({ label: 'Zephyr', percent: 44, kind: 'daily_scoped', group: 'daily' }),
        ]);
    });

    it('a surface-scoped cap is labelled the same way as a model-scoped one', () => {
        const payload = {
            limits: [{
                kind: 'weekly_scoped', group: 'weekly', percent: 12,
                scope: { model: null, surface: { display_name: 'Cowork' } },
            }],
        };
        expect(resolveGauges(payload).find(g => g.percent === 12).label).toBe('Cowork');
    });

    it('a differently-shaped limit needs one settings entry, no code', () => {
        // A monthly all-models cap: a kind claudemeter has never seen, in a
        // group it has never seen, surfaced by a definition alone.
        const payload = {
            limits: [
                { kind: 'monthly_all', group: 'monthly', percent: 63, resets_at: '2026-09-01T00:00:00Z', scope: null },
            ],
        };
        const definitions = mergeDefinitions({
            monthly: {
                shortLabel: 'Mo',
                compactLabel: 'Mo',
                tooltipLabel: 'Monthly',
                order: 25,
                source: { limitKind: 'monthly_all' },
                thresholdKey: 'scoped',
                rendering: 'percent',
            },
        });

        const monthly = resolveGauges(payload, { definitions }).find(g => g.key === 'monthly');
        expect(monthly.percent).toBe(63);
        expect(monthly.shortLabel).toBe('Mo');
        expect(monthly.resetsAt).toBe('2026-09-01T00:00:00Z');
        // It has no renderer of its own, so it draws in the generic panels.
        expect(isGenericPanel(monthly)).toBe(true);
    });

    it('a definition overriding one field keeps the rest of the built-in', () => {
        const definitions = mergeDefinitions({ weekly: { shortLabel: 'W7' } });
        expect(definitions.weekly.shortLabel).toBe('W7');
        expect(definitions.weekly.source.limitKind).toBe(BUILTIN_GAUGES.weekly.source.limitKind);
        expect(definitions.weekly.thresholdKey).toBe('weekly');
    });

    it('a definition overriding one source field keeps the others', () => {
        const definitions = mergeDefinitions({ session: { source: { limitKind: 'five_hour_v2' } } });
        expect(definitions.session.source.limitKind).toBe('five_hour_v2');
        expect(definitions.session.source.percentPath).toBe('five_hour.utilization');
    });

    it('a malformed definition is ignored rather than breaking the registry', () => {
        expect(mergeDefinitions({ weekly: null }).weekly.shortLabel).toBe('Wk');
        expect(mergeDefinitions('nonsense').weekly.shortLabel).toBe('Wk');
        expect(mergeDefinitions(null).weekly.shortLabel).toBe('Wk');
    });

    it('the built-in table is not mutated by a merge', () => {
        mergeDefinitions({ weekly: { shortLabel: 'W7', source: { limitKind: 'other' } } });
        expect(BUILTIN_GAUGES.weekly.shortLabel).toBe('Wk');
        expect(BUILTIN_GAUGES.weekly.source.limitKind).toBe('weekly_all');
    });
});

describe('labels', () => {
    it('falls back to the built-in labels with no overrides', () => {
        expect(gaugeLabels('session')).toEqual({ short: 'Se', compact: 'S', tooltip: 'Session' });
    });

    it('applies a user override per field', () => {
        const labels = gaugeLabels('session', { session: { short: 'Sess', tooltip: 'Sitzung' } });
        expect(labels.short).toBe('Sess');
        expect(labels.tooltip).toBe('Sitzung');
    });

    it('a short override carries into compact unless compact is set', () => {
        expect(gaugeLabels('session', { session: { short: 'Sx' } }).compact).toBe('Sx');
        expect(gaugeLabels('session', { session: { short: 'Sx', compact: 'X' } }).compact).toBe('X');
    });

    it('relabels a scoped gauge by the model name the payload reported', () => {
        expect(scopedShortLabel('Fable', { Fable: { short: 'Fb' } })).toBe('Fb');
        expect(scopedTooltipLabel('Fable', { Fable: { tooltip: 'Fable weekly' } })).toBe('Fable weekly');
    });

    it('matches a scoped override regardless of case', () => {
        expect(scopedShortLabel('Fable', { fable: { short: 'Fb' } })).toBe('Fb');
    });

    // Two characters, to sit consistently beside the fixed Se / Wk / Tk.
    it('abbreviates a scoped gauge to first letter plus next consonant', () => {
        expect(scopedShortLabel('Fable')).toBe('Fb');
        expect(scopedShortLabel('Opus')).toBe('Op');
        expect(scopedShortLabel('Nimbus')).toBe('Nm');
        expect(scopedShortLabel('Sonnet')).toBe('Sn');
        expect(scopedShortLabel('Cowork')).toBe('Cw');
        expect(scopedTooltipLabel('Nimbus')).toBe('Nimbus');
    });

    it('takes the first consonant wherever it falls', () => {
        expect(scopedShortLabel('Aeon')).toBe('An');
    });

    it('falls back to the next character when no consonant follows', () => {
        expect(scopedShortLabel('Aeo')).toBe('Ae');
        expect(scopedShortLabel('Q')).toBe('Q');
    });

    it('survives an empty or absent name', () => {
        expect(scopedShortLabel('')).toBe('?');
        expect(scopedShortLabel(null)).toBe('?');
    });

    it('ignores an empty override string rather than blanking the label', () => {
        expect(gaugeLabels('session', { session: { short: '' } }).short).toBe('Se');
        expect(scopedShortLabel('Fable', { Fable: { short: '' } })).toBe('Fb');
    });
});

describe('isGenericPanel', () => {
    it('excludes the gauges that have their own renderer', () => {
        for (const key of ['session', 'weekly', 'credits', 'tokens']) {
            expect(isGenericPanel({ key })).toBe(false);
        }
    });

    it('includes scoped gauges and anything new', () => {
        expect(isGenericPanel({ key: 'scoped:fable', descriptor: BUILTIN_GAUGES.scoped })).toBe(true);
        expect(isGenericPanel({ key: 'monthly' })).toBe(true);
    });
});
