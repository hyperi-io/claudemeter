// The shared usage history against real files in a tmp dir: concurrent windows,
// retention, the size cap, other accounts and a damaged file.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    RETENTION_MS, MAX_SAMPLES, MIN_GAP_MS,
    historyFileFor, sampleOf, readUsageHistory, appendUsageSample,
} = require('../../src/usageHistory');
const { cachedFetchUsage } = require('../../src/usageCache');

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const RESET_ISO = '2026-10-26T15:00:00.000Z';
const WEEK_ISO = '2026-11-01T00:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;

const usage = (five, week = 20, extra = {}) => ({
    usagePercent: five,
    resetsAt: RESET_ISO,
    usagePercentWeek: week,
    resetsAtWeek: WEEK_ISO,
    scopedWeekly: [],
    ...extra,
});

let dir;
let file;
const read = (account = null) => readUsageHistory({ file, account, now: NOW });
const append = (data, ts, account = null) => appendUsageSample(data, { file, account, ts });
const sampleAt = (ts, pct = 1) => ({ ts, fiveHour: { pct, resetsAt: null }, sevenDay: { pct: 0, resetsAt: null }, scoped: {} });

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-usage-history-'));
    file = path.join(dir, 'usage-history.json');
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('sampleOf', () => {
    it('maps the usage payload to epoch-ms gauges, scoped caps included', () => {
        const scopedWeekly = [{ key: 'scoped:sonnet', percent: 7, resetsAt: WEEK_ISO }];
        expect(sampleOf(usage(12.5, 30, { scopedWeekly }), NOW)).toEqual({
            ts: NOW,
            fiveHour: { pct: 12.5, resetsAt: Date.parse(RESET_ISO) },
            sevenDay: { pct: 30, resetsAt: Date.parse(WEEK_ISO) },
            scoped: { 'scoped:sonnet': { pct: 7, resetsAt: Date.parse(WEEK_ISO) } },
        });
    });

    it.each([
        ['no usageData', null, NOW],
        ['no utilisation at all', {}, NOW],
        ['a non-numeric percentage', { usagePercent: '12', usagePercentWeek: null }, NOW],
        ['a bad timestamp', usage(1), NaN],
    ])('records nothing for %s', (_name, data, ts) => {
        expect(sampleOf(data, ts)).toBeNull();
    });

    it('keeps a null resetsAt and skips scoped entries without a key or percent', () => {
        const scopedWeekly = [{ percent: 3 }, { key: 'scoped:opus' }, { key: 'scoped:ok', percent: 4, resetsAt: 'junk' }];
        const sample = sampleOf(usage(1, 2, { resetsAt: null, scopedWeekly }), NOW);
        expect(sample.fiveHour.resetsAt).toBeNull();
        expect(sample.scoped).toEqual({ 'scoped:ok': { pct: 4, resetsAt: null } });
    });
});

