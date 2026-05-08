// Full-stack integration test for the Tk profile/threshold/colour pipeline.
// No vscode runtime; exercises the pure modules end-to-end:
//   selectProfile(signals) → getTkLevel(used, profile, window) → TIER_COLORS / TIER_RECOMMENDATIONS

import { describe, it, expect, beforeEach } from 'vitest';
const { selectProfile, resetUnknownWarning } = require('../../src/tk/profileSelector');
const { getTkLevel } = require('../../src/tk/thresholds');
const { TIER_COLORS } = require('../../src/tk/colorMap');
const { TIER_RECOMMENDATIONS } = require('../../src/tk/recommendations');

describe('tk integration — detection → profile → level → colour → recommendation', () => {
    beforeEach(() => resetUnknownWarning());

    it('Max-20x at 600K used on 1M → rotDeep + rot blue + rot recommendation', () => {
        const profile = selectProfile({
            subscriptionType: 'max',
            rateLimitTier: 'default_claude_max_20x',
        });
        expect(profile.name).toBe('max-20x');

        const level = getTkLevel(600_000, profile, 1_000_000);
        expect(level).toBe('rotDeep');

        const colour = TIER_COLORS[level];
        expect(colour).not.toBeNull();
        expect(colour.theme).toBe('claudemeter.rotDeep');
        expect(colour.setting).toBe('colors.rotDeep');
        expect(colour.hex).toMatch(/^#[0-9a-f]{6}$/i);

        const text = TIER_RECOMMENDATIONS[level];
        expect(text).toMatch(/Quality drops sharply/);
        expect(text).toMatch(/on your terms/);
    });

    it('Max-20x at 350K used on 1M → rotLight + drift recommendation', () => {
        const profile = selectProfile({
            subscriptionType: 'max',
            rateLimitTier: 'default_claude_max_20x',
        });
        const level = getTkLevel(350_000, profile, 1_000_000);
        expect(level).toBe('rotLight');
        expect(TIER_COLORS[level].theme).toBe('claudemeter.rotLight');
        expect(TIER_RECOMMENDATIONS[level]).toMatch(/Recall starts to drift/);
    });

    it('Max-5x at 962K used on 1M → error + imminent recommendation', () => {
        const profile = selectProfile({
            subscriptionType: 'max',
            rateLimitTier: 'default_claude_max_5x',
        });
        expect(profile.name).toBe('max-5x');

        const level = getTkLevel(962_000, profile, 1_000_000);
        expect(level).toBe('error');
        expect(TIER_COLORS[level].theme).toBe('claudemeter.outageRed');
        expect(TIER_RECOMMENDATIONS[level]).toMatch(/imminent/);
    });

    it('Pro at 162K used on 200K → error + imminent recommendation', () => {
        const profile = selectProfile({ subscriptionType: 'pro' });
        expect(profile.name).toBe('pro');

        const level = getTkLevel(162_000, profile, 200_000);
        expect(level).toBe('error');
        expect(TIER_COLORS[level].theme).toBe('claudemeter.outageRed');
        expect(TIER_RECOMMENDATIONS[level]).toMatch(/imminent/);
    });

    it('Pro at 147K used on 200K → warning + approaching recommendation', () => {
        const profile = selectProfile({ subscriptionType: 'pro' });
        const level = getTkLevel(147_000, profile, 200_000);
        expect(level).toBe('warning');
        expect(TIER_COLORS[level].theme).toBe('charts.yellow');
        expect(TIER_RECOMMENDATIONS[level]).toMatch(/Auto-compact approaching/);
    });

    it('Pro at 50K used on 200K → normal (no colour, no recommendation)', () => {
        const profile = selectProfile({ subscriptionType: 'pro' });
        const level = getTkLevel(50_000, profile, 200_000);
        expect(level).toBe('normal');
        expect(TIER_COLORS[level]).toBeNull();
        expect(TIER_RECOMMENDATIONS[level]).toBeNull();
    });

    it('Pro at 300K used on 200K (over the window) → error (rot tiers do not fire because rotEnabled=false on pro)', () => {
        const profile = selectProfile({ subscriptionType: 'pro' });
        // 300K used on a 200K window is conceptually impossible, but we
        // still want a sensible result — error wins because used is way
        // past compactPoint - errorRunwayTokens (162K).
        const level = getTkLevel(300_000, profile, 200_000);
        expect(level).toBe('error');
    });

    it('Enterprise at 350K used on 500K → normal (rot disabled, below warning threshold of ~447K)', () => {
        const profile = selectProfile({ orgType: 'Enterprise' });
        expect(profile.name).toBe('enterprise');
        expect(profile.thresholds.rotEnabled).toBe(false);

        const level = getTkLevel(350_000, profile, 500_000);
        expect(level).toBe('normal');
    });

    it('Enterprise at 462K used on 500K → error', () => {
        const profile = selectProfile({ orgType: 'Enterprise' });
        const level = getTkLevel(462_000, profile, 500_000);
        expect(level).toBe('error');
    });

    it('Unknown signals → unknown profile → normal at any reasonable usage', () => {
        const profile = selectProfile({});
        expect(profile.name).toBe('unknown');
        expect(profile.thresholds.rotEnabled).toBe(false);

        // 50K on a 200K assumed window
        expect(getTkLevel(50_000, profile, 200_000)).toBe('normal');
    });

    it('Team profile at 947K used on 1M → warning', () => {
        const profile = selectProfile({ orgType: 'Team' });
        expect(profile.name).toBe('team-standard');
        const level = getTkLevel(947_000, profile, 1_000_000);
        expect(level).toBe('warning');
    });
});

describe('tk integration — colorMap and recommendations cover all five tier names', () => {
    it('every level except normal has a colorMap entry', () => {
        ['rotLight', 'rotDeep', 'warning', 'error'].forEach((tier) => {
            expect(TIER_COLORS[tier]).not.toBeNull();
            expect(TIER_COLORS[tier].theme).toBeDefined();
            expect(TIER_COLORS[tier].setting).toBeDefined();
            expect(TIER_COLORS[tier].hex).toMatch(/^#[0-9a-f]{6}$/i);
        });
    });

    it('every level except normal has a recommendation string', () => {
        ['rotLight', 'rotDeep', 'warning', 'error'].forEach((tier) => {
            expect(TIER_RECOMMENDATIONS[tier]).toBeTruthy();
            expect(typeof TIER_RECOMMENDATIONS[tier]).toBe('string');
        });
    });

    it("'normal' is null in both maps", () => {
        expect(TIER_COLORS.normal).toBeNull();
        expect(TIER_RECOMMENDATIONS.normal).toBeNull();
    });

    it('recommendation strings carry no model name, version, or specific token count', () => {
        for (const [tier, text] of Object.entries(TIER_RECOMMENDATIONS)) {
            if (text === null) continue;
            expect(text).not.toMatch(/Opus/);
            expect(text).not.toMatch(/Sonnet/);
            expect(text).not.toMatch(/Haiku/);
            expect(text).not.toMatch(/4\.\d/);
            expect(text).not.toMatch(/MRCR/);
            expect(text).not.toMatch(/\d{3}K/);   // no "300K", "400K" etc.
        }
    });
});
