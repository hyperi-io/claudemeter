// Tests for the remote-window login guard (#58).
//
// Claudemeter declares extensionKind "ui", so it resolves the CLI and reads
// the credential store on the CLIENT, while VS Code terminals follow the
// window's remote authority. Sending a login to a terminal in a Remote-SSH
// window runs it on the wrong machine, with a client path the remote shell
// cannot use.

import { describe, it, expect } from 'vitest';
const { loginReachesMeteredMachine, describeRemoteLogin } = require('../../src/authFailure');

describe('loginReachesMeteredMachine', () => {
    it('allows a login in a local window', () => {
        expect(loginReachesMeteredMachine(undefined)).toBe(true);
        expect(loginReachesMeteredMachine('')).toBe(true);
    });

    it('refuses in every remote authority VS Code reports', () => {
        for (const authority of ['ssh-remote', 'wsl', 'dev-container',
            'attached-container', 'codespaces', 'tunnel']) {
            expect(loginReachesMeteredMachine(authority)).toBe(false);
        }
    });

    it('refuses an authority it does not recognise', () => {
        expect(loginReachesMeteredMachine('some-future-remote')).toBe(false);
    });
});

describe('describeRemoteLogin', () => {
    it('names the kind of window the user is actually in', () => {
        expect(describeRemoteLogin('ssh-remote', '/usr/local/bin/claude').lines.join(' '))
            .toContain('Remote-SSH');
        expect(describeRemoteLogin('wsl', '/usr/local/bin/claude').lines.join(' '))
            .toContain('WSL');
    });

    it('falls back to generic wording for an unknown authority', () => {
        const { lines } = describeRemoteLogin('some-future-remote', '/usr/local/bin/claude');
        expect(lines.join(' ')).toContain('a remote window');
    });

    it('gives the client CLI path as a runnable command', () => {
        const { lines } = describeRemoteLogin('ssh-remote', '/usr/local/bin/claude');
        expect(lines.join(' ')).toContain('/usr/local/bin/claude auth login');
    });

    // The reported case: a Windows client path, which a bash shell would
    // mangle and which must be quoted when pasted.
    it('quotes a client path containing spaces', () => {
        const win = 'C:\\Users\\Some User\\.local\\bin\\claude.exe';
        expect(describeRemoteLogin('ssh-remote', win).lines.join(' '))
            .toContain(`"${win}" auth login`);
    });

    it('leaves a space-free path unquoted', () => {
        const { lines } = describeRemoteLogin('ssh-remote', 'C:\\Users\\jsmith\\claude.exe');
        expect(lines.join(' ')).not.toContain('"C:\\Users\\jsmith\\claude.exe"');
    });

    it('still advises a login when no CLI path was resolved', () => {
        const { lines } = describeRemoteLogin('ssh-remote', null);
        expect(lines.join(' ')).toContain('claude auth login');
    });

    it('says the login belongs on the local machine', () => {
        expect(describeRemoteLogin('ssh-remote', '/x/claude').title).toContain('local machine');
    });

    it('explains that a terminal here would run on the remote host', () => {
        expect(describeRemoteLogin('ssh-remote', '/x/claude').lines.join(' '))
            .toContain('run on the remote host');
    });
});
