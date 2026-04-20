// Project:   Claudemeter
// File:      claudeLabelComposer.js
// Purpose:   Compose the leftmost "Claude" status-bar panel text,
//            color, and tooltip lines from platform-wide state
//            (service status + refresh spinner).
//            Pure — no vscode deps, fully unit-testable.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Output shape:
//   {
//     text:          "Claude $(pulse) $(loading)",
//     color:         'editorWarning.foreground' | 'errorForeground' | undefined,
//     tooltipLines:  ["$(pulse) Service degraded — API delays"]
//   }
//
// Status bar icons render AFTER the "Claude" text. Service status
// comes first; the refresh spinner is last. Color of the overall
// panel follows the service-status severity. Happy hour has its
// own dedicated status-bar panel (see renderHappyHourPanel in
// statusBar.js) and is not part of this composer.

const LABEL = 'Claude';

const SERVICE_RENDER = Object.freeze({
    minor: {
        icon:  '$(pulse)',
        color: 'editorWarning.foreground',
        label: 'Service degraded',
    },
    major: {
        icon:  '$(flame)',
        color: 'errorForeground',
        label: 'Partial outage',
    },
    critical: {
        icon:  '$(cloud-offline)',
        color: 'errorForeground',
        label: 'Major outage',
    },
    unknown: {
        icon:  '$(question)',
        color: undefined,
        label: 'Status unknown',
    },
});

function composeClaudeLabel(state = {}) {
    const {
        serviceStatus,
        isRefreshing = false,
    } = state;

    const icons = [];
    const tooltipLines = [];
    let color;

    // Service status — suppressed when 'none' (operational)
    if (serviceStatus && serviceStatus.indicator && serviceStatus.indicator !== 'none') {
        const render = SERVICE_RENDER[serviceStatus.indicator];
        if (render) {
            icons.push(render.icon);
            color = render.color;
            const desc = serviceStatus.description
                && serviceStatus.description !== render.label
                ? ` — ${serviceStatus.description}`
                : '';
            tooltipLines.push(`${render.icon} ${render.label}${desc}`);
        }
    }

    // Spinner last
    if (isRefreshing) {
        icons.push('$(loading)');
    }

    const text = icons.length === 0 ? LABEL : `${LABEL} ${icons.join(' ')}`;
    return { text, color, tooltipLines };
}

module.exports = {
    composeClaudeLabel,
    SERVICE_RENDER,
};
