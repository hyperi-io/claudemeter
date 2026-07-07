#!/usr/bin/env node
/**
 * dev-token.js - test helper for claudemeter's not-logged-in flow.
 *
 * Claudemeter reads the Claude Code OAuth token from the shared store (macOS
 * Keychain "Claude Code-credentials", else $CLAUDE_CONFIG_DIR/.credentials.json).
 * To test claudemeter from a "not logged in yet" position you need that token
 * temporarily gone. This stashes it aside (reversibly) so claudemeter shows the
 * not-logged-in state, you exercise the login flow, then you restore it.
 *
 *   node scripts/dev-token.js status    # is a token present? is one stashed?
 *   node scripts/dev-token.js stash     # back up + remove -> not-logged-in
 *   node scripts/dev-token.js restore    # put the stashed token back
 *
 * npm run token:status | token:stash | token:restore
 *
 * WARNING: `stash` also logs Claude Code (CLI + extension) out, since they share
 * the same store. Run it when you're NOT mid Claude Code work. To get back in you
 * can either `restore`, or just `claude auth login` (which is the flow you're
 * testing anyway - claudemeter should pick the new token up automatically).
 *
 * The Keychain copy stays inside the Keychain (a parallel stash service), so the
 * token is never written to a plaintext file. File-store setups move the file to
 * a sibling `.claudemeter-stash` with its permissions preserved.
 *
 * Both `stash` and `restore` also clear claudemeter's own usage cache. That
 * cache serves the last-known web usage on a fetch failure (anti-429
 * resilience), so without clearing it the gauges keep showing the old numbers
 * after a stash and the not-logged-in state never appears. Clearing it makes
 * the state flip on the next refresh instead of needing a window reload.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVICE = 'Claude Code-credentials';
const STASH_SERVICE = 'Claude Code-credentials-claudemeter-stash';
const isMac = process.platform === 'darwin';

function configDir() {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
function credFile() {
    return path.join(configDir(), '.credentials.json');
}
function stashFile() {
    return credFile() + '.claudemeter-stash';
}

// Claudemeter's own config dir (distinct from Claude's ~/.claude). Mirrors
// getConfigDir() in src/utils.js - can't import it here because src/utils.js
// requires 'vscode', absent in a plain node script. Keep in sync if that moves.
function claudemeterConfigDir() {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'claudemeter');
    }
    if (isMac) {
        return path.join(os.homedir(), 'Library', 'Application Support', 'claudemeter');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claudemeter');
}
function usageCacheFile() {
    return path.join(claudemeterConfigDir(), 'usage-cache.json');
}

// Drop the shared usage cache so the next fetch is forced live instead of
// serving the pre-stash numbers. Returns true if a cache was actually removed.
function clearUsageCache() {
    const f = usageCacheFile();
    if (fs.existsSync(f)) {
        fs.rmSync(f);
        return true;
    }
    return false;
}

// --- Keychain helpers (macOS) ------------------------------------------------
function kcRead(service) {
    try {
        return execFileSync('security', ['find-generic-password', '-s', service, '-w'],
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
        return null; // not present
    }
}
function kcAccount(service) {
    try {
        const out = execFileSync('security', ['find-generic-password', '-s', service],
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        const m = out.match(/"acct"<blob>="([^"]*)"/);
        return m ? m[1] : os.userInfo().username;
    } catch {
        return os.userInfo().username;
    }
}
function kcWrite(service, account, secret) {
    // -U updates if it already exists. -w reads the secret from a positional arg;
    // pass it as an arg (local machine, dev tool) rather than echoing to a shell.
    execFileSync('security',
        ['add-generic-password', '-s', service, '-a', account, '-w', secret, '-U'],
        { stdio: 'ignore' });
}
function kcDelete(service) {
    try {
        execFileSync('security', ['delete-generic-password', '-s', service], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// --- state -------------------------------------------------------------------
function state() {
    return {
        file: fs.existsSync(credFile()),
        fileStash: fs.existsSync(stashFile()),
        keychain: isMac ? kcRead(SERVICE) !== null : false,
        keychainStash: isMac ? kcRead(STASH_SERVICE) !== null : false,
    };
}

function cmdStatus() {
    const s = state();
    console.log(`config dir     : ${configDir()}`);
    console.log(`token (file)   : ${s.file ? 'present' : '-'}   ${credFile()}`);
    if (isMac) console.log(`token (keychain): ${s.keychain ? 'present' : '-'}   service "${SERVICE}"`);
    console.log(`stashed (file) : ${s.fileStash ? 'yes' : '-'}`);
    if (isMac) console.log(`stashed (keychn): ${s.keychainStash ? 'yes' : '-'}`);
    console.log(`usage cache    : ${fs.existsSync(usageCacheFile()) ? 'present' : '-'}   ${usageCacheFile()}`);
    const loggedIn = s.file || s.keychain;
    console.log(`\nclaudemeter sees: ${loggedIn ? 'LOGGED IN' : 'NOT logged in'}`);
}

function cmdStash() {
    const s = state();
    if (s.fileStash || s.keychainStash) {
        console.error('A stash already exists. `restore` it first (or it will be overwritten).');
        process.exit(1);
    }
    if (!s.file && !s.keychain) {
        console.log('No token present - already in the not-logged-in state. Nothing to stash.');
        return;
    }
    if (s.file) {
        fs.renameSync(credFile(), stashFile());
        console.log(`Stashed file token -> ${stashFile()}`);
    }
    if (s.keychain) {
        const secret = kcRead(SERVICE);
        kcWrite(STASH_SERVICE, kcAccount(SERVICE), secret);
        kcDelete(SERVICE);
        console.log(`Stashed Keychain token -> service "${STASH_SERVICE}"`);
    }
    if (clearUsageCache()) {
        console.log('Cleared claudemeter usage cache (gauges drop to not-logged-in on next refresh).');
    }
    console.log('\nClaude Code + claudemeter are now logged out.');
    console.log('Test claudemeter, then `npm run token:restore` (or `claude auth login`).');
}

function cmdRestore() {
    const s = state();
    if (!s.fileStash && !s.keychainStash) {
        console.log('Nothing stashed. (If you ran `claude auth login`, you are already logged in.)');
        return;
    }
    if (s.fileStash) {
        if (fs.existsSync(credFile())) fs.rmSync(credFile());
        fs.renameSync(stashFile(), credFile());
        console.log(`Restored file token <- ${path.basename(stashFile())}`);
    }
    if (s.keychainStash) {
        const secret = kcRead(STASH_SERVICE);
        kcWrite(SERVICE, kcAccount(STASH_SERVICE), secret);
        kcDelete(STASH_SERVICE);
        console.log(`Restored Keychain token <- service "${STASH_SERVICE}"`);
    }
    if (clearUsageCache()) {
        console.log('Cleared claudemeter usage cache (fresh fetch on next refresh).');
    }
    console.log('\nToken restored. Claude Code + claudemeter are logged in again.');
}

const cmd = process.argv[2] || 'status';
({ status: cmdStatus, stash: cmdStash, restore: cmdRestore }[cmd] || (() => {
    console.error(`Unknown command "${cmd}". Use: status | stash | restore`);
    process.exit(1);
}))();
