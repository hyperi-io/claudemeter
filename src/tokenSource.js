// Project:   Claudemeter
// File:      tokenSource.js
// Purpose:   Track the Claude Code OAuth token -- never own it.
// Language:  JavaScript (CommonJS)
//
// claudemeter reads the SAME OAuth credential store Claude Code writes
// (CLI and the VS Code extension share one store per config dir). Claude
// Code owns the token lifecycle: it refreshes on its own use and, because
// Anthropic rotates refresh tokens, the stored access+refresh pair changes
// underneath us. Our job is to stay in sync, NOT to refresh:
//
//   - read effectively FRESH every fetch so we always use whatever Claude
//     Code has right now. The file read is cheap and uncached; the macOS
//     Keychain read spawns `security` (blocking) so it carries a tiny 2s
//     TTL to avoid a subprocess storm when readToken() is called several
//     times per cycle (fetch, watcher, tier-seed, poll). 2s is far below
//     any human-perceptible rotation lag, and readToken({ fresh: true })
//     bypasses it -- the 401 re-read after a rotation uses that,
//   - optionally fs.watch the file so a rotation is picked up instantly
//     (Linux/Windows; the macOS Keychain can't be watched, the per-fetch
//     re-read covers it),
//   - NEVER write back. We never call the refresh endpoint. That avoids
//     invalidating Claude Code's rotating refresh token (which would log
//     the user out) and keeps Claude Code the single source of truth.
//
// When the token is genuinely stale (user hasn't run Claude Code for the
// token's lifetime) the caller falls back to prompting `claude auth login`.
//
// vscode-free by design. Smoke test (redact before sharing -- the object
// carries the live access token):
//   node -e "const {ok,source,expired}=require('./src/tokenSource').readToken(); console.log({ok,source,expired})"
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Env vars that make Claude Code bypass the stored OAuth token. If any is
// set the shared store is NOT the source of truth, so we must not claim
// subscription usage from it (docs: authentication precedence).
const AUTH_OVERRIDE_ENV = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN', // an oauth token, but lives in env not the store
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
];

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// CLAUDE_CONFIG_DIR wins so we track whichever account THIS environment's
// Claude Code is on (the split-config power-user case); else ~/.claude.
function getConfigDir() {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function credentialsFilePath() {
    return path.join(getConfigDir(), '.credentials.json');
}

// The active auth-override env var name, or null. Used to explain the
// no-token state ("you're on an API key, not subscription OAuth").
function detectAuthOverride() {
    return AUTH_OVERRIDE_ENV.find((k) => process.env[k]) || null;
}

// Read + parse the oauth blob from the on-disk file. Linux/Windows always
// use the file; macOS only has it if the user opted out of Keychain.
function readFromFile() {
    const file = credentialsFilePath();
    if (!fs.existsSync(file)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return raw.claudeAiOauth || raw;
    } catch {
        return null;
    }
}

// Tiny TTL cache for the Keychain read only (the file read is cheap). Keeps
// repeated readToken() calls in one cycle from each spawning `security`.
const KEYCHAIN_TTL_MS = 2000;
let keychainCache = null; // { blob, at }

// macOS stores the blob in the login Keychain. Single execFile, no shell.
// forceFresh skips the TTL cache (used by the post-rotation 401 re-read).
function readFromKeychain(forceFresh = false) {
    if (process.platform !== 'darwin') return null;
    if (!forceFresh && keychainCache && (Date.now() - keychainCache.at) < KEYCHAIN_TTL_MS) {
        return keychainCache.blob;
    }
    let blob = null;
    try {
        const out = execFileSync(
            'security',
            ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
            { encoding: 'utf-8', timeout: 5000 },
        );
        const raw = JSON.parse(out);
        blob = raw.claudeAiOauth || raw;
    } catch {
        // absent/locked Keychain or malformed entry -> no token (blob stays null)
    }
    keychainCache = { blob, at: Date.now() };
    return blob;
}

// Build the token result from a raw oauth blob, or null when it carries no
// usable access token.
function buildToken(blob, source) {
    if (!blob || !blob.accessToken) return null;
    const expiresAt = typeof blob.expiresAt === 'number' ? blob.expiresAt : null;
    return {
        ok: true,
        token: blob.accessToken,
        expiresAt,
        scopes: Array.isArray(blob.scopes) ? blob.scopes : [],
        subscriptionType: blob.subscriptionType || null,
        rateLimitTier: blob.rateLimitTier || null,
        source,
        // Advisory only -- the server is the authority on validity. A false
        // here doesn't guarantee the token works (Claude Code may have
        // rotated), and expired:true is why we fall through / re-read on 401.
        expired: expiresAt != null ? expiresAt <= Date.now() : false,
    };
}

// Choose between the file token and the Keychain token. macOS can carry TWO
// stores that disagree: the NATIVE Claude Code install keeps the live token in
// the Keychain, while the old NPM CLI wrote ~/.claude/.credentials.json. After
// the npm->native migration the file is frozen and goes stale, so it must NOT
// shadow a valid Keychain token (issue #50). Precedence:
//   1. a non-expired Keychain token wins (the native install's live store);
//   2. else a non-expired file token (Linux/Windows, or macOS opted out of the
//      Keychain, where there is no Keychain token at all);
//   3. else whichever token exists - Keychain first - so the caller can still
//      try it, 401, and prompt re-login.
function chooseToken(fileTok, kcTok) {
    if (kcTok && !kcTok.expired) return kcTok;
    if (fileTok && !fileTok.expired) return fileTok;
    return kcTok || fileTok || null;
}

// Token read. Reads BOTH stores and picks the live/valid one (see chooseToken).
// The file read is cheap and uncached; the Keychain read is null off macOS and
// 2s-TTL-cached on macOS (pass { fresh: true } to bypass the TTL -- the 401
// re-read does). Returns:
//   { ok: true, token, expiresAt, scopes, subscriptionType, rateLimitTier,
//     source: 'file'|'keychain', expired: bool }
//   { ok: false, reason: 'ENV_OVERRIDE'|'NO_TOKEN', detail }
function readToken(opts = {}) {
    const override = detectAuthOverride();
    if (override) {
        return { ok: false, reason: 'ENV_OVERRIDE', detail: override };
    }

    const fileTok = buildToken(readFromFile(), 'file');
    const kcTok = buildToken(readFromKeychain(opts.fresh === true), 'keychain');
    return chooseToken(fileTok, kcTok)
        || { ok: false, reason: 'NO_TOKEN', detail: getConfigDir() };
}

// Watch the credential FILE for changes and invoke onChange (debounced).
// Instant rotation pickup on Linux/Windows and macOS-file setups. The
// macOS Keychain can't be watched -- callers rely on the per-fetch
// re-read there. Returns a dispose function; safe to call when the file
// doesn't exist yet (watches the dir for its creation).
function watchToken(onChange) {
    const file = credentialsFilePath();
    const dir = getConfigDir();
    let timer = null;
    const fire = () => {
        if (timer) return; // debounce a burst of write events into one
        timer = setTimeout(() => {
            timer = null;
            try { onChange(); } catch { /* caller's problem, don't crash the watcher */ }
        }, 250);
    };

    const watchers = [];
    try {
        if (fs.existsSync(file)) {
            watchers.push(fs.watch(file, { persistent: false }, fire));
        }
        // Also watch the dir so we catch atomic-rename writes (the common
        // safe-write pattern replaces the inode, which a file watch misses)
        // and first-time creation.
        if (fs.existsSync(dir)) {
            watchers.push(fs.watch(dir, { persistent: false }, (_evt, name) => {
                if (!name || name === '.credentials.json') fire();
            }));
        }
    } catch {
        // fs.watch is best-effort (unsupported FS, permissions). The
        // per-fetch re-read still delivers the swap, just not instantly.
    }

    return () => {
        if (timer) clearTimeout(timer);
        for (const w of watchers) {
            try { w.close(); } catch { /* already gone */ }
        }
    };
}

module.exports = {
    readToken,
    chooseToken,
    watchToken,
    detectAuthOverride,
    getConfigDir,
    credentialsFilePath,
    AUTH_OVERRIDE_ENV,
    KEYCHAIN_SERVICE,
};
