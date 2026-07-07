// Project:   Claudemeter
// File:      usageCache.js
// Purpose:   Shared account-global web-usage cache across VS Code windows.
// Language:  JavaScript (CommonJS)
//
// Web usage (session / weekly / opus / sonnet / credits) is identical for every
// VS Code window on the same account. Without coordination, N windows each fetch
// api.anthropic.com/api/oauth/usage on startup + every refresh, which wastes
// requests and trips Anthropic's rate limit (HTTP 429) - the fetch then throws
// and the gauges blank.
//
// This coordinates them through a small on-disk cache in the config dir:
//   - a window uses the cache if it's younger than maxAge (no network call),
//   - otherwise it fetches, but under a file lock so concurrent windows
//     serialise instead of bursting the endpoint (the classic thundering herd),
//   - on a fetch error (429 / timeout) it serves the last-known cached value so
//     the gauges keep showing rather than vanishing.
//
// The token itself is fine - this is purely about request volume, not access.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const fs = require('fs').promises;
const path = require('path');
const { PATHS } = require('./utils');
const { acquireFileLock, releaseFileLock, atomicWriteJson } = require('./sessionTracker');

const CACHE_FILE = path.join(PATHS.CONFIG_DIR, 'usage-cache.json');

async function readCache() {
    try {
        return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
    } catch {
        return null; // missing / unreadable / malformed
    }
}

function isFresh(cache, maxAgeMs) {
    return !!cache
        && typeof cache.fetchedAt === 'number'
        && cache.usageData
        && (Date.now() - cache.fetchedAt) < maxAgeMs;
}

// Return the freshest available usage: the cache if it's younger than maxAgeMs,
// otherwise a fresh fetch (written back to the cache). Serialised via a lock so
// concurrent windows make at most one network call per maxAgeMs. Throws only
// when there is no data at all (fetch failed AND no cache to fall back on).
async function cachedFetchUsage(fetchFn, maxAgeMs) {
    const cached = await readCache();
    if (isFresh(cached, maxAgeMs)) {
        return { usageData: cached.usageData, fromCache: true };
    }

    let lock;
    try {
        lock = await acquireFileLock(CACHE_FILE, { timeoutMs: 20000 });
    } catch (lockErr) {
        // Another window is holding the lock (slow fetch). Serve stale rather
        // than block or blank; the holder will refresh the cache shortly.
        if (cached && cached.usageData) {
            return { usageData: cached.usageData, fromCache: true, error: lockErr };
        }
        throw lockErr;
    }
    try {
        // Another window may have refreshed the cache while we waited on the lock.
        const again = await readCache();
        if (isFresh(again, maxAgeMs)) {
            return { usageData: again.usageData, fromCache: true };
        }

        try {
            const usageData = await fetchFn();
            await atomicWriteJson(CACHE_FILE, { usageData, fetchedAt: Date.now() });
            return { usageData, fromCache: false };
        } catch (err) {
            // 429 / timeout / network: serve the last-known value if we have one
            // so the gauges don't blank. Only surface the error when there's
            // nothing cached at all.
            const stale = again || cached;
            if (stale && stale.usageData) {
                return { usageData: stale.usageData, fromCache: true, error: err };
            }
            throw err;
        }
    } finally {
        await releaseFileLock(lock);
    }
}

module.exports = { cachedFetchUsage, CACHE_FILE };
