// Integration tests for tokenSource against a real filesystem (no mocks),
// using CLAUDE_CONFIG_DIR to redirect the store to a tmp directory.
//
// Setting CLAUDE_CONFIG_DIR is also what makes this hermetic on macOS: the
// Keychain service name is derived from that directory, so the lookup asks for
// an item that cannot exist and the file store is authoritative. Without it
// these tests would read the developer's real login.
//
// Scenarios covered:
//   - the blank-token store Claude Code writes after a failed persist (#57)
//   - no store at all
//   - a usable token
//   - stores that are neither, which must NOT read as blank
//   - CLAUDE_CONFIG_DIR reaching the credentials and sessions paths

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadTokenSource() {
    delete require.cache[require.resolve('../../src/tokenSource')];
    return require('../../src/tokenSource');
}

function loadReaders() {
    delete require.cache[require.resolve('../../src/tokenSource')];
    delete require.cache[require.resolve('../../src/claudeConfigReader')];
    delete require.cache[require.resolve('../../src/credentialsReader')];
    return {
        claudeConfig: require('../../src/claudeConfigReader'),
        credentials: require('../../src/credentialsReader'),
    };
}

let tmpDir;
const saved = {};
// An auth-override env var short-circuits readToken before any store is read,
// so a developer with one set would see every case below return ENV_OVERRIDE.
const CLEARED = ['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CONFIG_HOME',
    'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-store-'));
    for (const name of CLEARED) {
        saved[name] = process.env[name];
        delete process.env[name];
    }
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
});

afterEach(() => {
    for (const name of CLEARED) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeStore(json) {
    fs.writeFileSync(path.join(tmpDir, '.credentials.json'), JSON.stringify(json));
}

describe('tokenSource.readToken - the states behind "not logged in" (#57)', () => {
    it('reports a blank stored token as TOKEN_BLANK, not as no token', () => {
        writeStore({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } });
        const tok = loadTokenSource().readToken();
        expect(tok.ok).toBe(false);
        expect(tok.reason).toBe('TOKEN_BLANK');
        expect(tok.source).toBe('file');
        expect(tok.detail).toBe(tmpDir);
    });

    it('reports an absent store as NO_TOKEN', () => {
        const tok = loadTokenSource().readToken();
        expect(tok.ok).toBe(false);
        expect(tok.reason).toBe('NO_TOKEN');
    });

    it('reads a usable token from the redirected config dir', () => {
        writeStore({ claudeAiOauth: { accessToken: 'oat-live', expiresAt: Date.now() + 3600_000 } });
        const tok = loadTokenSource().readToken();
        expect(tok.ok).toBe(true);
        expect(tok.token).toBe('oat-live');
        expect(tok.source).toBe('file');
        expect(tok.expired).toBe(false);
    });

    it('accepts the bare oauth shape as well as the wrapped one', () => {
        writeStore({ accessToken: 'oat-bare', expiresAt: Date.now() + 3600_000 });
        expect(loadTokenSource().readToken().token).toBe('oat-bare');
    });

    it('marks a past expiry as expired without discarding the token', () => {
        writeStore({ claudeAiOauth: { accessToken: 'oat-old', expiresAt: Date.now() - 1000 } });
        const tok = loadTokenSource().readToken();
        expect(tok.ok).toBe(true);
        expect(tok.expired).toBe(true);
    });

    it('treats malformed JSON as no token, so login is still offered', () => {
        fs.writeFileSync(path.join(tmpDir, '.credentials.json'), '{ not json');
        expect(loadTokenSource().readToken().reason).toBe('NO_TOKEN');
    });

    it('does not call a store holding only mcpOAuth blank', () => {
        writeStore({ mcpOAuth: { some: 'thing' } });
        expect(loadTokenSource().readToken().reason).toBe('NO_TOKEN');
    });
});

describe('tokenSource.describeStores - diagnostics carry no secrets', () => {
    it('reports presence and paths without any token value', () => {
        writeStore({ claudeAiOauth: { accessToken: 'oat-secret-value', expiresAt: Date.now() + 1000 } });
        const stores = loadTokenSource().describeStores();
        expect(JSON.stringify(stores)).not.toContain('oat-secret-value');
        expect(stores.configDir).toBe(tmpDir);
        expect(stores.configDirFromEnv).toBe(true);
        const file = stores.stores.find((s) => s.store === 'file');
        expect(file.exists).toBe(true);
        expect(file.hasToken).toBe(true);
    });

    it('distinguishes a blank store from an absent one', () => {
        writeStore({ claudeAiOauth: { accessToken: '' } });
        const file = loadTokenSource().describeStores().stores.find((s) => s.store === 'file');
        expect(file.exists).toBe(true);
        expect(file.hasToken).toBe(false);
        expect(file.blank).toBe(true);
    });
});

describe('CLAUDE_CONFIG_DIR reaches every Claude-owned path', () => {
    it('moves the credentials file, the sessions dir and .claude.json together', () => {
        const { claudeConfig, credentials } = loadReaders();
        expect(credentials.getCredentialsPath()).toBe(path.join(tmpDir, '.credentials.json'));
        expect(claudeConfig.getClaudeSessionsDir()).toBe(path.join(tmpDir, 'sessions'));
        expect(claudeConfig.getClaudeConfigPath()).toBe(path.join(tmpDir, '.claude.json'));
    });

    it('prefers a .config.json inside the config dir where one exists', () => {
        fs.writeFileSync(path.join(tmpDir, '.config.json'), '{}');
        expect(loadReaders().claudeConfig.getClaudeConfigPath())
            .toBe(path.join(tmpDir, '.config.json'));
    });

    it('keeps .claude.json at the home dir when no config dir is set', () => {
        delete process.env.CLAUDE_CONFIG_DIR;
        expect(loadReaders().claudeConfig.getClaudeConfigPath())
            .toBe(path.join(os.homedir(), '.claude.json'));
    });

    it('agrees with the token reader on where the store is', () => {
        const { credentials } = loadReaders();
        const ts = loadTokenSource();
        expect(credentials.getCredentialsPath()).toBe(ts.credentialsFilePath());
    });
});
