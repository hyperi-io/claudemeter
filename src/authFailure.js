// Project:   Claudemeter
// File:      authFailure.js
// Purpose:   Name each way the OAuth read can fail, and what to tell the user.
// Language:  JavaScript (CommonJS)
//
// One message for every auth failure sent users round a loop they could not
// escape (#57): a login that succeeds but persists a blank token renders the
// same as no login at all, so the advice was "log in again" for a state that
// re-login reproduces. Each reason now carries its own text and, crucially,
// whether logging in again can actually help.
//
// vscode-free by design so both the status bar and the tooltip resolve the
// same wording.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// canRelogin drives the click action: false suppresses the login prompt, which
// is the difference between a fix and a treadmill.
const AUTH_FAILURES = {
    NO_TOKEN: {
        title: 'Not logged into Claude Code',
        lines: ['Claudemeter reads Claude Code\'s login to show your usage.'],
        canRelogin: true,
    },
    TOKEN_BLANK: {
        title: 'Claude Code stored an empty login',
        lines: [
            'The credential store is there but holds a blank token, so the login did not persist.',
            'Logging in again reproduces it, and so does `claude auth logout` - this one is Claude Code\'s to fix.',
            'What has cleared it for others is deleting the store outright, then logging in.',
            'macOS: `security delete-generic-password -s "Claude Code-credentials"`. Elsewhere: delete `~/.claude/.credentials.json`.',
            'That also discards any MCP server logins, which have to be re-authorised.',
        ],
        canRelogin: false,
    },
    STORE_NO_LOGIN: {
        title: 'Claude Code\'s credential store holds no login',
        lines: [
            'The store exists but has no Claude login in it - other entries (e.g. MCP server logins) can outlive the login itself.',
            'Run `claude auth login` to restore it.',
            'If that does not stick, delete the store first. macOS: `security delete-generic-password -s "Claude Code-credentials"`. Elsewhere: delete `~/.claude/.credentials.json`.',
            'Deleting the store discards MCP server logins too, which have to be re-authorised.',
        ],
        canRelogin: true,
    },
    TOKEN_REJECTED: {
        title: 'Claude rejected the stored login',
        lines: [
            'The token is there and Anthropic refused it.',
            'Run `claude auth login` to replace it.',
        ],
        canRelogin: true,
    },
    SCOPE_MISSING: {
        title: 'Claude refused this login for the usage data',
        lines: [
            'The token authenticates but is not permitted to read usage, which a token refresh can cause.',
            'Run `claude auth login` for a token with current permissions - no need to log out first.',
        ],
        canRelogin: true,
    },
    TOKEN_EXPIRED: {
        title: 'Claude Code\'s login has expired',
        lines: [
            'Claudemeter never refreshes the token - doing so would log Claude Code out.',
            'Run Claude Code once, or `claude auth login`, to renew it.',
        ],
        canRelogin: true,
    },
    ENV_OVERRIDE: {
        title: 'Subscription usage unavailable',
        lines: ['The local Tk context gauge still works.'],
        canRelogin: false,
    },
};

const FALLBACK = AUTH_FAILURES.NO_TOKEN;

