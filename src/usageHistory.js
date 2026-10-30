// Project:   Claudemeter
// File:      usageHistory.js
// Purpose:   Shared on-disk history of usage samples, one per live fetch, across VS Code windows.
// Language:  JavaScript (CommonJS)
//
// Lives beside usage-cache.json in the claudemeter config dir. usageCache appends one sample
// each time a window really fetches, under a lock of its own, so windows never lose each
// other's samples. The burn maths over these samples is in burn.js.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const fs = require('fs').promises;
const path = require('path');
const { acquireFileLock, releaseFileLock, atomicWriteJson } = require('./sessionTracker');

const HISTORY_BASENAME = 'usage-history.json';
const RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
// Fetches are at least 30 s apart, so 8 days is under 23K samples and this keeps the file near 1 MB.
const MAX_SAMPLES = 8000;
// A second sample this close to an existing one is another window's copy of the same fetch.
const MIN_GAP_MS = 15 * 1000;
const FORMAT_VERSION = 1;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function epochMs(v) {
    const t = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(t) ? t : null;
}

const gauge = (pct, resetsAt) => ({ pct, resetsAt: epochMs(resetsAt) });

function historyFileFor(cacheFile) {
    return path.join(path.dirname(cacheFile), HISTORY_BASENAME);
}

// The sample a usageData describes, or null when it carries no utilisation at all.
function sampleOf(usageData, ts) {
    if (!usageData || !Number.isFinite(ts)) return null;
    const five = num(usageData.usagePercent);
    const seven = num(usageData.usagePercentWeek);
    if (five === null && seven === null) return null;
    const scoped = {};
    for (const s of usageData.scopedWeekly || []) {
        if (s && typeof s.key === 'string' && num(s.percent) !== null) scoped[s.key] = gauge(s.percent, s.resetsAt);
    }
    return {
        ts,
        fiveHour: gauge(five, usageData.resetsAt),
        sevenDay: gauge(seven, usageData.resetsAtWeek),
        scoped,
    };
}

const isSample = (s) => !!s && typeof s === 'object' && Number.isFinite(s.ts);

// The stored samples, oldest first. A missing, corrupt or other-account file reads as empty.
async function readSamples(file, account) {
    try {
        const body = JSON.parse(await fs.readFile(file, 'utf8'));
        const owner = body?.account ?? null;
        if (owner !== null && owner !== (account ?? null)) return [];
        return Array.isArray(body?.samples) ? body.samples.filter(isSample).sort((a, b) => a.ts - b.ts) : [];
    } catch {
        return [];
    }
}

async function readUsageHistory({ file, account = null, now = Date.now() }) {
    return (await readSamples(file, account)).filter((s) => s.ts >= now - RETENTION_MS);
}

// Add a sample to a stored list: expired and near-duplicate samples go, the newest MAX_SAMPLES stay.
function mergeSample(samples, sample, now) {
    const kept = samples.filter((s) => s.ts >= now - RETENTION_MS);
    if (kept.some((s) => Math.abs(s.ts - sample.ts) < MIN_GAP_MS)) return kept;
    kept.push(sample);
    kept.sort((a, b) => a.ts - b.ts);
    return kept.slice(-MAX_SAMPLES);
}

// Record one fetch. Resolves true when a sample was written, false when there was nothing to
// record or another window already recorded this fetch. Rejects on I/O failure, which callers
// treat as non-fatal. A file owned by another account is replaced.
async function appendUsageSample(usageData, { file, account = null, ts = Date.now() }) {
    const sample = sampleOf(usageData, ts);
    if (!sample) return false;
    return appendSample(sample, { file, account });
}

// Record one already-built sample, with the same lock, dedupe and retention as a usage fetch.
async function appendSample(sample, { file, account = null }) {
    const { ts } = sample;
    const lock = await acquireFileLock(file, { timeoutMs: 5000 });
    try {
        const before = await readSamples(file, account);
        const samples = mergeSample(before, sample, ts);
        if (samples.length === before.length && samples.every((s, i) => s === before[i])) return false;
        await atomicWriteJson(file, { version: FORMAT_VERSION, account, samples }, 0);
        return true;
    } finally {
        await releaseFileLock(lock);
    }
}

module.exports = {
    HISTORY_BASENAME,
    RETENTION_MS,
    MAX_SAMPLES,
    MIN_GAP_MS,
    historyFileFor,
    sampleOf,
    mergeSample,
    readUsageHistory,
    appendUsageSample,
    appendSample,
};
