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
//     text:            "Claude $(pulse) $(loading)",
//     color:           'charts.yellow' | 'claudemeter.outageRed' | undefined,
//     backgroundColor: 'statusBarItem.errorBackground' | undefined,
//     tooltipLines:    ["$(pulse) Service degraded — API delays"]
//   }
//
// Colour palette is shared across the extension:
//   yellow → 'charts.yellow'           (degraded, threshold warning)
//   red    → 'claudemeter.outageRed'   (partial/major outage, threshold error)
// claudemeter.outageRed is a custom theme colour declared in
// package.json so it can be tuned to match Claude's brand red and
// overridden by users via workbench.colorCustomizations.
//
// Status bar icons render AFTER the "Claude" text. Service status
// comes first; the refresh spinner is last. Severity escalates by
// icon, then by background — text colour stays red from major
// upward so both outage states read as urgent:
//
//   minor    (degraded)        $(pulse)   yellow, no background
//   major    (partial outage)  $(warning) red,    no background
//   critical (major outage)    $(error)   red,    RED BACKGROUND
//                              + "He's dead, Jim." in the tooltip.
//
// The icon progression is intentional: warning-triangle → error-circle
// reads instantly as "something wrong → everything wrong".
//
// Happy hour has its own dedicated status-bar panel (see
// renderHappyHourPanel in statusBar.js) and is not part of this
// composer.

const LABEL = 'Claude';

const SERVICE_RENDER = Object.freeze({
    minor: {
        icon:       '$(pulse)',
        color:      'charts.yellow',
        background: undefined,
        label:      'Service degraded',
    },
    major: {
        icon:       '$(warning)',
        color:      'claudemeter.outageRed',
        background: undefined,
        label:      'Partial outage',
    },
    critical: {
        icon:       '$(error)',
        color:      'claudemeter.outageRed',
        background: 'statusBarItem.errorBackground',
        label:      'Major outage',
        quote:      "He's dead, Jim.",
    },
    unknown: {
        icon:       '$(question)',
        color:      undefined,
        background: undefined,
        label:      'Status unknown',
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
    let backgroundColor;
    let quirkyOverride;

    // Service status — suppressed when 'none' (operational)
    if (serviceStatus && serviceStatus.indicator && serviceStatus.indicator !== 'none') {
        const render = SERVICE_RENDER[serviceStatus.indicator];
        if (render) {
            icons.push(render.icon);
            color = render.color;
            backgroundColor = render.background;
            const desc = serviceStatus.description
                && serviceStatus.description !== render.label
                ? ` — ${serviceStatus.description}`
                : '';
            tooltipLines.push(`${render.icon} ${render.label}${desc}`);
            // The thematic quote (e.g. "He's dead, Jim." for critical) is
            // surfaced separately so the tooltip composer can use it to
            // REPLACE the cute activity-quip rather than add a duplicate
            // line. Not pushed into tooltipLines here.
            if (render.quote) {
                quirkyOverride = render.quote;
            }
        }
    }

    // Spinner last
    if (isRefreshing) {
        icons.push('$(loading)');
    }

    const text = icons.length === 0 ? LABEL : `${LABEL} ${icons.join(' ')}`;
    return { text, color, backgroundColor, tooltipLines, quirkyOverride };
}

module.exports = {
    composeClaudeLabel,
    SERVICE_RENDER,
};