// These lines are rendered into a trusted MarkdownString, where a `command:`
// link executes on click. The values interpolated into them come from the
// environment (a config dir a cloned repo's devcontainer can set) and from
// network error text, so the link syntax is neutralised rather than trusted.
function esc(value) {
    return String(value).replace(/[[\]()`<>\\]/g, '\\$&');
}

// Resolve a reason into its description. Unknown reasons degrade to the
// not-logged-in wording rather than throwing.
//
// The three kinds of context are separate fields because they render
// differently; one shared field renders an HTTP cause as a directory.
//   override - the env var displacing the subscription login
//   lookedIn - the config dir searched, for the store-absence reasons
//   cause    - the underlying error, for the reasons a request produced
function describeAuthFailure(reason, context) {
    const spec = AUTH_FAILURES[reason] || FALLBACK;
    const { override, lookedIn, cause } = typeof context === 'string'
        ? { lookedIn: context }
        : (context || {});
    const lines = [...spec.lines];
    if (override) lines.unshift(`Claude Code is using ${esc(override)} instead of a subscription login.`);
    if (lookedIn) lines.push(`Looked in: ${esc(lookedIn)}`);
    if (cause) lines.push(`Reported by Claude: ${esc(cause)}`);
    return {
        reason: AUTH_FAILURES[reason] ? reason : 'NO_TOKEN',
        title: spec.title,
        lines,
        canRelogin: spec.canRelogin,
    };
}

// One-line form for the status-bar error and the debug log. The override is
// named here as well as in the tooltip, because this is the whole of what a
// toast shows and "subscription usage unavailable" alone does not say why.
function summariseAuthFailure(reason, context) {
    const { title, canRelogin } = describeAuthFailure(reason, context);
    if (canRelogin) return `${title}. Click to log in.`;
    const override = context && typeof context === 'object' ? context.override : null;
    return override ? `${title} - Claude Code is using ${override}.` : title;
}

// The reasons producers may emit. tokenSource raises the store ones and
// oauthFetcher the request ones; a name with no entry here degrades to the
// not-logged-in wording, which is the failure this module exists to end.
const AUTH_REASONS = Object.freeze(Object.keys(AUTH_FAILURES)
    .reduce((acc, name) => ({ ...acc, [name]: name }), {}));

// Whether a login launched from this window would reach the machine whose
// credential store the meter actually reads.
//
// Claudemeter declares `extensionKind: ui`, so its host is the CLIENT, and it
// resolves the CLI and reads the credential store there. VS Code's terminals
// follow the window's remote authority instead, so in a Remote-SSH, WSL or
// container window a login command lands on the REMOTE machine - a different
// host from the one being metered, and one where a client path is meaningless
// (#58).
function loginReachesMeteredMachine(remoteName) {
    return !remoteName;
}

// What to tell someone in a remote window, where claudemeter cannot start the
// login for them. `cliPath` is the client-side CLI the resolver found, quoted
// so it can be pasted as-is.
function describeRemoteLogin(remoteName, cliPath) {
    const where = REMOTE_LABELS[remoteName] || 'a remote window';
    const command = cliPath && /\s/.test(cliPath) ? `"${cliPath}"` : cliPath;
    return {
        title: 'Log in on your local machine',
        lines: [
            `This is ${where}, and Claudemeter reads Claude Code's login on the machine VS Code is running ON, not the one you are connected to.`,
            'A terminal here would run on the remote host, so it cannot complete this login.',
            command
                ? `Run this in a local terminal: ${command} auth login`
                : 'Run `claude auth login` in a local terminal.',
        ],
    };
}

// VS Code's remote authority names, for wording the message in the user's own
// terms. An unlisted authority still resolves to the generic phrasing.
const REMOTE_LABELS = {
    'ssh-remote': 'a Remote-SSH window',
    wsl: 'a WSL window',
    'dev-container': 'a Dev Container window',
    'attached-container': 'an attached container window',
    codespaces: 'a Codespaces window',
    tunnel: 'a Remote Tunnel window',
};

// Which failure a rejected request represents. A 403 on the usage endpoints is
// a scope the token lacks, which a token refresh can silently drop; a 401 is an
// invalid token, and an already-expired one is stale rather than wrong.
function classifyRejection(status, tokenExpired) {
    if (status === 403) return AUTH_REASONS.SCOPE_MISSING;
    return tokenExpired ? AUTH_REASONS.TOKEN_EXPIRED : AUTH_REASONS.TOKEN_REJECTED;
}

module.exports = {
    AUTH_FAILURES,
    AUTH_REASONS,
    describeAuthFailure,
    summariseAuthFailure,
    classifyRejection,
    loginReachesMeteredMachine,
    describeRemoteLogin,
};
