// Tests for rateLimitDetector.js — classify Claude Code rate-limit
// events from the session JSONL and scan tails for the active state.
//
// Fixtures at tests/fixtures/rate-limit-events.jsonl are anonymised
// real events pulled from the user's JSONL history (see design spec).

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
const {
    TEMPLATES,
    CATEGORIES,
    classify,
    scanTail,
    parseResetTime,
    redactForDebug,
} = require('../../src/rateLimitDetector');

const fixturesPath = path.join(__dirname, '..', 'fixtures', 'rate-limit-events.jsonl');
const fixtureEntries = fs.readFileSync(fixturesPath, 'utf8')
    .trim().split('\n').map(line => JSON.parse(line));

function assistantEntry(timestamp, text, opts = {}) {
    return {
        type: 'assistant',
        timestamp,
        isApiErrorMessage: opts.isApiErrorMessage ?? false,
        error: opts.error,
        message: {
            model: opts.model ?? 'claude-opus-4-6',
            role: 'assistant',
            content: [{ type: 'text', text }],
            usage: { input_tokens: 100, output_tokens: 50 },
        },
    };
}

describe('CATEGORIES', () => {
    it('exports 6 expected categories in stable order', () => {
        expect(CATEGORIES).toEqual([
            'quota', 'spending_cap', 'server_throttle',
            'request_rejected', 'generic', 'unknown',
        ]);
    });
});

describe('TEMPLATES', () => {
    it('exports 5 built-in templates', () => {
        expect(TEMPLATES.length).toBe(5);
    });
    it('each template has prefix + category', () => {
        for (const t of TEMPLATES) {
            expect(typeof t.prefix).toBe('string');
            expect(CATEGORIES).toContain(t.category);
        }
    });
});

describe('classify — built-in templates (each fixture category)', () => {
    it('classifies "You\'ve hit your limit ..." as quota', () => {
        expect(classify(fixtureEntries[0]).category).toBe('quota');
    });
    it('classifies "Server is temporarily limiting ..." as server_throttle', () => {
        expect(classify(fixtureEntries[1]).category).toBe('server_throttle');
    });
    it('classifies "out of extra usage ..." as spending_cap', () => {
        expect(classify(fixtureEntries[2]).category).toBe('spending_cap');
    });
    it('classifies "Request rejected ..." as request_rejected', () => {
        expect(classify(fixtureEntries[3]).category).toBe('request_rejected');
    });
    it('classifies "Rate limit reached" as generic', () => {
        expect(classify(fixtureEntries[4]).category).toBe('generic');
    });
    it('includes timestamp as Date', () => {
        expect(classify(fixtureEntries[0]).timestamp).toBeInstanceOf(Date);
    });
    it('parses reset time for quota category', () => {
        const c = classify(fixtureEntries[0]);
        expect(c.resetTime).toMatchObject({ hour: 18, minute: 0, tz: 'Australia/Sydney' });
    });
});

describe('classify — non-rate-limit entries return null', () => {
    it('null for a normal assistant message', () => {
        expect(classify(assistantEntry('2026-04-18T10:00:00Z', 'Here is your code.'))).toBeNull();
    });
    it('null for a user message', () => {
        expect(classify({ type: 'user', message: { content: 'help' } })).toBeNull();
    });
    it('null for missing isApiErrorMessage', () => {
        const entry = assistantEntry('2026-04-18T10:00:00Z', "You've hit your limit",
            { error: 'rate_limit' });
        expect(classify(entry)).toBeNull();
    });
    it('null for non-rate_limit error', () => {
        const entry = assistantEntry('2026-04-18T10:00:00Z', 'Something broke',
            { isApiErrorMessage: true, error: 'other' });
        expect(classify(entry)).toBeNull();
    });
    it('null for null input', () => {
        expect(classify(null)).toBeNull();
    });
});

describe('classify — unknown templates fall back safely', () => {
    it('returns category unknown for unrecognised text', () => {
        const entry = assistantEntry('2026-04-18T10:00:00Z',
            'API Error: Some totally new shape we haven\'t seen',
            { isApiErrorMessage: true, error: 'rate_limit', model: '<synthetic>' });
        const c = classify(entry);
        expect(c.category).toBe('unknown');
        expect(c.unknownSample).toBeTruthy();
    });
});

