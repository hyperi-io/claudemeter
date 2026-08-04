// The Tk gauge is disabled in a remote window (#58): a `ui` extension
// resolves the workspace path against the CLIENT, so a remote path matches
// whatever the client happens to have there and can show another project's
// context. A gauge absent for a structural reason must say so rather than
// look broken.

import { describe, it, expect } from 'vitest';
const { composeTooltip } = require('../../src/tooltipComposer');

const SESSION_DATA = {
    tokenUsage: { current: 412_900, limit: 1_000_000 },
};

function compose(overrides) {
    return composeTooltip({
        usageData: null,
        sessionData: null,
        credentialsInfo: null,
        activityStats: null,
        platformTooltipLines: [],
        config: {},
        ...overrides,
    });
}

describe('tooltip context block in a remote window', () => {
    it('explains why the gauge is missing instead of omitting it', () => {
        const tooltip = compose({ remoteName: 'ssh-remote' });
        expect(tooltip).toContain('Current context - unavailable here');
        expect(tooltip).toContain('remote host');
    });

    it('says so even when session data somehow exists', () => {
        const tooltip = compose({ remoteName: 'ssh-remote', sessionData: SESSION_DATA });
        expect(tooltip).toContain('unavailable here');
        expect(tooltip).not.toContain('Tokens 412.9K');
    });

    it('applies to every remote authority, not just SSH', () => {
        for (const authority of ['wsl', 'dev-container', 'codespaces', 'tunnel']) {
            expect(compose({ remoteName: authority })).toContain('unavailable here');
        }
    });
});

describe('tooltip context block in a local window', () => {
    it('renders the real gauge', () => {
        const tooltip = compose({ remoteName: null, sessionData: SESSION_DATA });
        expect(tooltip).toContain('Current context - 41%');
        expect(tooltip).not.toContain('unavailable here');
    });

    it('stays silent when there is simply no session', () => {
        const tooltip = compose({ remoteName: null, sessionData: null });
        expect(tooltip).not.toContain('Current context');
    });
});
