// The Tk context series read from a real transcript file, and the burn towards auto-compact.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PROFILES } = require('../../src/tk/profiles');
const { resetTranscriptCache } = require('../../src/claudeDataLoader');
const { isCompactDrop, readTurnSeries, resetTurnSeriesCache, analyseTurns } = require('../../src/tk/series');

const T0 = Date.UTC(2026, 9, 26, 0, 0, 0);
const MIN = 60 * 1000;
const K = 1000;

// One transcript line: an assistant turn `min` minutes in with a context of `tokens`.
function turn(min, tokens, extra = {}) {
    return JSON.stringify({
        type: 'assistant',
        timestamp: new Date(T0 + min * MIN).toISOString(),
        message: {
            model: 'claude-opus-4-8',
            usage: { input_tokens: 1, output_tokens: 50, cache_read_input_tokens: tokens - 1001, cache_creation_input_tokens: 1000 },
        },
        ...extra,
    });
}
const user = (min) => JSON.stringify({ type: 'user', timestamp: new Date(T0 + min * MIN).toISOString(), message: { content: 'x'.repeat(2000) } });

let dir;
let file;
const write = (lines) => fs.writeFileSync(file, lines.map((l) => `${l}\n`).join(''));
const append = (lines) => fs.appendFileSync(file, lines.map((l) => `${l}\n`).join(''));
const tokens = (series) => series.turns.map((t) => t.tokens / K);

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-tk-series-'));
    file = path.join(dir, 'session.jsonl');
    resetTurnSeriesCache();
    resetTranscriptCache();
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('isCompactDrop', () => {
    it.each([
        ['1M session compacting', 900 * K, 40 * K, true],
        ['200K session compacting', 160 * K, 30 * K, true],
        ['growth', 50 * K, 60 * K, false],
        ['modest shrink', 100 * K, 70 * K, false],
        ['halved but only 10K', 20 * K, 9 * K, false],
        ['exactly half is not under half', 100 * K, 50 * K, false],
    ])('%s', (_name, before, after, expected) => {
        expect(isCompactDrop({ tokens: before }, { tokens: after })).toBe(expected);
    });
});

describe('readTurnSeries', () => {
    it('counts input + cache_read + cache_creation per main-session assistant turn, oldest first', async () => {
        write([turn(0, 30 * K), user(1), turn(2, 40 * K), turn(4, 55 * K)]);
        const series = await readTurnSeries(file);
        expect(tokens(series)).toEqual([30, 40, 55]);
        expect(series.turns[1].ts).toBe(T0 + 2 * MIN);
        expect(series).toMatchObject({ afterCompact: false, truncated: false });
    });

    it('sums the three fields exactly', async () => {
        const line = JSON.stringify({
            type: 'assistant',
            timestamp: new Date(T0).toISOString(),
            message: { model: 'm', usage: { input_tokens: 5, output_tokens: 9, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 } },
        });
        write([line]);
        expect(tokens(await readTurnSeries(file))).toEqual([1.205]);
    });

    it('skips subagent, synthetic, error, zero-token, undated and malformed lines and a torn tail', async () => {
        write([
            turn(0, 30 * K),
            turn(1, 900 * K, { isSidechain: true }),
            JSON.stringify({ ...JSON.parse(turn(2, 900 * K)), message: { model: '<synthetic>', usage: { input_tokens: 5, output_tokens: 1 } } }),
            turn(3, 900 * K, { isApiErrorMessage: true }),
            JSON.stringify({ type: 'assistant', timestamp: new Date(T0).toISOString(), message: { usage: { input_tokens: 0, output_tokens: 0 } } }),
            turn(4, 900 * K, { timestamp: 'not a date' }),
            '{"usage": broken json',
            turn(5, 45 * K),
        ]);
        fs.appendFileSync(file, turn(6, 99 * K).slice(0, 60));
        expect(tokens(await readTurnSeries(file))).toEqual([30, 45]);
    });

    it.each(['whole', 'appended'])('starts a new series at a compaction when %s', async (how) => {
        const before = [turn(0, 100 * K), turn(2, 200 * K), turn(4, 300 * K)];
        const after = [turn(6, 40 * K), turn(8, 60 * K)];
        if (how === 'whole') {
            write([...before, ...after]);
        } else {
            write(before);
            expect(tokens(await readTurnSeries(file))).toEqual([100, 200, 300]);
            append(after);
        }
        const series = await readTurnSeries(file);
        expect(tokens(series)).toEqual([40, 60]);
        expect(series.afterCompact).toBe(true);
    });

    it('keeps the newest maxTurns, whole or appended, and says it truncated', async () => {
        const lines = Array.from({ length: 10 }, (_, k) => turn(k, (10 + k) * K));
        write(lines.slice(0, 6));
        const whole = await readTurnSeries(file, { maxTurns: 4 });
        expect(tokens(whole)).toEqual([12, 13, 14, 15]);
        expect(whole.truncated).toBe(true);
        append(lines.slice(6));
        const grown = await readTurnSeries(file, { maxTurns: 4 });
        expect(tokens(grown)).toEqual([16, 17, 18, 19]);
        expect(grown.truncated).toBe(true);
    });

    it('picks up a torn line once it is completed, without double counting', async () => {
        const second = turn(2, 40 * K);
        write([turn(0, 30 * K)]);
        fs.appendFileSync(file, second.slice(0, 50));
        expect(tokens(await readTurnSeries(file))).toEqual([30]);
        fs.appendFileSync(file, `${second.slice(50)}\n`);
        expect(tokens(await readTurnSeries(file))).toEqual([30, 40]);
    });

    it('rereads in full when the file shrinks underneath the stored offset', async () => {
        write([turn(0, 30 * K), turn(2, 40 * K), turn(4, 50 * K), turn(6, 60 * K)]);
        await readTurnSeries(file);
        write([turn(10, 25 * K)]);
        expect(tokens(await readTurnSeries(file))).toEqual([25]);
    });

    it('returns an empty series for a transcript with no turns and null for a missing file', async () => {
        write([user(0)]);
        expect(await readTurnSeries(file)).toMatchObject({ turns: [], afterCompact: false });
        expect(await readTurnSeries(path.join(dir, 'missing.jsonl'))).toBeNull();
    });

    it('stays consistent when reads overlap with an append', async () => {
        write([turn(0, 30 * K), turn(2, 40 * K)]);
        const reads = [readTurnSeries(file), readTurnSeries(file)];
        append([turn(4, 50 * K)]);
        reads.push(readTurnSeries(file), readTurnSeries(file));
        const results = await Promise.all(reads);
        expect(tokens(results[3])).toEqual([30, 40, 50]);
        results.forEach((r) => expect([2, 3]).toContain(r.turns.length));
    });
});

