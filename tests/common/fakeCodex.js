#!/usr/bin/env node
// A stand-in `codex app-server` for the agent tests: JSON-RPC over stdio, behaviour picked by
// FAKE_CODEX_MODE (ok, error, hang, garbage, exit).

const MODE = process.env.FAKE_CODEX_MODE || 'ok';

const RATE_LIMITS = {
    rateLimits: null,
    rateLimitsByLimitId: {
        codex: {
            limitId: 'codex',
            limitName: null,
            primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1793110000 },
            secondary: { usedPercent: 12.5, windowDurationMins: 10080, resetsAt: 1793700000 },
            credits: { hasCredits: false, unlimited: false, balance: '0' },
            planType: 'pro',
        },
    },
    rateLimitResetCredits: { availableCount: 1, credits: null },
};

if (MODE === 'exit') process.exit(1);

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (MODE === 'hang') continue;
        if (MODE === 'garbage') {
            process.stdout.write('not json\n{"id": 1, "result": {}}\n');
            continue;
        }
        if (msg.id === 1) process.stdout.write(`${JSON.stringify({ id: 1, result: { userAgent: 'fake' } })}\n`);
        if (msg.id === 2) {
            const reply = MODE === 'error'
                ? { id: 2, error: { code: -32000, message: 'not signed in' } }
                : { id: 2, result: RATE_LIMITS };
            process.stdout.write(`${JSON.stringify(reply)}\n`);
        }
    }
});
