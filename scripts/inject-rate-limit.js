#!/usr/bin/env node
// Project:   Claudemeter
// File:      scripts/inject-rate-limit.js
// Purpose:   Append a synthetic rate_limit event to the current
//            workspace's active Claude Code session JSONL so the
//            extension's file watcher picks it up and renders the
//            RL badge. Used for local testing of renderRateLimitPanel
//            without waiting for a real Claude throttle.
// Language:  Node.js (no deps)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Usage:
//   node scripts/inject-rate-limit.js [category]
//
// Categories (match src/rateLimitDetector.js TEMPLATES):
//   quota             — "You've hit your limit · resets 6pm (Australia/Sydney)"
//   spending_cap      — "You're out of extra usage · resets 9am (Australia/Sydney)"
//   server_throttle   — "API Error: Server is temporarily limiting requests"
//   request_rejected  — "API Error: Request rejected"
//   generic           — "API Error: Rate limit reached"
//   unknown           — synthetic text that won't match any template
//   clear             — append a normal assistant message to hide the badge
//
// Default category: quota

const fs = require('fs');
const path = require('path');
const os = require('os');

const TEMPLATES = {
    quota:            "You've hit your limit · resets 6pm (Australia/Sydney)",
    spending_cap:     "You're out of extra usage · resets 9am (Australia/Sydney)",
    server_throttle:  'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
    request_rejected: 'API Error: Request rejected (local-test-injection) · Rate limited',
    generic:          'API Error: Rate limit reached',
    unknown:          'Synthetic unknown-template rate-limit event (local test injection)',
};

const CATEGORIES = Object.keys(TEMPLATES).concat('clear');

function workspaceToClaudeDir(workspacePath) {
    return workspacePath
        .replace(/\\/g, '-')
        .replace(/\//g, '-')
        .replace(/:/g, '');
}

function findProjectJsonlDir() {
    const homeDir = os.homedir();
    const workspace = process.cwd();
    const dirName = workspaceToClaudeDir(workspace);

    const candidates = [
        process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', dirName) : null,
        path.join(homeDir, '.config', 'claude', 'projects', dirName),
        path.join(homeDir, '.claude', 'projects', dirName),
    ].filter(Boolean);

    for (const dir of candidates) {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            return dir;
        }
    }
    return null;
}

function latestJsonl(dir) {
    const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? path.join(dir, files[0].f) : null;
}

// Offset injected timestamps into the future so that if an active
// Claude Code session is writing normal assistant messages to the same
// JSONL concurrently, those real-time writes don't auto-clear the badge
// (the detector treats any normal assistant message timestamped after a
// rate-limit event as "all clear"). 5 minutes is well inside the
// lookback window (default 5 min) and gives plenty of visual test time.
function futureIso(minutes) {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function rateLimitEntry(text) {
    return {
        type: 'assistant',
        timestamp: futureIso(5),
        isApiErrorMessage: true,
        error: 'rate_limit',
        sessionId: 'LOCAL_TEST_INJECTION',
        message: {
            model: '<synthetic>',
            role: 'assistant',
            content: [{ type: 'text', text }],
            usage: {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
        },
    };
}

function clearEntry() {
    return {
        type: 'assistant',
        // Further future than rateLimitEntry so it reliably supersedes
        // any outstanding injected rate-limit event.
        timestamp: futureIso(10),
        sessionId: 'LOCAL_TEST_INJECTION',
        message: {
            model: 'claude-sonnet-4-6',
            role: 'assistant',
            content: [{ type: 'text', text: 'Local-test clear marker — normal assistant message.' }],
            usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
        },
    };
}

const category = (process.argv[2] || 'quota').toLowerCase();

if (!CATEGORIES.includes(category)) {
    console.error(`Unknown category: ${category}`);
    console.error(`Valid categories: ${CATEGORIES.join(', ')}`);
    process.exit(1);
}

const dir = findProjectJsonlDir();
if (!dir) {
    console.error('Could not locate project JSONL directory.');
    console.error(`Expected: ~/.claude/projects/${workspaceToClaudeDir(process.cwd())}/`);
    console.error('Start a Claude Code session in this workspace first, then retry.');
    process.exit(1);
}

const file = latestJsonl(dir);
if (!file) {
    console.error(`No .jsonl files found in ${dir}`);
    process.exit(1);
}

const entry = category === 'clear' ? clearEntry() : rateLimitEntry(TEMPLATES[category]);
fs.appendFileSync(file, JSON.stringify(entry) + '\n');

console.log(`Injected ${category} event into ${path.basename(file)}`);
if (category !== 'clear') {
    console.log('Run with "clear" to hide the badge:');
    console.log('  node scripts/inject-rate-limit.js clear');
}
