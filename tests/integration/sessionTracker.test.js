// Integration tests for sessionTracker atomic writes and concurrent merging.
//
// Goal: prove that multiple VS Code instances writing to the same
// session-data.json don't clobber each other's sessions.
//
// These tests run in a tmp dir and use real file I/O (no mocks), because
// the race condition only appears against actual OS semantics.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { setImmediate } = require('timers');
const {
    SessionTracker,
    atomicWriteJson,
    mergeSessionData,
} = require('../../src/sessionTracker');

let tmpDir;
let sessionFile;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-sessions-'));
    sessionFile = path.join(tmpDir, 'session-data.json');
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readFileAsJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('atomicWriteJson', () => {
    it('writes a file that can be read back as valid JSON', async () => {
        const target = path.join(tmpDir, 'obj.json');
        await atomicWriteJson(target, { hello: 'world' });
        expect(readFileAsJson(target)).toEqual({ hello: 'world' });
    });

    it('overwrites an existing file atomically (no torn intermediate state)', async () => {
        const target = path.join(tmpDir, 'obj.json');
        fs.writeFileSync(target, JSON.stringify({ old: true }));
        await atomicWriteJson(target, { new: true });
        expect(readFileAsJson(target)).toEqual({ new: true });
    });

    it('cleans up the temp file on success', async () => {
        const target = path.join(tmpDir, 'obj.json');
        await atomicWriteJson(target, { x: 1 });
        const leftoverTemps = fs.readdirSync(tmpDir).filter(n => n.includes('.tmp'));
        expect(leftoverTemps).toEqual([]);
    });

    it('survives rapid repeated writes without corrupting target', async () => {
        const target = path.join(tmpDir, 'obj.json');
        for (let i = 0; i < 20; i++) {
            await atomicWriteJson(target, { count: i });
        }
        expect(readFileAsJson(target)).toEqual({ count: 19 });
    });
});

describe('mergeSessionData', () => {
    function makeSession(id, when, current = 0) {
        return {
            sessionId: id,
            startTime: when,
            tokenUsage: {
                current,
                limit: 200000,
                remaining: 200000 - current,
                lastUpdate: when,
            },
        };
    }

    it('returns empty shape when both inputs are null', () => {
        const result = mergeSessionData(null, null);
        expect(result.sessions).toEqual([]);
        expect(result.totals.totalSessions).toBe(0);
    });

    it('keeps sessions from both sides', () => {
        const existing = { sessions: [makeSession('a', '2026-04-11T10:00:00Z')] };
        const incoming = { sessions: [makeSession('b', '2026-04-11T11:00:00Z')] };
        const merged = mergeSessionData(existing, incoming);
        expect(merged.sessions.map(s => s.sessionId).sort()).toEqual(['a', 'b']);
    });

    it('newest record per sessionId wins (by lastUpdate)', () => {
        const older = makeSession('shared', '2026-04-11T10:00:00Z', 1000);
        older.tokenUsage.lastUpdate = '2026-04-11T10:00:00Z';
        const newer = makeSession('shared', '2026-04-11T10:00:00Z', 5000);
        newer.tokenUsage.lastUpdate = '2026-04-11T11:00:00Z';

        const merged = mergeSessionData({ sessions: [older] }, { sessions: [newer] });
        expect(merged.sessions).toHaveLength(1);
        expect(merged.sessions[0].tokenUsage.current).toBe(5000);
    });

    it('re-derives totals from merged sessions', () => {
        const s1 = makeSession('a', '2026-04-11T10:00:00Z', 100);
        const s2 = makeSession('b', '2026-04-11T11:00:00Z', 200);
        const merged = mergeSessionData({ sessions: [s1] }, { sessions: [s2] });
        expect(merged.totals.totalSessions).toBe(2);
        expect(merged.totals.totalTokensUsed).toBe(300);
        expect(merged.totals.lastSessionDate).toBe('2026-04-11T11:00:00Z');
    });

    it('sorts merged sessions chronologically', () => {
        const later = makeSession('b', '2026-04-11T12:00:00Z');
        const earlier = makeSession('a', '2026-04-11T09:00:00Z');
        const merged = mergeSessionData({ sessions: [later] }, { sessions: [earlier] });
        expect(merged.sessions.map(s => s.sessionId)).toEqual(['a', 'b']);
    });

    it('ignores malformed session entries without sessionId', () => {
        const merged = mergeSessionData(
            { sessions: [{ noId: true }] },
            { sessions: [{ sessionId: 'ok', startTime: '2026-04-11T10:00:00Z', tokenUsage: {} }] }
        );
        expect(merged.sessions).toHaveLength(1);
        expect(merged.sessions[0].sessionId).toBe('ok');
    });
});

