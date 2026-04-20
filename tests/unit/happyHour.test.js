// Tests for happyHour.js — pure peak-window detection.
// All tests use frozen UTC instants to avoid DST flake when asserting
// against America/Los_Angeles. LA is UTC-7 in PDT (Mar-Nov) and
// UTC-8 in PST; 2026-04-15 is Wed PDT, 2026-01-15 is Thu PST.

import { describe, it, expect } from 'vitest';
const {
    DEFAULT_PEAK_WINDOW,
    HAPPY_HOUR_ICONS,
    isHappyHour,
    nextTransition,
    validatePeakWindow,
} = require('../../src/happyHour');

const utc = (iso) => new Date(iso);

describe('DEFAULT_PEAK_WINDOW', () => {
    it('is Mon-Fri 05:00-11:00 America/Los_Angeles', () => {
        expect(DEFAULT_PEAK_WINDOW).toEqual({
            days: [1, 2, 3, 4, 5],
            start: '05:00',
            end: '11:00',
            tz: 'America/Los_Angeles',
        });
    });

    it('is frozen (immutable)', () => {
        expect(Object.isFrozen(DEFAULT_PEAK_WINDOW)).toBe(true);
    });
});

describe('isHappyHour — default window, PDT', () => {
    // 2026-04-15 Wed PDT; LA is UTC-7
    it('returns false during peak (Wed 08:00 LA = 15:00 UTC)', () => {
        expect(isHappyHour(utc('2026-04-15T15:00:00Z'), DEFAULT_PEAK_WINDOW)).toBe(false);
    });

    it('returns true just before peak start (Wed 04:59 LA = 11:59 UTC)', () => {
        expect(isHappyHour(utc('2026-04-15T11:59:00Z'), DEFAULT_PEAK_WINDOW)).toBe(true);
    });

    it('returns false at exact peak start (Wed 05:00 LA = 12:00 UTC)', () => {
        expect(isHappyHour(utc('2026-04-15T12:00:00Z'), DEFAULT_PEAK_WINDOW)).toBe(false);
    });

    it('returns true at exact peak end (Wed 11:00 LA = 18:00 UTC)', () => {
        expect(isHappyHour(utc('2026-04-15T18:00:00Z'), DEFAULT_PEAK_WINDOW)).toBe(true);
    });

    it('returns true evening (Wed 20:00 LA = 03:00 UTC next day)', () => {
        expect(isHappyHour(utc('2026-04-16T03:00:00Z'), DEFAULT_PEAK_WINDOW)).toBe(true);
    });
});

describe('isHappyHour — default window, PST (winter)', () => {
    // 2026-01-15 Thu PST; LA is UTC-8
    it('returns false during peak (Thu 08:00 LA = 16:00 UTC)', () => {
        expect(isHappyHour(utc('2026-01-15T16:00:00Z'), DEFAULT_PEAK_WINDOW)).toBe(false);
    });

    it('returns true before peak (Thu 04:00 LA = 12:00 UTC)', () => {
        expect(isHappyHour(utc('2026-01-15T12:00:00Z'), DEFAULT_PEAK_WINDOW)).toBe(true);
    });
});

describe('isHappyHour — weekends always happy hour', () => {
    it('Saturday in the middle of what would be peak', () => {
        // 2026-04-18 is Saturday. 08:00 LA PDT = 15:00 UTC
        expect(isHappyHour(utc('2026-04-18T15:00:00Z'), DEFAULT_PEAK_WINDOW)).toBe(true);
    });
    it('Sunday morning', () => {
        // 2026-04-19 Sun 08:00 LA = 15:00 UTC
        expect(isHappyHour(utc('2026-04-19T15:00:00Z'), DEFAULT_PEAK_WINDOW)).toBe(true);
    });
});

describe('isHappyHour — inverted custom window', () => {
    const inverted = { days: [0, 6], start: '09:00', end: '17:00', tz: 'America/Los_Angeles' };

    it('weekend peak: Sat 12:00 LA off-peak? no, it is peak', () => {
        // Sat 12:00 LA PDT = 19:00 UTC
        expect(isHappyHour(utc('2026-04-18T19:00:00Z'), inverted)).toBe(false);
    });

    it('inverted: weekday in day is now happy hour', () => {
        // Wed 12:00 LA PDT = 19:00 UTC, weekday not in [0,6] → happy hour
        expect(isHappyHour(utc('2026-04-15T19:00:00Z'), inverted)).toBe(true);
    });
});

describe('isHappyHour — non-LA tz (Sydney)', () => {
    const sydney = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', tz: 'Australia/Sydney' };

    it('Sydney Wed 12:00 AEST (UTC+10) = 02:00 UTC → peak', () => {
        expect(isHappyHour(utc('2026-04-15T02:00:00Z'), sydney)).toBe(false);
    });

    it('Sydney Wed 20:00 AEST = 10:00 UTC → happy hour', () => {
        expect(isHappyHour(utc('2026-04-15T10:00:00Z'), sydney)).toBe(true);
    });
});

