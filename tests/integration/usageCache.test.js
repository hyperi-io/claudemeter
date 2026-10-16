// The shared usage cache against real files in a tmp dir and a real local HTTP
// server: an entry belongs to one account and is never served to another.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');
const { cachedFetchUsage } = require('../../src/usageCache');

const MAX_AGE = 120000;
let tmpDir;
let cacheFile;
let server;
let baseUrl;
let requests;

// /usage/<label> answers a usage payload for that label, /rate-limited a 429.
function startServer() {
    return new Promise((resolve) => {
        server = http.createServer((req, res) => {
            requests.push(req.url);
            if (req.url === '/rate-limited') {
                res.statusCode = 429;
                res.end();
                return;
            }
            const label = decodeURIComponent(req.url.replace(/^\/usage\//, ''));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ usagePercent: 10, accountInfo: { name: label } }));
        });
        server.listen(0, '127.0.0.1', () => {
            baseUrl = `http://127.0.0.1:${server.address().port}`;
            resolve();
        });
    });
}

// A usage fetch over HTTP, failing on a non-2xx as the OAuth fetcher does.
const fetchFrom = (route) => async () => {
    const res = await fetch(`${baseUrl}${route}`);
    if (!res.ok) throw new Error(`API_ERROR_${res.status}`);
    return res.json();
};

beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-usage-cache-'));
    cacheFile = path.join(tmpDir, 'usage-cache.json');
    requests = [];
    await startServer();
});

afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('cachedFetchUsage - account keying', () => {
    it('serves a fresh entry to the same account without fetching', async () => {
        await cachedFetchUsage(fetchFrom('/usage/A'), MAX_AGE, { account: 'acct-a', cacheFile });
        const res = await cachedFetchUsage(fetchFrom('/usage/A2'), MAX_AGE, { account: 'acct-a', cacheFile });
        expect(requests).toEqual(['/usage/A']);
        expect(res.fromCache).toBe(true);
        expect(res.usageData.accountInfo.name).toBe('A');
    });

    it('refetches for a different account instead of serving the fresh entry', async () => {
        await cachedFetchUsage(fetchFrom('/usage/A'), MAX_AGE, { account: 'acct-a', cacheFile });
        const res = await cachedFetchUsage(fetchFrom('/usage/B'), MAX_AGE, { account: 'acct-b', cacheFile });
        expect(requests).toEqual(['/usage/A', '/usage/B']);
        expect(res.fromCache).toBe(false);
        expect(res.usageData.accountInfo.name).toBe('B');
    });

    it('does not fall back to another account\'s entry when the fetch fails', async () => {
        await cachedFetchUsage(fetchFrom('/usage/A'), MAX_AGE, { account: 'acct-a', cacheFile });
        await expect(cachedFetchUsage(fetchFrom('/rate-limited'), MAX_AGE, { account: 'acct-b', cacheFile }))
            .rejects.toThrow('API_ERROR_429');
        expect(requests).toEqual(['/usage/A', '/rate-limited']);
    });

    // Older resident versions write no account tag, and a window on this
    // version must still read their entry, fresh or as the 429 fallback.
    it('serves an untagged fresh entry without fetching', async () => {
        fs.writeFileSync(cacheFile, JSON.stringify({ usageData: { accountInfo: { name: 'old' } }, fetchedAt: Date.now() }));
        const res = await cachedFetchUsage(fetchFrom('/usage/A'), MAX_AGE, { account: 'acct-a', cacheFile });
        expect(requests).toEqual([]);
        expect(res.usageData.accountInfo.name).toBe('old');
    });

    it('falls back to an untagged stale entry when the fetch is rate limited', async () => {
        fs.writeFileSync(cacheFile, JSON.stringify({ usageData: { accountInfo: { name: 'old' } }, fetchedAt: Date.now() - MAX_AGE * 2 }));
        const res = await cachedFetchUsage(fetchFrom('/rate-limited'), MAX_AGE, { account: 'acct-a', cacheFile });
        expect(res.fromCache).toBe(true);
        expect(res.error.message).toBe('API_ERROR_429');
        expect(res.usageData.accountInfo.name).toBe('old');
    });

    it('records the account on the entry it writes', async () => {
        await cachedFetchUsage(fetchFrom('/usage/A'), MAX_AGE, { account: 'acct-a', cacheFile });
        expect(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).account).toBe('acct-a');
    });
});
