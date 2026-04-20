// Project:   Claudemeter
// File:      happyHour.js
// Purpose:   Determine whether we are currently outside Anthropic's
//            peak-throttling window. "Happy hour" = off-peak.
//            Pure logic — no vscode / no I/O. Fully testable with
//            frozen clocks.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Anthropic's peak window was announced 2026-03-26: Monday-Friday
// 05:00-11:00 America/Los_Angeles. During peak hours, Claude Code
// session limits deplete faster than the 5-hour window suggests.
// See GH issues #41788, #41930.
//
// Users can override the window via claudemeter.happyHour.peakWindow
// if Anthropic changes the policy before we ship an update.

const DEFAULT_PEAK_WINDOW = Object.freeze({
    days: [1, 2, 3, 4, 5],
    start: '05:00',
    end: '11:00',
    tz: 'America/Los_Angeles',
});

// Codicon entries use $(name) syntax — they render monochrome and
// inherit the status-bar text colour, so they stay unobtrusive.
// Emoji entries render in full colour (intentional, for users who
// want a splash). The monochrome 'sparkle' is the default.
const HAPPY_HOUR_ICONS = Object.freeze({
    sparkle:   '$(sparkle)',
    watch:     '$(watch)',
    zap:       '$(zap)',
    star:      '$(star-full)',
    beer:      '🍺',
    cocktail:  '🍹',
    wine:      '🍷',
    champagne: '🥂',
    martini:   '🍸',
    coffee:    '☕',
    moon:      '🌙',
    sparkles:  '✨',
    palm:      '🌴',
    party:     '🎉',
});

const TIME_RE = /^(\d{2}):(\d{2})$/;

function isValidTz(tz) {
    if (typeof tz !== 'string' || tz.length === 0) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

function isValidTime(s) {
    if (typeof s !== 'string') return false;
    const m = s.match(TIME_RE);
    if (!m) return false;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h >= 0 && h < 24 && min >= 0 && min < 60;
}

function validatePeakWindow(raw) {
    const base = { ...DEFAULT_PEAK_WINDOW };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    const out = { ...base };

    if (isValidTz(raw.tz)) out.tz = raw.tz;
    if (isValidTime(raw.start)) out.start = raw.start;
    if (isValidTime(raw.end)) out.end = raw.end;

    if (Array.isArray(raw.days)) {
        const filtered = raw.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
        out.days = filtered.length > 0 ? filtered : base.days;
    }

    return out;
}

// Convert a Date to { dayOfWeek (0-6), hour, minute } in the given tz.
function partsInTz(date, tz) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
    });
    const parts = Object.fromEntries(
        fmt.formatToParts(date).map(p => [p.type, p.value])
    );
    const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dayOfWeek = wdMap[parts.weekday];
    let hour = Number(parts.hour);
    if (hour === 24) hour = 0; // midnight edge case in some locales
    return { dayOfWeek, hour, minute: Number(parts.minute) };
}

function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function isHappyHour(now, peakWindow) {
    const window = validatePeakWindow(peakWindow);
    const { dayOfWeek, hour, minute } = partsInTz(now, window.tz);

    if (!window.days.includes(dayOfWeek)) return true;

    const nowMin = hour * 60 + minute;
    const startMin = toMinutes(window.start);
    const endMin = toMinutes(window.end);

    return nowMin < startMin || nowMin >= endMin;
}

// Find the next UTC instant at which isHappyHour flips. Iterates
// minute-by-minute up to 8 days out. Bounded and simple — avoids
// fiddly DST arithmetic by just asking the question repeatedly.
function nextTransition(now, peakWindow) {
    const window = validatePeakWindow(peakWindow);
    const current = isHappyHour(now, window);

    const MAX_MS = 8 * 24 * 60 * 60 * 1000;
    const STEP_MS = 60 * 1000;

    for (let delta = STEP_MS; delta <= MAX_MS; delta += STEP_MS) {
        const probe = new Date(now.getTime() + delta);
        if (isHappyHour(probe, window) !== current) return probe;
    }

    return new Date(now.getTime() + MAX_MS);
}

module.exports = {
    DEFAULT_PEAK_WINDOW,
    HAPPY_HOUR_ICONS,
    isHappyHour,
    nextTransition,
    validatePeakWindow,
};
