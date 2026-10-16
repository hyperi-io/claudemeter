// Project:   Claudemeter
// File:      sessionTracker.js
// Purpose:   Track token usage across Claude Code sessions (multi-instance safe)
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Multi-instance safety:
//
// Multiple VS Code windows each run their own claudemeter instance and all
// write to the same session-data.json. The original implementation cached
// loaded data in memory and did read-modify-write without merging, so
// whichever instance saved last would clobber the others' sessions. Torn
// writes (ENOSPC / crashes mid-write) could also leave an empty or partial
// JSON file.
//
// This module now:
//
//   1. Always re-reads the on-disk file inside update operations so the
//      in-memory cache is only a read-path optimisation, never a merge
//      source of truth.
//   2. Writes atomically: serialise to a temp file (same directory, unique
//      suffix), fsync, then rename() over the target. rename() is atomic
//      on POSIX and on Windows NTFS.
//   3. Merges the `sessions` list by sessionId so concurrent writers keep
//      each other's entries. The newest record per sessionId wins (by
//      tokenUsage.lastUpdate timestamp).
//   4. Re-derives `totals` from the merged list rather than trusting the
//      incoming value, which might have been computed against stale data.

const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { PATHS, getTokenLimit, sleep } = require('./utils');

const EMPTY_DATA = () => ({
    sessions: [],
    totals: {
        totalSessions: 0,
        totalTokensUsed: 0,
        lastSessionDate: null,
    },
});

// Exclusive advisory lock on `targetPath`: a sibling `.lock` file made with O_EXCL,
// atomic on POSIX and Windows. Guards read-modify-write across processes and promises,
// released via releaseFileLock(). Writes are rare, so the simple spin is fine.

// Longer than the longest legitimate hold: usageCache keeps the lock across a
// fetch of up to three 15 s request rounds.
const STALE_LOCK_MS = 90 * 1000;

async function readLockBody(lockPath) {
    try {
        return await fs.readFile(lockPath, 'utf8');
    } catch {
        return null;
    }
}

// Returns a handle for releaseFileLock, which only removes a lock this handle
// still owns.
async function acquireFileLock(targetPath, { timeoutMs = 5000, pollMs = 10 } = {}) {
    const lockPath = `${targetPath}.lock`;
    const deadline = Date.now() + timeoutMs;
    // The nonce lets a holder tell its own lock from a replacement.
    const payload = JSON.stringify({
        pid: process.pid,
        ts: Date.now(),
        nonce: crypto.randomBytes(8).toString('hex'),
    });

    // First attempt to ensure the parent dir exists.
    await fs.mkdir(path.dirname(lockPath), { recursive: true }).catch(() => {});

    for (;;) {
        try {
            const handle = await fs.open(lockPath, 'wx', 0o600);
            try {
                await handle.writeFile(payload, 'utf8');
            } finally {
                await handle.close();
            }
            return { path: lockPath, payload };
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;

            // An old lock is a crashed holder's, stolen only if its body is
            // unchanged just before the unlink, so a lock re-taken since survives.
            const seen = await readLockBody(lockPath);
            try {
                const stat = await fs.stat(lockPath);
                if (Date.now() - stat.mtimeMs > STALE_LOCK_MS
                    && seen !== null
                    && await readLockBody(lockPath) === seen) {
                    await fs.unlink(lockPath).catch(() => {});
                    continue;
                }
            } catch {
                // Lock disappeared between open() and stat() - retry.
                continue;
            }

            if (Date.now() >= deadline) {
                throw new Error(`Could not acquire lock for ${targetPath} within ${timeoutMs}ms`);
            }
            await sleep(pollMs);
        }
    }
}

async function releaseFileLock(lock) {
    if (!lock) return;
    try {
        if (await readLockBody(lock.path) !== lock.payload) return;
        await fs.unlink(lock.path);
    } catch {
        // Best-effort
    }
}

