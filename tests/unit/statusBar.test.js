// Tests for stopSpinner's error rendering. Two defects shipped through this
// function unseen because it had no test file: the honest auth tooltip was
// overwritten in the same tick, and the fix for that erased the compact
// panel's threshold colour on every successful fetch.

import { describe, it, expect, beforeEach } from 'vitest';
const vscode = require('vscode');
const { createStatusBarItem, stopSpinner } = require('../../src/statusBar');

// createStatusBarItem populates the module's own item registry, so a fake
// extension context is all that is needed to drive the real renderer.
function freshItems(displayMode = 'default') {
    vscode._resetConfigValues();
    vscode._setConfigValues({ 'statusBar.displayMode': displayMode });
    const context = { subscriptions: [] };
    createStatusBarItem(context);
    return context.subscriptions;
}

function authError(authReason, authContext) {
    const err = new Error('rendered elsewhere');
    err.authReason = authReason;
    err.authContext = authContext;
    return err;
}

function tooltipOf(items) {
    const withTooltip = items.find((i) => i.tooltip && i.tooltip.value);
    return withTooltip ? withTooltip.tooltip.value : '';
}

describe('stopSpinner - an auth failure outranks the combined branch', () => {
    let items;
    beforeEach(() => { items = freshItems(); });

    // tokenError is set in every window with no live Claude Code session,
    // which is exactly where a logged-out user is.
    it('renders the auth copy even when a token error is also present', () => {
        stopSpinner(authError('TOKEN_BLANK', {}), new Error('No token data available'));
        const tooltip = tooltipOf(items);
        expect(tooltip).toContain('Claude Code stored an empty login');
        expect(tooltip).not.toContain('Complete Fetch Failed');
    });

    it('still notes the missing context gauge alongside it', () => {
        stopSpinner(authError('TOKEN_BLANK', {}), new Error('No token data available'));
        expect(tooltipOf(items)).toContain('No Claude Code session in this window');
    });

    it('falls back to the generic copy for a non-auth error', () => {
        stopSpinner(new Error('API_ERROR_500'), null);
        expect(tooltipOf(items)).toContain('Web Fetch Failed');
    });
});

describe('stopSpinner - the login prompt is offered only where it helps', () => {
    let items;
    beforeEach(() => { items = freshItems(); });

    it('offers login when there is no token at all', () => {
        stopSpinner(authError('NO_TOKEN', {}), null);
        expect(tooltipOf(items)).toContain('Click to log into Claude Code');
    });

    it('withholds it for a stored blank token', () => {
        stopSpinner(authError('TOKEN_BLANK', {}), null);
        const tooltip = tooltipOf(items);
        expect(tooltip).not.toContain('Click to log into Claude Code');
        expect(tooltip).toContain('Show Debug Output');
    });
});

// The tooltip is a trusted MarkdownString, so a command link in it executes.
describe('stopSpinner - untrusted values cannot inject a command link', () => {
    it('escapes a command link planted in the config dir', () => {
        const items = freshItems();
        stopSpinner(authError('NO_TOKEN', {
            lookedIn: '/tmp/[PWNED](command:workbench.action.terminal.new)',
        }), null);
        expect(tooltipOf(items)).not.toContain('[PWNED](command:');
    });
});

// updateStatusBar runs immediately before stopSpinner and owns the normal
// colours, including the compact panel's threshold and rot colours.
describe('stopSpinner - a clean fetch leaves the rendered state alone', () => {
    it('does not touch the compact panel colour when there is no error', () => {
        const items = freshItems('compact');
        const compact = items[items.length - 1];
        compact.color = new vscode.ThemeColor('claudemeter.outageRed');
        compact.text = 'Claude Se 95%';
        stopSpinner(null, null);
        expect(compact.color.id).toBe('claudemeter.outageRed');
        expect(compact.text).toBe('Claude Se 95%');
    });

    it('does not touch the label colour when there is no error', () => {
        const items = freshItems();
        const label = items[0];
        label.color = new vscode.ThemeColor('charts.red');
        stopSpinner(null, null);
        expect(label.color.id).toBe('charts.red');
    });

    it('leaves tooltips untouched when there is no error', () => {
        const items = freshItems();
        items[0].tooltip = 'the composed usage tooltip';
        stopSpinner(null, null);
        expect(items[0].tooltip).toBe('the composed usage tooltip');
    });
});
