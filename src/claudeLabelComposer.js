// Project:   Claudemeter
// File:      claudeLabelComposer.js
// Purpose:   Compose the leftmost "Claude" status-bar panel text,
//            color, and tooltip lines from platform-wide state
//            (service status + happy hour + refresh spinner).
//            Pure — no vscode deps, fully unit-testable.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Output shape:
//   {
//     text:          "Claude $(pulse) 🍺 $(loading)",
//     color:         'editorWarning.foreground' | 'errorForeground' | undefined,
//     tooltipLines:  ["$(pulse) Service degraded — API delays",
//                     "🍺 Happy hour — off-peak, ends 12:00 local"]
//   }
//
// Status bar icons render AFTER the "Claude" text, ordered
// severity-descending. Happy hour trails the service icon;
// spinner is last. Color of the overall panel follows the
// most-severe active condition.

const LABEL = 'Claude';

const HAPPY_HOUR_ICONS = Object.freeze({
    beer:      '🍺',
    cocktail:  '🍹',
    wine:      '🍷',
    champagne: '🥂',
    martini:   '🍸',
    coffee:    '☕',
    moon:      '🌙',
    sparkles:  '✨',
    palm:      '🌴',
    party:     '🎉',
});

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

function formatEndsAt(date) {
    if (!(date instanceof Date)) return '';
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function composeClaudeLabel(state = {}) {
    const {
        serviceStatus,
        happyHourActive = false,
        happyHourIcon,
        happyHourEndsAt,
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

    // Happy hour
    if (happyHourActive && typeof happyHourIcon === 'string' && happyHourIcon.length > 0) {
        icons.push(happyHourIcon);
        const endsLine = happyHourEndsAt instanceof Date
            ? ` — off-peak, ends ${formatEndsAt(happyHourEndsAt)} local`
            : ' — off-peak';
        tooltipLines.push(`${happyHourIcon} Happy hour${endsLine}`);
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
    HAPPY_HOUR_ICONS,
    SERVICE_RENDER,
};