// Atomically write a JSON object to targetPath: write to a temp file
// alongside it, then rename(). rename() is atomic on POSIX and on Windows
// NTFS, so a reader will see either the old contents or the new contents,
// never a torn write.
async function atomicWriteJson(targetPath, obj) {
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath);
    // Unique temp name: pid + timestamp + random. Collision risk from two
    // instances with same pid (different machines sharing NFS) is handled
    // by the random suffix.
    // dir/base come from targetPath via path.dirname/path.basename which
    // canonicalise away any traversal components; the suffix is a
    // constant-shape random string. No user-controlled path segments.
    const suffix = `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    const tmpPath = path.join(dir, suffix); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const payload = JSON.stringify(obj, null, 2);
    let handle;
    try {
        handle = await fs.open(tmpPath, 'w', 0o600);
        await handle.writeFile(payload, 'utf8');
        // Flush to disk before rename so a crash between rename and fsync
        // cannot leave an empty target file.
        try {
            await handle.sync();
        } catch {
            // Some filesystems (tmpfs) don't support fsync - ignore.
        }
        await handle.close();
        handle = null;
        await fs.rename(tmpPath, targetPath);
    } catch (err) {
        if (handle) {
            try { await handle.close(); } catch { /* ignore */ }
        }
        // Best-effort cleanup of the temp file
        try { await fs.unlink(tmpPath); } catch { /* ignore */ }
        throw err;
    }
}

// Merge two data blobs by sessionId, keeping the newest record per
// session. The newest is determined by tokenUsage.lastUpdate; if either
// is missing, `incoming` wins (it's the most recent intent).
function mergeSessionData(existing, incoming) {
    const existingData = existing || EMPTY_DATA();
    const incomingData = incoming || EMPTY_DATA();

    const map = new Map();
    for (const s of existingData.sessions || []) {
        if (s && s.sessionId) map.set(s.sessionId, s);
    }
    for (const s of incomingData.sessions || []) {
        if (!s || !s.sessionId) continue;
        const prev = map.get(s.sessionId);
        if (!prev) {
            map.set(s.sessionId, s);
            continue;
        }
        const prevStamp = Date.parse(prev.tokenUsage?.lastUpdate || '') || 0;
        const currStamp = Date.parse(s.tokenUsage?.lastUpdate || '') || 0;
        // Tie-break on equal stamps: prefer the incoming record since the
        // caller just wrote it and has the freshest view of its own state.
        map.set(s.sessionId, currStamp >= prevStamp ? s : prev);
    }

    const merged = Array.from(map.values());
    // Sort chronologically by startTime so order matches user expectation
    // (oldest first, most recent last).
    merged.sort((a, b) => {
        const ta = Date.parse(a.startTime || '') || 0;
        const tb = Date.parse(b.startTime || '') || 0;
        return ta - tb;
    });

    const totalTokensUsed = merged.reduce(
        (sum, s) => sum + (s.tokenUsage?.current || 0),
        0
    );
    const lastSessionDate = merged.length > 0
        ? merged[merged.length - 1].startTime
        : null;

    return {
        sessions: merged,
        totals: {
            totalSessions: merged.length,
            totalTokensUsed,
            lastSessionDate,
        },
    };
}

// Session data stored in OS config dir for persistence across installs
class SessionTracker {
    constructor(sessionFilePath) {
        this.sessionFilePath = sessionFilePath || PATHS.SESSION_DATA_FILE;
        this.currentSession = null;
        this._cachedData = null;
        this._nextTokens = null;
        this._recording = null;
    }

    // Read fresh data from disk. `useCache` is a read-path optimisation
    // for callers that just want to display state without mutating it;
    // mutation paths should always pass useCache=false to avoid operating
    // on a stale snapshot.
    async loadData({ useCache = true } = {}) {
        if (useCache && this._cachedData) return this._cachedData;

        try {
            const content = await fs.readFile(this.sessionFilePath, 'utf8');
            const parsed = JSON.parse(content);
            this._cachedData = parsed;
            return parsed;
        } catch (error) {
            // Missing file or invalid JSON - return empty shape without
            // caching, so a later successful read can replace it.
            return EMPTY_DATA();
        }
    }

    // Merge `data` into whatever is currently on disk and atomically write
    // the result. This is safe for concurrent writers: we acquire a file
    // lock around the entire read-merge-write sequence, so two instances
    // cannot both read the same "existing" state and race each other's
    // merges. The lock is a sibling `.lock` file with O_EXCL semantics,
    // which is atomic on POSIX and Windows NTFS and therefore protects
    // against both same-process and cross-process concurrency.
    async saveData(data) {
        // acquireFileLock creates the directory.
        const lock = await acquireFileLock(this.sessionFilePath);
        try {
            let existing;
            try {
                existing = JSON.parse(await fs.readFile(this.sessionFilePath, 'utf8'));
            } catch {
                existing = EMPTY_DATA();
            }
            const merged = mergeSessionData(existing, data);

            await atomicWriteJson(this.sessionFilePath, merged);
            this._cachedData = merged;
            return merged;
        } finally {
            await releaseFileLock(lock);
        }
    }

    async startSession(description = 'Development session') {
        // Always re-read so the new session number reflects what's
        // actually on disk, not an instance-local cache.
        const data = await this.loadData({ useCache: false });

        const sessionNumber = String((data.sessions?.length || 0) + 1).padStart(3, '0');
        const date = new Date().toISOString().split('T')[0];

        const tokenLimit = getTokenLimit();
        // The random suffix keeps two windows that start at once from sharing
        // an id, since both read the same session count.
        const suffix = crypto.randomBytes(3).toString('hex');
        this.currentSession = {
            sessionId: `session-${date}-${sessionNumber}-${suffix}`,
            startTime: new Date().toISOString(),
            description: description,
            tokenUsage: {
                current: 0,
                limit: tokenLimit,
                remaining: tokenLimit,
                lastUpdate: new Date().toISOString()
            }
        };

        data.sessions = data.sessions || [];
        data.sessions.push(this.currentSession);

        await this.saveData(data);
        return this.currentSession;
    }

    // tokensUsed: current observed cache_read total
    // tokenLimit: resolved limit in tokens (falls back to getTokenLimit() if null)
    // resolvedMeta: optional {source, confidence} from contextWindowResolver,
    //               persisted alongside the limit so the tooltip can show
    //               where the value came from (e.g. 'rule:max-opus-4.6+',
    //               'inferred', 'standard').
    async updateTokens(tokensUsed, tokenLimit = null, resolvedMeta = null) {
        const limit = tokenLimit || getTokenLimit();
        // Each window writes only a session it started itself. The newest
        // on-disk session may belong to another window, which would then
        // overwrite this one's record and be overwritten in turn.
        if (!this.currentSession) {
            await this.startSession('Claude Code session (auto-created)');
        }
        const data = await this.loadData({ useCache: false });

        let session = data.sessions.find(s => s.sessionId === this.currentSession.sessionId) || null;
        if (!session) {
            // The merged on-disk view doesn't know about our session
            // yet - push the in-memory copy back in.
            session = this.currentSession;
            data.sessions.push(session);
        }

        session.tokenUsage = session.tokenUsage || {};
        session.tokenUsage.current = tokensUsed;
        session.tokenUsage.limit = limit;
        session.tokenUsage.remaining = limit - tokensUsed;
        session.tokenUsage.lastUpdate = new Date().toISOString();
        if (resolvedMeta && typeof resolvedMeta === 'object') {
            session.tokenUsage.limitSource = resolvedMeta.source || null;
            session.tokenUsage.limitConfidence = resolvedMeta.confidence || null;
        }

        await this.saveData(data);
    }

    // Coalesces calls so a stalled lock queues one write, not one per refresh:
    // a call made while a write is in flight is folded into the next write,
    // which carries only the newest value. Resolves when that write lands.
    recordTokens(tokensUsed, tokenLimit = null, resolvedMeta = null) {
        this._nextTokens = [tokensUsed, tokenLimit, resolvedMeta];
        if (!this._recording) {
            this._recording = this._drainTokens().finally(() => { this._recording = null; });
        }
        return this._recording;
    }

    async _drainTokens() {
        while (this._nextTokens) {
            const args = this._nextTokens;
            this._nextTokens = null;
            await this.updateTokens(...args);
        }
    }

    // This window's own session only, or null before its first update.
    async getCurrentSession() {
        return this.currentSession;
    }
}

module.exports = {
    SessionTracker,
    atomicWriteJson,
    mergeSessionData,
    acquireFileLock,
    releaseFileLock,
    STALE_LOCK_MS,
};
