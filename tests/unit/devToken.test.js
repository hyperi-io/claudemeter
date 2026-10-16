// scripts/dev-token.js helpers, exercised without touching any real store.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { kcWriteCommand, service, stashService, SECURITY_MAX_LINE } = require('../../scripts/dev-token');
const { keychainServiceName, KEYCHAIN_SERVICE } = require('../../src/tokenSource');

const SECRET = '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-fake","refreshToken":"rt-fake"}}';

describe('kcWriteCommand - the secret stays off argv', () => {
    it('carries the secret as hex, never in clear', () => {
        const line = kcWriteCommand('Claude Code-credentials', 'derek', SECRET);
        expect(line).not.toContain('sk-ant-oat01-fake');
        expect(line).toContain(`-X ${Buffer.from(SECRET, 'utf8').toString('hex')}`);
        expect(line.startsWith('add-generic-password -U -s "Claude Code-credentials" -a "derek" ')).toBe(true);
        expect(line.endsWith('\n')).toBe(true);
    });

    it('refuses a line security -i would split into two commands', () => {
        const huge = 'x'.repeat(SECURITY_MAX_LINE);
        expect(() => kcWriteCommand('svc', 'acct', huge)).toThrow(/too long/);
    });

    it('refuses a name it would have to escape', () => {
        expect(() => kcWriteCommand('svc"; delete-generic-password -s "x', 'acct', SECRET)).toThrow();
        expect(() => kcWriteCommand('svc', 'ac\nct', SECRET)).toThrow();
    });
});

describe('Keychain service names follow the config dir', () => {
    const saved = {};
    beforeEach(() => {
        for (const k of ['CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR']) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });
    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    it('uses the bare name for the default dir', () => {
        expect(service()).toBe(KEYCHAIN_SERVICE);
        expect(stashService()).toBe(`${KEYCHAIN_SERVICE}-claudemeter-stash`);
    });

    it('uses the scoped name tokenSource derives when CLAUDE_CONFIG_DIR is set', () => {
        process.env.CLAUDE_CONFIG_DIR = '/tmp/claudemeter-test-config';
        expect(service()).toBe(keychainServiceName());
        expect(service()).not.toBe(KEYCHAIN_SERVICE);
        expect(stashService()).toBe(`${keychainServiceName()}-claudemeter-stash`);
    });
});
