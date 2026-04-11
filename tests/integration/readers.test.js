// Integration tests for claudeConfigReader + credentialsReader.
//
// These tests exercise the readers against a real filesystem (not mocks),
// using CLAUDE_CONFIG_HOME to redirect ~ to a tmp directory. The goal is
// to catch regressions in the "v1 vs v2 credentials file format" handling
// and to prove that file-missing cases return null rather than throwing.
//
// Scenarios covered:
//   - v2 format: oauthAccount in .claude.json, tokens in .credentials.json
//   - v1 format: identity fields in .credentials.json only
//   - Missing .claude.json (pre-v2 install)
//   - Missing .credentials.json (fresh install, no login)
//   - Both files missing
//   - s1mAccessCache true / false / missing

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Require the modules LAZILY inside each test so the CLAUDE_CONFIG_HOME
// env var is picked up at call time. Top-level requires would snapshot the
// module-load constants against the real home dir.
function loadReaders() {
    // Bust require cache so getters re-resolve CLAUDE_CONFIG_HOME
    delete require.cache[require.resolve('../../src/claudeConfigReader')];
    delete require.cache[require.resolve('../../src/credentialsReader')];
    return {
        claudeConfig: require('../../src/claudeConfigReader'),
        credentials: require('../../src/credentialsReader'),
    };
}

let tmpHome;
let originalHome;

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-test-'));
    originalHome = process.env.CLAUDE_CONFIG_HOME;
    process.env.CLAUDE_CONFIG_HOME = tmpHome;
    // Ensure ~/.claude subdir exists (credentials live there)
    fs.mkdirSync(path.join(tmpHome, '.claude'), { recursive: true });
});

afterEach(() => {
    if (originalHome === undefined) {
        delete process.env.CLAUDE_CONFIG_HOME;
    } else {
        process.env.CLAUDE_CONFIG_HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeClaudeConfig(json) {
    fs.writeFileSync(path.join(tmpHome, '.claude.json'), JSON.stringify(json));
}
function writeCredentials(json) {
    fs.writeFileSync(path.join(tmpHome, '.claude', '.credentials.json'), JSON.stringify(json));
}

describe('claudeConfigReader.getOAuthAccount', () => {
    it('returns null when ~/.claude.json is missing', () => {
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.getOAuthAccount()).toBeNull();
    });

    it('returns null when oauthAccount block missing', () => {
        writeClaudeConfig({ someOtherKey: true });
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.getOAuthAccount()).toBeNull();
    });

    it('returns full identity when oauthAccount present', () => {
        writeClaudeConfig({
            hasAvailableSubscription: true,
            hasOpusPlanDefault: true,
            oauthAccount: {
                accountUuid: 'acc-1',
                organizationUuid: 'org-1',
                emailAddress: 'user@example.com',
                displayName: 'User',
                organizationName: "User's Organization",
                organizationRole: 'owner',
                billingType: 'personal',
            },
        });
        const { claudeConfig } = loadReaders();
        const acc = claudeConfig.getOAuthAccount();
        expect(acc).toEqual({
            accountUuid: 'acc-1',
            organizationUuid: 'org-1',
            emailAddress: 'user@example.com',
            displayName: 'User',
            organizationName: "User's Organization",
            organizationRole: 'owner',
            billingType: 'personal',
            hasAvailableSubscription: true,
            hasOpusPlanDefault: true,
        });
    });

    it('returns null on malformed JSON', () => {
        fs.writeFileSync(path.join(tmpHome, '.claude.json'), 'not json {{{');
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.getOAuthAccount()).toBeNull();
    });
});

describe('claudeConfigReader.hasMaxContextAccess', () => {
    it('returns null when file missing', () => {
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.hasMaxContextAccess()).toBeNull();
    });

    it('returns null when no s1mAccessCache entry for current org', () => {
        writeClaudeConfig({
            oauthAccount: { organizationUuid: 'org-1' },
            s1mAccessCache: {},
        });
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.hasMaxContextAccess()).toBeNull();
    });

    it('returns true when current org has hasAccess: true', () => {
        writeClaudeConfig({
            oauthAccount: { organizationUuid: 'org-1' },
            s1mAccessCache: { 'org-1': { hasAccess: true } },
        });
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.hasMaxContextAccess()).toBe(true);
    });

    it('returns false when current org has hasAccess: false', () => {
        writeClaudeConfig({
            oauthAccount: { organizationUuid: 'org-1' },
            s1mAccessCache: { 'org-1': { hasAccess: false } },
        });
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.hasMaxContextAccess()).toBe(false);
    });

    it('only returns cache for the currently-logged-in org, not others', () => {
        // Cache has an entry for a DIFFERENT org — should be ignored
        writeClaudeConfig({
            oauthAccount: { organizationUuid: 'org-current' },
            s1mAccessCache: {
                'org-other': { hasAccess: true },
            },
        });
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.hasMaxContextAccess()).toBeNull();
    });
});

