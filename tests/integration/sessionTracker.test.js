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

        // Fresh tracker instance — should read what A wrote
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