describe('SessionTracker multi-instance safety', () => {
    it('two instances each starting a session both end up in the file', async () => {
        const a = new SessionTracker(sessionFile);
        const b = new SessionTracker(sessionFile);

        await a.startSession('Session from A');
        await b.startSession('Session from B');

        const onDisk = readFileAsJson(sessionFile);
        expect(onDisk.sessions).toHaveLength(2);
        const descriptions = onDisk.sessions.map(s => s.description).sort();
        expect(descriptions).toEqual(['Session from A', 'Session from B']);
    });

    it('concurrent updateTokens calls from two instances do not lose either session', async () => {
        const a = new SessionTracker(sessionFile);
        const b = new SessionTracker(sessionFile);

        await a.startSession('A');
        await b.startSession('B');

        // Race: both instances try to update their own session's tokens
        // at roughly the same time.
        await Promise.all([
            a.updateTokens(1111),
            b.updateTokens(2222),
        ]);

        const onDisk = readFileAsJson(sessionFile);
        expect(onDisk.sessions).toHaveLength(2);

        const found = new Map(onDisk.sessions.map(s => [s.description, s.tokenUsage.current]));
        expect(found.get('A')).toBe(1111);
        expect(found.get('B')).toBe(2222);
    });

    it('concurrent saveData calls from many instances do not corrupt JSON', async () => {
        const instances = Array.from({ length: 10 }, () => new SessionTracker(sessionFile));
        await Promise.all(instances.map((t, i) => t.startSession(`S${i}`)));

        // Every call should leave the file as valid JSON with sorted sessions
        const parsed = readFileAsJson(sessionFile);
        expect(parsed.sessions.length).toBeGreaterThanOrEqual(1);
        expect(parsed.sessions.length).toBeLessThanOrEqual(10);
        // Every session entry must have a sessionId
        for (const s of parsed.sessions) {
            expect(s.sessionId).toBeTruthy();
        }
    });

    it('second instance sees the first instance\'s sessions after a fresh load', async () => {
        const a = new SessionTracker(sessionFile);
        await a.startSession('From A');

        // Fresh tracker instance - should read what A wrote
        const b = new SessionTracker(sessionFile);
        const data = await b.loadData({ useCache: false });
        expect(data.sessions).toHaveLength(1);
        expect(data.sessions[0].description).toBe('From A');
    });

    it('does not leave temp files behind after many operations', async () => {
        const t = new SessionTracker(sessionFile);
        for (let i = 0; i < 5; i++) {
            await t.startSession(`Iter ${i}`);
        }
        const leftoverTemps = fs.readdirSync(tmpDir).filter(n => n.includes('.tmp'));
        expect(leftoverTemps).toEqual([]);
    });
});