describe('appendUsageSample', () => {
    it('writes a compact file that reads back in time order', async () => {
        await append(usage(10), NOW);
        await append(usage(5), NOW - 10 * MIN_GAP_MS);
        expect((await read()).map((s) => s.fiveHour.pct)).toEqual([5, 10]);
        expect(fs.readFileSync(file, 'utf8')).not.toContain('\n');
    });

    it('returns false and writes nothing for a payload with no utilisation', async () => {
        expect(await append({}, NOW)).toBe(false);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('keeps one sample when two windows record the same fetch', async () => {
        const [a, b] = await Promise.all([append(usage(10), NOW), append(usage(10), NOW + 1000)]);
        expect([a, b].sort()).toEqual([false, true]);
        expect(await read()).toHaveLength(1);
    });

    it('keeps every sample from concurrent windows that fetched at different times', async () => {
        const results = await Promise.all(Array.from({ length: 12 }, (_, k) => append(usage(k), NOW + k * 2 * MIN_GAP_MS)));
        expect(results.every(Boolean)).toBe(true);
        expect((await read()).map((s) => s.fiveHour.pct)).toEqual(Array.from({ length: 12 }, (_, k) => k));
        expect(fs.readdirSync(dir).sort()).toEqual(['usage-history.json']);
    });

    it('drops samples older than the retention window and keeps the rest', async () => {
        fs.writeFileSync(file, JSON.stringify({ version: 1, account: null, samples: [sampleAt(NOW - RETENTION_MS - 1), sampleAt(NOW - DAY)] }));
        await append(usage(10), NOW);
        expect((await read()).map((s) => s.ts)).toEqual([NOW - DAY, NOW]);
        expect(JSON.parse(fs.readFileSync(file, 'utf8')).samples).toHaveLength(2);
    });

    it('caps the file at MAX_SAMPLES, newest kept, and stays near 1 MB', async () => {
        const seeded = Array.from({ length: MAX_SAMPLES + 5 }, (_, k) => sampleAt(NOW - DAY + k * 1000, k));
        fs.writeFileSync(file, JSON.stringify({ version: 1, account: null, samples: seeded }));
        await append(usage(10), NOW);
        const samples = await read();
        expect(samples).toHaveLength(MAX_SAMPLES);
        expect(samples[samples.length - 1].ts).toBe(NOW);
        expect(samples[0].ts).toBe(NOW - DAY + 6 * 1000);
        expect(fs.statSync(file).size).toBeLessThan(2 * 1024 * 1024);
    });

    it.each([
        ['not JSON', '{not json'],
        ['an empty file', ''],
        ['a JSON null', 'null'],
        ['samples that is not a list', '{"samples": 5}'],
    ])('recovers from a damaged file: %s', async (_name, body) => {
        fs.writeFileSync(file, body);
        expect(await read()).toEqual([]);
        expect(await append(usage(10), NOW)).toBe(true);
        expect(await read()).toHaveLength(1);
    });

    it('filters junk entries out of an otherwise good file', async () => {
        fs.writeFileSync(file, JSON.stringify({ version: 1, samples: [null, 'x', { ts: 'bad' }, sampleAt(NOW - DAY)] }));
        expect(await read()).toHaveLength(1);
    });

    it('does not mix accounts: the other account reads empty and a write replaces it', async () => {
        await append(usage(10), NOW - 5 * MIN_GAP_MS, 'acct-a');
        expect(await read('acct-b')).toEqual([]);
        await append(usage(40), NOW, 'acct-b');
        expect((await read('acct-b')).map((s) => s.fiveHour.pct)).toEqual([40]);
        expect(await read('acct-a')).toEqual([]);
    });

    it('stores a sample stamped by a fast clock and orders it by its stamp', async () => {
        await append(usage(1), NOW);
        await append(usage(2), NOW + DAY);
        await append(usage(3), NOW + 5 * MIN_GAP_MS);
        expect((await read()).map((s) => s.fiveHour.pct)).toEqual([1, 3, 2]);
    });
});

describe('cachedFetchUsage history', () => {
    let cacheFile;
    beforeEach(() => {
        cacheFile = path.join(dir, 'usage-cache.json');
    });

    it('records one sample per live fetch, beside the cache, and no second one for its cache hit', async () => {
        const fetchFn = async () => usage(10);
        await cachedFetchUsage(fetchFn, 120000, { cacheFile });
        const hit = await cachedFetchUsage(fetchFn, 120000, { cacheFile });
        expect(hit.fromCache).toBe(true);
        expect(historyFileFor(cacheFile)).toBe(file);
        expect(await read()).toHaveLength(1);
    });

    it('records a fresh cache written by a window that keeps no history, once per fetch', async () => {
        const fetchedAt = Date.now() - 1000;
        fs.writeFileSync(cacheFile, JSON.stringify({ usageData: usage(30), fetchedAt, account: null }));
        const fetchFn = async () => { throw new Error('a fresh cache must not fetch'); };
        await cachedFetchUsage(fetchFn, 120000, { cacheFile });
        await cachedFetchUsage(fetchFn, 120000, { cacheFile });
        expect(await read()).toEqual([expect.objectContaining({ ts: fetchedAt, fiveHour: expect.objectContaining({ pct: 30 }) })]);
    });

    it('records one sample when two windows ask at once', async () => {
        let calls = 0;
        const fetchFn = async () => { calls++; return usage(10); };
        await Promise.all([
            cachedFetchUsage(fetchFn, 120000, { cacheFile }),
            cachedFetchUsage(fetchFn, 120000, { cacheFile }),
        ]);
        expect(calls).toBe(1);
        expect(await read()).toHaveLength(1);
    });

    it('still returns the fetch when the history file cannot be written', async () => {
        fs.mkdirSync(file);
        const res = await cachedFetchUsage(async () => usage(10), 120000, { cacheFile });
        expect(res.fromCache).toBe(false);
        expect(res.usageData.usagePercent).toBe(10);
    });
});