describe('nextTransition', () => {
    it('during peak: returns the upcoming peak-end time', () => {
        // Wed 08:00 LA PDT = 15:00 UTC, peak ends Wed 11:00 LA = 18:00 UTC
        const now = utc('2026-04-15T15:00:00Z');
        const next = nextTransition(now, DEFAULT_PEAK_WINDOW);
        expect(next.toISOString()).toBe('2026-04-15T18:00:00.000Z');
    });

    it('during off-peak weekday morning: upcoming peak-start', () => {
        // Wed 04:00 LA = 11:00 UTC, peak starts Wed 05:00 LA = 12:00 UTC
        const now = utc('2026-04-15T11:00:00Z');
        const next = nextTransition(now, DEFAULT_PEAK_WINDOW);
        expect(next.toISOString()).toBe('2026-04-15T12:00:00.000Z');
    });

    it('weekend: next Monday peak-start', () => {
        // Sat 12:00 LA PDT = 19:00 UTC, next peak = Mon 05:00 LA = 12:00 UTC
        const now = utc('2026-04-18T19:00:00Z');
        const next = nextTransition(now, DEFAULT_PEAK_WINDOW);
        expect(next.toISOString()).toBe('2026-04-20T12:00:00.000Z');
    });
});

describe('validatePeakWindow', () => {
    it('returns defaults for null', () => {
        expect(validatePeakWindow(null)).toEqual(DEFAULT_PEAK_WINDOW);
    });

    it('returns defaults for undefined', () => {
        expect(validatePeakWindow(undefined)).toEqual(DEFAULT_PEAK_WINDOW);
    });

    it('returns defaults for non-object', () => {
        expect(validatePeakWindow('garbage')).toEqual(DEFAULT_PEAK_WINDOW);
    });

    it('accepts a valid custom window', () => {
        const custom = { days: [0, 6], start: '09:00', end: '17:00', tz: 'Australia/Sydney' };
        expect(validatePeakWindow(custom)).toEqual(custom);
    });

    it('falls back when tz is invalid', () => {
        const broken = { days: [1, 2, 3, 4, 5], start: '05:00', end: '11:00', tz: 'Not/AZone' };
        expect(validatePeakWindow(broken).tz).toBe('America/Los_Angeles');
    });

    it('falls back when start malformed', () => {
        const broken = { days: [1, 2, 3, 4, 5], start: '25:99', end: '11:00', tz: 'America/Los_Angeles' };
        expect(validatePeakWindow(broken).start).toBe('05:00');
    });

    it('filters out-of-range days', () => {
        const broken = { days: [1, 2, 9, -1, 5], start: '05:00', end: '11:00', tz: 'America/Los_Angeles' };
        expect(validatePeakWindow(broken).days).toEqual([1, 2, 5]);
    });

    it('falls back when all days are invalid', () => {
        const broken = { days: [9, -1], start: '05:00', end: '11:00', tz: 'America/Los_Angeles' };
        expect(validatePeakWindow(broken).days).toEqual([1, 2, 3, 4, 5]);
    });
});

describe('HAPPY_HOUR_ICONS', () => {
    it('exposes monochrome codicon options', () => {
        expect(HAPPY_HOUR_ICONS.sparkle).toBe('$(sparkle)');
        expect(HAPPY_HOUR_ICONS.watch).toBe('$(watch)');
        expect(HAPPY_HOUR_ICONS.zap).toBe('$(zap)');
        expect(HAPPY_HOUR_ICONS.star).toBe('$(star-full)');
    });

    it('exposes full-colour emoji options', () => {
        expect(HAPPY_HOUR_ICONS.beer).toBe('🍺');
        expect(HAPPY_HOUR_ICONS.cocktail).toBe('🍹');
        expect(HAPPY_HOUR_ICONS.wine).toBe('🍷');
        expect(HAPPY_HOUR_ICONS.champagne).toBe('🥂');
        expect(HAPPY_HOUR_ICONS.martini).toBe('🍸');
        expect(HAPPY_HOUR_ICONS.coffee).toBe('☕');
        expect(HAPPY_HOUR_ICONS.moon).toBe('🌙');
        expect(HAPPY_HOUR_ICONS.sparkles).toBe('✨');
        expect(HAPPY_HOUR_ICONS.palm).toBe('🌴');
        expect(HAPPY_HOUR_ICONS.party).toBe('🎉');
    });

    it('is frozen', () => {
        expect(Object.isFrozen(HAPPY_HOUR_ICONS)).toBe(true);
    });
});