describe('classify — customTemplates evaluated first', () => {
    it('custom prefix catches variant wording', () => {
        const custom = [{ prefix: 'Your enterprise seat', category: 'quota' }];
        const entry = assistantEntry('2026-04-18T10:00:00Z',
            'Your enterprise seat has hit its weekly quota',
            { isApiErrorMessage: true, error: 'rate_limit', model: '<synthetic>' });
        expect(classify(entry, custom).category).toBe('quota');
    });
});

describe('parseResetTime', () => {
    it('parses "resets 6pm (Australia/Sydney)"', () => {
        const r = parseResetTime("You've hit your limit · resets 6pm (Australia/Sydney)");
        expect(r).toMatchObject({ hour: 18, minute: 0, tz: 'Australia/Sydney' });
    });
    it('parses "resets 9:30am (America/Los_Angeles)"', () => {
        const r = parseResetTime('resets 9:30am (America/Los_Angeles)');
        expect(r).toMatchObject({ hour: 9, minute: 30, tz: 'America/Los_Angeles' });
    });
    it('parses 12pm → hour 12', () => {
        const r = parseResetTime('resets 12pm (UTC)');
        expect(r.hour).toBe(12);
    });
    it('parses 12am → hour 0', () => {
        const r = parseResetTime('resets 12am (UTC)');
        expect(r.hour).toBe(0);
    });
    it('returns null when no reset time present', () => {
        expect(parseResetTime('API Error: Rate limit reached')).toBeNull();
    });
    it('returns null for non-string input', () => {
        expect(parseResetTime(null)).toBeNull();
    });
});

describe('scanTail — active state detection', () => {
    const now = new Date('2026-04-16T05:40:00Z');
    const config = { lookbackMs: 600000, safetyTimeoutMs: 1800000 };

    it('returns inactive on empty list', () => {
        expect(scanTail([], now, config)).toMatchObject({ active: false });
    });

    it('returns inactive on null list', () => {
        expect(scanTail(null, now, config)).toMatchObject({ active: false });
    });

    it('returns active when RL event within lookback', () => {
        const state = scanTail([fixtureEntries[0]], now, config);
        expect(state.active).toBe(true);
        expect(state.category).toBe('quota');
    });

    it('returns inactive when RL event older than lookback', () => {
        const far = new Date('2026-04-16T06:00:00Z');
        expect(scanTail([fixtureEntries[0]], far,
            { lookbackMs: 60000, safetyTimeoutMs: 1800000 }).active).toBe(false);
    });

    it('clears when normal assistant msg lands after RL event', () => {
        const success = assistantEntry('2026-04-16T05:32:00Z', 'Here we go.');
        const state = scanTail([fixtureEntries[0], success], now, config);
        expect(state.active).toBe(false);
        expect(state.successAfter).toBeInstanceOf(Date);
    });

    it('stays active when normal assistant msg is BEFORE RL event', () => {
        const earlier = assistantEntry('2026-04-16T05:30:00Z', 'Earlier reply.');
        expect(scanTail([earlier, fixtureEntries[0]], now, config).active).toBe(true);
    });

    it('safety timeout hides stale RL regardless of lookback', () => {
        expect(scanTail([fixtureEntries[0]], now,
            { lookbackMs: 3600000, safetyTimeoutMs: 60000 }).active).toBe(false);
    });

    it('detects a burst: firstSeen < lastSeen', () => {
        const burst = Array.from({ length: 14 }, (_, i) => ({
            ...fixtureEntries[1],
            timestamp: new Date(Date.parse('2026-04-16T01:04:10Z') + i * 5000).toISOString(),
        }));
        const nowBurst = new Date('2026-04-16T01:06:00Z');
        const state = scanTail(burst, nowBurst, config);
        expect(state.active).toBe(true);
        expect(state.firstSeen.getTime()).toBeLessThan(state.lastSeen.getTime());
    });

    it('skips malformed entries gracefully', () => {
        const entries = [null, fixtureEntries[0], {}, { type: 'garbage' }];
        expect(scanTail(entries, now, config).active).toBe(true);
    });
});

describe('redactForDebug', () => {
    it('trims long text', () => {
        const long = 'x'.repeat(500);
        expect(redactForDebug(long).length).toBeLessThanOrEqual(140);
    });
    it('masks UUIDs', () => {
        const s = redactForDebug('Request rejected (abc12345-def6-7890-abcd-ef1234567890)');
        expect(s).toContain('<redacted>');
    });
    it('returns empty for non-string', () => {
        expect(redactForDebug(null)).toBe('');
    });
});
