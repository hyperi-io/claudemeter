//  Project:      Claudemeter
//  File:         src/tk/series.js
//  Purpose:      Per-turn context size of the main Claude Code session, and its burn towards auto-compact.
//
//                The series is read from a session transcript through the scanners in
//                claudeDataLoader.js, so a turn counts exactly as the Tk gauge counts it.
//                Subagent transcripts (agent-*.jsonl) are separate context windows and are
//                never passed in. A sharp fall in context size is a compaction and starts
//                a new series.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const fs = require('fs').promises;
const { promptOfRecord, forEachLine, forEachLineBackward, lastLineEnd } = require('../claudeDataLoader');
const { smoothedRate, MINUTE_MS } = require('../burn');
const { compactPointOf } = require('./thresholds');

// A turn that falls to under half the previous context, by at least this many tokens, is a compaction.
const COMPACT_DROP_RATIO = 0.5;
const COMPACT_MIN_DROP_TOKENS = 20_000;
const DEFAULT_MAX_TURNS = 300;
const MIN_TURNS = 3;
const PER_TURN_ALPHA = 0.3;
const MEMO_MAX = 16;

function isCompactDrop(before, after) {
    return after.tokens < before.tokens * COMPACT_DROP_RATIO
        && before.tokens - after.tokens >= COMPACT_MIN_DROP_TOKENS;
}

// { ts, tokens } for a transcript line that is a main-session assistant turn, else null.
function turnOfLine(line) {
    // Usage rides only on assistant turns, so the other lines skip the JSON parse.
    if (line === null || line.indexOf('"usage"') === -1) return null;
    let entry;
    try {
        entry = JSON.parse(line.toString('utf-8'));
    } catch {
        return null;
    }
    const prompt = entry && typeof entry === 'object' ? promptOfRecord(entry) : null;
    return prompt && prompt.lastActivity !== null ? { ts: prompt.lastActivity, tokens: prompt.contextTotal } : null;
}

function addTurn(state, turn, maxTurns) {
    const last = state.turns[state.turns.length - 1];
    if (last && isCompactDrop(last, turn)) {
        state.turns = [turn];
        state.afterCompact = true;
        state.truncated = false;
        return;
    }
    state.turns.push(turn);
    if (state.turns.length > maxTurns) {
        state.turns.splice(0, state.turns.length - maxTurns);
        state.truncated = true;
    }
}

// Newest first from the end of the file, stopping at the last compaction or maxTurns.
async function readBack(handle, size, maxTurns) {
    const readAt = await lastLineEnd(handle, size);
    const newestFirst = [];
    const state = { turns: [], afterCompact: false, truncated: false, readAt };
    await forEachLineBackward(handle, readAt, (line) => {
        const turn = turnOfLine(line);
        if (!turn) return false;
        const newer = newestFirst[newestFirst.length - 1];
        if (newer && isCompactDrop(turn, newer)) {
            state.afterCompact = true;
            return true;
        }
        newestFirst.push(turn);
        state.truncated = newestFirst.length >= maxTurns;
        return state.truncated;
    });
    state.turns = newestFirst.reverse();
    return state;
}

// Per file, what was read and where it ended, so a refresh reads only the appended bytes.
const memos = new Map();
const chains = new Map();

async function readOnce(filePath, maxTurns) {
    let handle = null;
    try {
        handle = await fs.open(filePath, 'r');
        const stats = await handle.stat();
        const memo = memos.get(filePath);
        let state;
        // Transcripts are append-only, so growth on the same inode keeps the stored offset valid.
        if (memo && memo.maxTurns === maxTurns && memo.ino === stats.ino && stats.size >= memo.size) {
            state = { ...memo.state, turns: [...memo.state.turns] };
            if (stats.size > memo.size) {
                state.readAt = await forEachLine(handle, memo.state.readAt, stats.size, (line) => {
                    const turn = turnOfLine(line);
                    if (turn) addTurn(state, turn, maxTurns);
                });
            }
        } else {
            state = await readBack(handle, stats.size, maxTurns);
        }
        memos.delete(filePath);
        memos.set(filePath, { maxTurns, ino: stats.ino, size: stats.size, state });
        while (memos.size > MEMO_MAX) memos.delete(memos.keys().next().value);
        return { turns: [...state.turns], afterCompact: state.afterCompact, truncated: state.truncated };
    } catch {
        return null;
    } finally {
        if (handle) await handle.close().catch(() => {});
    }
}

// The context size of each main-session turn since the last compaction, oldest first:
// { turns: [{ ts, tokens }], afterCompact, truncated }, or null when the file cannot be read.
// Concurrent calls for one file run one after another, so the stored offset only moves forward.
function readTurnSeries(filePath, { maxTurns = DEFAULT_MAX_TURNS } = {}) {
    const run = (chains.get(filePath) || Promise.resolve()).then(() => readOnce(filePath, maxTurns));
    const tail = run.then(() => {}, () => {});
    chains.set(filePath, tail);
    tail.then(() => {
        if (chains.get(filePath) === tail) chains.delete(filePath);
    });
    return run;
}

function resetTurnSeriesCache() {
    memos.clear();
    chains.clear();
}

// Burn towards the auto-compact point, or null with no turns. state is 'measuring' under 3 turns.
// Idle time since the last turn counts as no growth, so the per-minute rate decays while you are away.
function analyseTurns(turns, { profile, contextWindow, now = Date.now() }) {
    if (!turns.length) return null;
    const latest = turns[turns.length - 1];
    const compactPoint = compactPointOf(profile, contextWindow);
    const remainingTokens = Math.max(0, compactPoint - latest.tokens);
    const base = {
        latest,
        turns: turns.length,
        compactPoint,
        remainingTokens,
        pctOfCompact: (100 * latest.tokens) / compactPoint,
    };
    if (turns.length < MIN_TURNS) {
        return { ...base, state: 'measuring', tokensPerTurn: null, tokensPerMinute: null, runwayTurns: null, runwayMinutes: null };
    }

    let perTurn = null;
    for (let i = 1; i < turns.length; i++) {
        const growth = turns[i].tokens - turns[i - 1].tokens;
        perTurn = perTurn === null ? growth : perTurn + PER_TURN_ALPHA * (growth - perTurn);
    }
    const timed = turns.map((t) => ({ ts: t.ts, v: t.tokens }));
    if (now > latest.ts) timed.push({ ts: now, v: latest.tokens });
    const tokensPerTurn = Math.max(0, perTurn);
    const tokensPerMinute = Math.max(0, smoothedRate(timed) ?? 0) * MINUTE_MS;
    return {
        ...base,
        state: 'ok',
        tokensPerTurn,
        tokensPerMinute,
        runwayTurns: tokensPerTurn > 0 ? remainingTokens / tokensPerTurn : null,
        runwayMinutes: tokensPerMinute > 0 ? remainingTokens / tokensPerMinute : null,
    };
}

module.exports = {
    COMPACT_DROP_RATIO,
    COMPACT_MIN_DROP_TOKENS,
    isCompactDrop,
    readTurnSeries,
    resetTurnSeriesCache,
    analyseTurns,
};
