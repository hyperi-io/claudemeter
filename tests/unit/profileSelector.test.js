import { describe, it, expect, beforeEach } from 'vitest';
import { selectProfile, resetUnknownWarning } from '../../src/tk/profileSelector.js';

describe('selectProfile — happy paths', () => {
    beforeEach(() => resetUnknownWarning());

    it('max + default_claude_max_20x → max-20x', () => {
        expect(selectProfile({
            subscriptionType: 'max',
            rateLimitTier: 'default_claude_max_20x',
        }).name).toBe('max-20x');
    });

    it('max + default_claude_max_5x → max-5x', () => {
        expect(selectProfile({
            subscriptionType: 'max',
            rateLimitTier: 'default_claude_max_5x',
        }).name).toBe('max-5x');
    });

    it('max alone → max-unknown', () => {
        expect(selectProfile({ subscriptionType: 'max' }).name).toBe('max-unknown');
    });

    it('max with unrecognised rateLimitTier → max-unknown (rate-limit string mismatch falls through to subscriptionType branch)', () => {
        expect(selectProfile({
            subscriptionType: 'max',
            rateLimitTier: 'something_new',
        }).name).toBe('max-unknown');
    });

    it('pro alone → pro', () => {
        expect(selectProfile({ subscriptionType: 'pro' }).name).toBe('pro');
    });

    it('orgType Enterprise → enterprise', () => {
        expect(selectProfile({ orgType: 'Enterprise' }).name).toBe('enterprise');
    });

    it('orgType Team → team-standard', () => {
        expect(selectProfile({ orgType: 'Team' }).name).toBe('team-standard');
    });

    it('all-undefined signals → unknown', () => {
        expect(selectProfile({}).name).toBe('unknown');
    });

    it('null signals → unknown (defensive)', () => {
        expect(selectProfile(null).name).toBe('unknown');
    });

    it('undefined signals object → unknown (defensive)', () => {
        expect(selectProfile().name).toBe('unknown');
    });
});

describe('selectProfile — priority order', () => {
    beforeEach(() => resetUnknownWarning());

    it('subscriptionType=max + orgType=Enterprise → max profile beats org-only Enterprise (max is more specific)', () => {
        // This documents that max gets matched BEFORE the orgType-only branch.
        // If a user is somehow on a Max plan within an Enterprise org, max wins.
        expect(selectProfile({
            subscriptionType: 'max',
            orgType: 'Enterprise',
        }).name).toBe('max-unknown');
    });
});

describe('selectProfile — unknown warning behaviour', () => {
    beforeEach(() => resetUnknownWarning());

    it('emits exactly one warning per activation when detection falls through', () => {
        const calls = [];
        const logger = { appendLine: (msg) => calls.push(msg) };

        selectProfile({}, logger);
        selectProfile({}, logger);
        selectProfile({ subscriptionType: 'glasswing-unknown' }, logger);

        expect(calls.length).toBe(1);
        expect(calls[0]).toMatch(/profile detection fell through/);
    });

    it('resetUnknownWarning re-arms the warning', () => {
        const calls = [];
        const logger = { appendLine: (msg) => calls.push(msg) };

        selectProfile({}, logger);
        expect(calls.length).toBe(1);

        resetUnknownWarning();
        selectProfile({}, logger);
        expect(calls.length).toBe(2);
    });

    it("does not crash when no logger is provided", () => {
        expect(() => selectProfile({})).not.toThrow();
    });
});