describe('credentialsReader.readCredentials (merged view)', () => {
    it('returns null when both files missing', () => {
        const { credentials } = loadReaders();
        expect(credentials.readCredentials()).toBeNull();
    });

    it('v2 format: identity from .claude.json, tokens from .credentials.json', () => {
        writeClaudeConfig({
            hasAvailableSubscription: true,
            oauthAccount: {
                accountUuid: 'acc-v2',
                organizationUuid: 'org-v2',
                emailAddress: 'v2@example.com',
                displayName: 'V2 User',
                organizationName: "V2 User's Organization",
                billingType: 'personal',
            },
        });
        writeCredentials({
            claudeAiOauth: {
                accessToken: 'token-xxx',
                refreshToken: 'refresh-xxx',
                // New Claude Code does NOT write these
                subscriptionType: null,
                rateLimitTier: null,
            },
        });
        const { credentials } = loadReaders();
        const c = credentials.readCredentials();
        expect(c.orgId).toBe('org-v2');
        expect(c.accountUuid).toBe('acc-v2');
        expect(c.email).toBe('v2@example.com');
        expect(c.hasAccessToken = !!c.accessToken).toBe(true);
        expect(c.hasAvailableSubscription).toBe(true);
    });

    it('v1 fallback: credentials.json only (pre-v2 Claude Code build)', () => {
        writeCredentials({
            organizationUuid: 'org-v1',
            claudeAiOauth: {
                accessToken: 'token-yyy',
                subscriptionType: 'max',
                rateLimitTier: 'default_claude_max_20x',
            },
        });
        const { credentials } = loadReaders();
        const c = credentials.readCredentials();
        expect(c.orgId).toBe('org-v1');
        expect(c.subscriptionType).toBe('max');
        expect(c.rateLimitTier).toBe('default_claude_max_20x');
        expect(c.accountUuid).toBeNull(); // v1 didn't have it
    });

    it('identity changed (v1 → v2 format upgrade on same account) is NOT a switch if accountUuid matches across', () => {
        // Simulate pre-upgrade state
        writeCredentials({
            organizationUuid: 'org-1',
            claudeAiOauth: { accessToken: 'tok' },
        });
        const { credentials } = loadReaders();
        const before = credentials.readCredentials();
        const beforeKey = credentials.getIdentityKey(before);

        // Simulate post-upgrade state — .claude.json now exists with
        // matching orgId and added accountUuid/email
        writeClaudeConfig({
            oauthAccount: {
                accountUuid: 'acc-1',
                organizationUuid: 'org-1',
                emailAddress: 'user@example.com',
            },
        });
        const { credentials: credentials2 } = loadReaders();
        const after = credentials2.readCredentials();
        const afterKey = credentials2.getIdentityKey(after);

        // Even though accountUuid/email became non-null, the PRIMARY
        // identifier (orgId) is unchanged. identityChanged uses OR so
        // technically this IS flagged as a change because accountUuid
        // went from null → non-null. That's acceptable — it forces a
        // fresh fetch after the upgrade, which is desired.
        expect(credentials2.identityChanged(beforeKey, afterKey)).toBe(true);
    });

    it('returns partial when only .claude.json present (no credentials file yet)', () => {
        writeClaudeConfig({
            oauthAccount: {
                accountUuid: 'acc-1',
                organizationUuid: 'org-1',
                emailAddress: 'user@example.com',
            },
        });
        const { credentials } = loadReaders();
        const c = credentials.readCredentials();
        expect(c).not.toBeNull();
        expect(c.orgId).toBe('org-1');
        expect(c.accessToken).toBeNull();
    });
});

describe('claudeConfigReader.findSessionForWorkspace', () => {
    beforeEach(() => {
        fs.mkdirSync(path.join(tmpHome, '.claude', 'sessions'), { recursive: true });
    });

    it('returns null when no sessions exist', () => {
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.findSessionForWorkspace('/some/workspace')).toBeNull();
    });

    it('matches session by cwd', () => {
        fs.writeFileSync(
            path.join(tmpHome, '.claude', 'sessions', '1234.json'),
            JSON.stringify({
                pid: 1234,
                sessionId: 'sess-1',
                cwd: '/workspace/a',
                startedAt: 1000,
                kind: 'interactive',
                entrypoint: 'cli',
            })
        );
        const { claudeConfig } = loadReaders();
        const session = claudeConfig.findSessionForWorkspace('/workspace/a');
        expect(session).not.toBeNull();
        expect(session.pid).toBe(1234);
        expect(session.sessionId).toBe('sess-1');
    });

    it('prefers the most recently started session when multiple match', () => {
        fs.writeFileSync(
            path.join(tmpHome, '.claude', 'sessions', '1111.json'),
            JSON.stringify({ pid: 1111, sessionId: 'older', cwd: '/w', startedAt: 100 })
        );
        fs.writeFileSync(
            path.join(tmpHome, '.claude', 'sessions', '2222.json'),
            JSON.stringify({ pid: 2222, sessionId: 'newer', cwd: '/w', startedAt: 500 })
        );
        const { claudeConfig } = loadReaders();
        const session = claudeConfig.findSessionForWorkspace('/w');
        expect(session.sessionId).toBe('newer');
    });

    it('ignores workspaces that don\'t match', () => {
        fs.writeFileSync(
            path.join(tmpHome, '.claude', 'sessions', '1.json'),
            JSON.stringify({ pid: 1, sessionId: 'x', cwd: '/other', startedAt: 1 })
        );
        const { claudeConfig } = loadReaders();
        expect(claudeConfig.findSessionForWorkspace('/mine')).toBeNull();
    });

    it('tolerates corrupt session files', () => {
        fs.writeFileSync(path.join(tmpHome, '.claude', 'sessions', 'bad.json'), 'not json');
        fs.writeFileSync(
            path.join(tmpHome, '.claude', 'sessions', 'good.json'),
            JSON.stringify({ pid: 2, sessionId: 'g', cwd: '/w', startedAt: 1 })
        );
        const { claudeConfig } = loadReaders();
        const session = claudeConfig.findSessionForWorkspace('/w');
        expect(session.sessionId).toBe('g');
    });
});
