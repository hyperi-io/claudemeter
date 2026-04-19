// Project:   Claudemeter
// File:      rateLimitDetector.js
// Purpose:   Parse and classify Claude Code rate-limit events from the
//            session JSONL. Pure logic, no fs / no vscode — testable
//            against fixture data and synthetic entries.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Each rate-limit event in a Claude Code session JSONL has this shape:
//
//   {
//     "type": "assistant",
//     "isApiErrorMessage": true,
//     "error": "rate_limit",
//     "message": {
//       "model": "<synthetic>",
//       "content": [{"type": "text", "text": "..."}],
//       "usage": { ... all zeros ... }
//     },
//     "timestamp": "2026-04-16T05:31:31.427Z"
//   }
//
// Claude Code writes these client-side (not from an API 429). Five
// distinct text templates have been observed in real data; we keyword-
// match against the prefix and map to a category. An 'unknown' fallback
// catches templates we haven't catalogued (e.g. Team/Enterprise variants)
// so the badge still shows and a diagnostic is logged.

const TEMPLATES = Object.freeze([
    { prefix: "You've hit your limit",                     category: 'quota'            },
    { prefix: "You're out of extra usage",                 category: 'spending_cap'     },
    { prefix: 'API Error: Server is temporarily limiting', category: 'server_throttle'  },
    { prefix: 'API Error: Request rejected',               category: 'request_rejected' },
    { prefix: 'API Error: Rate limit reached',             category: 'generic'          },
]);

const CATEGORIES = Object.freeze([
    'quota', 'spending_cap', 'server_throttle',
    'request_rejected', 'generic', 'unknown',
]);

function extractText(entry) {
    const content = entry?.message?.content;
    if (!Array.isArray(content)) return '';
    for (const c of content) {
        if (c?.type === 'text' && typeof c.text === 'string') return c.text;
    }
    return '';
}

function isRateLimitEntry(entry) {
    return entry?.type === 'assistant'
        && entry?.isApiErrorMessage === true
        && entry?.error === 'rate_limit';
}

function isNormalAssistantMessage(entry) {
    return entry?.type === 'assistant'
        && !entry?.isApiErrorMessage
        && typeof entry?.message?.model === 'string'
        && entry.message.model !== '<synthetic>';
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function redactForDebug(text) {
    if (typeof text !== 'string') return '';
    const redacted = text.replace(UUID_RE, '<redacted>');
    return redacted.length > 140 ? redacted.slice(0, 137) + '...' : redacted;
}

const RESET_RE = /resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i;

function parseResetTime(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(RESET_RE);
    if (!m) return null;
    let hour = Number(m[1]);
    const minute = m[2] ? Number(m[2]) : 0;
    const ampm = m[3]?.toLowerCase();
    const tz = m[4] || null;
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute, tz };
}

function classify(entry, customTemplates = []) {
    if (!isRateLimitEntry(entry)) return null;
    const text = extractText(entry);
    const templates = [...customTemplates, ...TEMPLATES];

    for (const t of templates) {
        if (typeof t?.prefix === 'string'
            && text.startsWith(t.prefix)
            && CATEGORIES.includes(t.category)) {
            return {
                category: t.category,
                prefix: t.prefix,
                text,
                timestamp: entry.timestamp ? new Date(entry.timestamp) : null,
                resetTime: parseResetTime(text),
            };
        }
    }

    return {
        category: 'unknown',
        prefix: null,
        text,
        timestamp: entry.timestamp ? new Date(entry.timestamp) : null,
        resetTime: parseResetTime(text),
        unknownSample: redactForDebug(text),
    };
}

// Walk entries, partition into classified RL events and normal assistant
// messages. Active = latest RL within lookback AND no normal msg after it
// AND within safety timeout.
function scanTail(entries, now, config) {
    const lookbackMs = config?.lookbackMs ?? 300000;
    const safetyMs = config?.safetyTimeoutMs ?? 1800000;

    const base = {
        active: false, category: null,
        firstSeen: null, lastSeen: null,
        successAfter: null, text: null,
        resetTime: null, unknownSample: null,
    };

    if (!Array.isArray(entries) || entries.length === 0) return base;

    const rlEvents = [];
    let lastSuccess = null;

    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;

        const classified = classify(entry);
        if (classified) {
            rlEvents.push(classified);
            continue;
        }

        if (isNormalAssistantMessage(entry)) {
            const ts = entry.timestamp ? new Date(entry.timestamp) : null;
            if (ts && (!lastSuccess || ts > lastSuccess)) lastSuccess = ts;
        }
    }

    if (rlEvents.length === 0) return base;

    rlEvents.sort((a, b) => {
        const ta = a.timestamp?.getTime() ?? 0;
        const tb = b.timestamp?.getTime() ?? 0;
        return ta - tb;
    });

    const first = rlEvents[0];
    const last = rlEvents[rlEvents.length - 1];

    if (!last.timestamp) return base;

    const ageMs = now.getTime() - last.timestamp.getTime();
    if (ageMs > lookbackMs) return base;
    if (ageMs > safetyMs) return base;

    if (lastSuccess && lastSuccess > last.timestamp) {
        return { ...base, successAfter: lastSuccess };
    }

    return {
        active: true,
        category: last.category,
        firstSeen: first.timestamp,
        lastSeen: last.timestamp,
        successAfter: null,
        text: last.text,
        resetTime: last.resetTime,
        unknownSample: last.unknownSample ?? null,
    };
}

module.exports = {
    TEMPLATES,
    CATEGORIES,
    classify,
    scanTail,
    parseResetTime,
    redactForDebug,
};