describe('analyseTurns', () => {
    // Pro profile on a 200K window: auto-compact at 200K - 33K = 167K.
    const ctx = { profile: PROFILES.pro, contextWindow: 200 * K };
    const series = (list) => list.map(([min, k]) => ({ ts: T0 + min * MIN, tokens: k * K }));

    it('returns null with no turns', () => {
        expect(analyseTurns([], { ...ctx, now: T0 })).toBeNull();
    });

    it.each([
        ['one turn', [[0, 50]]],
        ['two turns', [[0, 50], [1, 60]]],
    ])('is measuring with %s but still reports where it stands', (_name, list) => {
        const out = analyseTurns(series(list), { ...ctx, now: T0 + 5 * MIN });
        expect(out).toMatchObject({ state: 'measuring', tokensPerTurn: null, runwayMinutes: null, compactPoint: 167 * K });
        expect(out.pctOfCompact).toBeCloseTo((100 * list[list.length - 1][1]) / 167, 6);
    });

    it('works out the runway to auto-compact from a steady climb', () => {
        const list = Array.from({ length: 8 }, (_, k) => [k, 50 + k * 10]);
        const out = analyseTurns(series(list), { ...ctx, now: T0 + 7 * MIN });
        expect(out.state).toBe('ok');
        expect(out.tokensPerTurn).toBeCloseTo(10 * K, 0);
        expect(out.tokensPerMinute).toBeCloseTo(10 * K, -2);
        // 120K at the last turn leaves 47K.
        expect(out.remainingTokens).toBe(47 * K);
        expect(out.runwayTurns).toBeCloseTo(4.7, 1);
        expect(out.runwayMinutes).toBeCloseTo(4.7, 1);
    });

    it('decays the per-minute rate while idle but keeps the per-turn rate', () => {
        const list = Array.from({ length: 8 }, (_, k) => [k, 50 + k * 10]);
        const live = analyseTurns(series(list), { ...ctx, now: T0 + 7 * MIN });
        const idle = analyseTurns(series(list), { ...ctx, now: T0 + 127 * MIN });
        expect(idle.tokensPerTurn).toBe(live.tokensPerTurn);
        expect(idle.tokensPerMinute).toBeLessThan(live.tokensPerMinute / 10);
        expect(idle.runwayMinutes).toBeGreaterThan(live.runwayMinutes * 10);
    });

    it.each([
        ['flat context', [[0, 80], [1, 80], [2, 80], [3, 80]]],
        ['context shrinking without a compaction', [[0, 90], [1, 85], [2, 80], [3, 75]]],
    ])('has no runway for %s', (_name, list) => {
        const out = analyseTurns(series(list), { ...ctx, now: T0 + 3 * MIN });
        expect(out).toMatchObject({ state: 'ok', tokensPerTurn: 0, tokensPerMinute: 0, runwayTurns: null, runwayMinutes: null });
    });

    it('reports zero runway at or past the compact point', () => {
        const out = analyseTurns(series([[0, 150], [1, 160], [2, 170], [3, 180]]), { ...ctx, now: T0 + 3 * MIN });
        expect(out.remainingTokens).toBe(0);
        expect(out.runwayTurns).toBe(0);
        expect(out.pctOfCompact).toBeGreaterThan(100);
    });

    it('scales the compact point with the window', () => {
        const out = analyseTurns(series([[0, 100], [1, 110], [2, 120]]), { profile: PROFILES.pro, contextWindow: 1_000 * K, now: T0 + 2 * MIN });
        expect(out.compactPoint).toBe(967 * K);
        expect(out.pctOfCompact).toBeCloseTo((100 * 120) / 967, 6);
    });
});