describe('file lock ownership', () => {
    const { acquireFileLock, releaseFileLock, STALE_LOCK_MS } = require('../../src/sessionTracker');

    const otherOwner = JSON.stringify({ pid: 999999, ts: Date.now(), nonce: 'someone-else' });

    it('records the holder pid and time in the lock file', async () => {
        const lock = await acquireFileLock(sessionFile);
        const body = JSON.parse(fs.readFileSync(`${sessionFile}.lock`, 'utf8'));
        expect(body.pid).toBe(process.pid);
        expect(typeof body.ts).toBe('number');
        await releaseFileLock(lock);
    });

    it('release leaves alone a lock another holder has since taken', async () => {
        const lock = await acquireFileLock(sessionFile);
        // Our lock was stolen as stale and another holder now owns the path.
        fs.writeFileSync(`${sessionFile}.lock`, otherOwner);
        await releaseFileLock(lock);
        expect(fs.readFileSync(`${sessionFile}.lock`, 'utf8')).toBe(otherOwner);
    });

    it('a stale-lock steal does not unlink a fresh lock that replaced it', async () => {
        const lockPath = `${sessionFile}.lock`;
        const old = new Date(Date.now() - STALE_LOCK_MS - 60000);
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 1, ts: 0, nonce: 'crashed' }));
        fs.utimesSync(lockPath, old, old);

        // A live holder keeps re-taking the lock while the acquirer works. Its mtime
        // stays old (so the age check alone would steal) but the body changes every
        // event-loop turn, so the acquirer's two body reads either side of its stat
        // always differ and it must back off.
        let n = 0;
        let vanished = false;
        let running = true;
        const holder = () => {
            if (!running) return;
            if (!fs.existsSync(lockPath)) vanished = true;
            // Written beside the lock and renamed over it, so a reader never sees a torn body.
            const next = `${lockPath}.next`;
            fs.writeFileSync(next, JSON.stringify({ pid: 999999, ts: Date.now(), nonce: `someone-else-${n++}` }));
            fs.utimesSync(next, old, old);
            fs.renameSync(next, lockPath);
            setImmediate(holder);
        };
        const acquiring = acquireFileLock(sessionFile, { timeoutMs: 300 });
        setImmediate(holder);

        try {
            await expect(acquiring).rejects.toThrow(/Could not acquire lock/);
        } finally {
            running = false;
        }
        expect(vanished).toBe(false);
        expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).nonce).toMatch(/^someone-else-/);
    });

    it('treats a lock as stale only past the longest legitimate hold', () => {
        // usageCache holds the lock across up to three 15 s fetch rounds.
        expect(STALE_LOCK_MS).toBeGreaterThan(3 * 15000);
    });
});

describe('SessionTracker - one session per window', () => {
    it('a fresh window does not adopt another window\'s session', async () => {
        const a = new SessionTracker(sessionFile);
        await a.updateTokens(111111);

        const b = new SessionTracker(sessionFile);
        expect(await b.getCurrentSession()).toBeNull();
        await b.updateTokens(999999);

        const onDisk = readFileAsJson(sessionFile);
        expect(onDisk.sessions).toHaveLength(2);
        const values = onDisk.sessions.map((s) => s.tokenUsage.current).sort((x, y) => x - y);
        expect(values).toEqual([111111, 999999]);
    });

    it('gives concurrently started windows distinct session ids', async () => {
        const trackers = Array.from({ length: 5 }, () => new SessionTracker(sessionFile));
        const sessions = await Promise.all(trackers.map((t) => t.startSession('w')));
        expect(new Set(sessions.map((s) => s.sessionId)).size).toBe(5);
    });

    it('recordTokens writes only the newest value when calls pile up', async () => {
        const t = new SessionTracker(sessionFile);
        const writes = [];
        const realUpdate = t.updateTokens.bind(t);
        t.updateTokens = async (n, ...rest) => { writes.push(n); return realUpdate(n, ...rest); };
        await Promise.all([t.recordTokens(1), t.recordTokens(2), t.recordTokens(3)]);
        expect(writes).toEqual([1, 3]);
        const onDisk = readFileAsJson(sessionFile);
        expect(onDisk.sessions).toHaveLength(1);
        expect(onDisk.sessions[0].tokenUsage.current).toBe(3);
    });
});
