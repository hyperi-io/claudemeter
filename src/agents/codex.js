// Project:   Claudemeter
// File:      agents/codex.js
// Purpose:   Codex usage limits for the supplementary agent gauges, read from the Codex app-server.
// Language:  JavaScript (CommonJS)
//
// Spawns `codex app-server` and asks `account/rateLimits/read` over stdio JSON-RPC, the same
// call Codex's own editor extension makes. The child is killed as soon as it answers or times out.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const { spawn } = require('child_process');
const { windowLabel } = require('./limits');

const READ_TIMEOUT_MS = 15000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// One limit window from a Codex RateLimitWindow, or null when it carries no usage.
function limitOf(window, name) {
    if (!window) return null;
    const percent = num(window.usedPercent);
    if (percent === null) return null;
    const minutes = num(window.windowDurationMins);
    const span = minutes === null ? null : windowLabel(minutes);
    const resetsAt = num(window.resetsAt);
    return {
        label: [name, span].filter(Boolean).join(' ') || 'Limit',
        percent,
        windowMinutes: minutes,
        resetsAt: resetsAt === null ? null : resetsAt * 1000,
    };
}

/**
 * The provider-neutral usage for one `account/rateLimits/read` result.
 *
 * @returns {{plan: string|null, limits: object[], notes: string[]}|null} null when no limit has usage
 */
function parseRateLimits(result) {
    if (!result || typeof result !== 'object') return null;
    const snapshots = result.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object'
        ? Object.values(result.rateLimitsByLimitId)
        : [result.rateLimits];
    const limits = [];
    let plan = null;
    let credits = null;
    for (const snap of snapshots) {
        if (!snap || typeof snap !== 'object') continue;
        // The account-wide limit is unnamed. A model-scoped one carries its own name.
        const name = typeof snap.limitName === 'string' && snap.limitName ? snap.limitName : null;
        for (const limit of [limitOf(snap.primary, name), limitOf(snap.secondary, name)]) {
            if (limit) limits.push(limit);
        }
        plan = plan ?? (typeof snap.planType === 'string' ? snap.planType : null);
        credits = credits ?? snap.credits ?? null;
    }
    if (limits.length === 0) return null;

    const notes = [];
    if (credits?.unlimited) notes.push('Unlimited credits');
    else if (credits?.hasCredits && credits.balance) notes.push(`Credit balance ${credits.balance}`);
    const resets = num(result.rateLimitResetCredits?.availableCount);
    if (resets > 0) notes.push(`${resets} free limit ${resets === 1 ? 'reset' : 'resets'} available`);
    return { plan, limits, notes };
}

/**
 * Ask a Codex app-server for the account's limits.
 *
 * @param {{command?: string, timeoutMs?: number}} options - command is the Codex CLI to run
 * @returns {Promise<object|null>} parseRateLimits output, or null when Codex is not installed or not signed in
 */
function readCodexUsage({ command = 'codex', timeoutMs = READ_TIMEOUT_MS } = {}) {
    return new Promise((resolve) => {
        let settled = false;
        let child;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (child && child.exitCode === null) child.kill();
            resolve(value);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        try {
            // Windows installs the CLI as codex.cmd, which only a shell can run.
            child = spawn(command, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: process.platform === 'win32' });
        } catch {
            finish(null);
            return;
        }
        child.on('error', () => finish(null));
        child.on('exit', () => finish(null));
        child.stdin.on('error', () => finish(null));
        const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);

        let buffer = '';
        let initialised = false;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            buffer += chunk;
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end);
                buffer = buffer.slice(end + 1);
                let msg;
                try {
                    msg = JSON.parse(line);
                } catch {
                    continue;
                }
                if (msg.id === 1 && !initialised) {
                    if (msg.error) return finish(null);
                    initialised = true;
                    send({ method: 'initialized' });
                    send({ id: 2, method: 'account/rateLimits/read', params: null });
                } else if (msg.id === 2) {
                    finish(msg.error ? null : parseRateLimits(msg.result));
                }
            }
        });
        send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'claudemeter', version: '1' } } });
    });
}

module.exports = {
    id: 'codex',
    name: 'Codex',
    shortLabel: 'Cx',
    read: ({ command, timeoutMs } = {}) => readCodexUsage({ command, timeoutMs }),
    parseRateLimits,
    readCodexUsage,
};
