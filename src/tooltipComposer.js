// Project:   Claudemeter
// File:      tooltipComposer.js
// Purpose:   Compose the full tooltip markdown body from state.
//            Extracted from statusBar.js as a pure module so sections
//            can be unit-tested in isolation. Each section is wrapped
//            in try/catch so a broken section drops out rather than
//            wiping the whole tooltip.
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Caller shape:
//   composeTooltip({
//     usageData,                   // from httpFetcher
//     sessionData,                 // from sessionTracker
//     credentialsInfo,             // from credentialsReader
//     activityStats,               // from activityMonitor
//     platformTooltipLines,        // from claudeLabelComposer (service + happy hour)
//     rateLimitState,              // from rateLimitDetector (phase: wiring)
//     extensionVersion,            // from vscode.extensions.getExtension(...)
//     config: {                    // pre-resolved config values
//       tokenLimitOverride,
//       use24HourTime,
//       weeklyPrecisionThreshold,
//     }
//   }) → string (markdown body, sections joined with "  \n")

const {
    calculateResetClockTime,
    calculateResetClockTimeExpanded,
    getCurrencySymbol,
    formatCompact,
} = require('./utils');
const { formatSubscriptionType, formatRateLimitTier } = require('./credentialsReader');
const { parseModelAlias, STANDARD_LIMIT } = require('./modelContextWindows');

function composeTooltip(state) {
    const lines = [];
    const add = (fn) => {
        try {
            const out = fn(state);
            if (Array.isArray(out) && out.length > 0) lines.push(...out);
        } catch (_err) {
            // per design: broken section drops out; others still render
        }
    };

    add(renderAccountIdentity);
    add(renderPlanAndContext);
    add(renderSpacerAfterIdentity);
    add(renderSessionBlock);
    add(renderWeeklyBlock);
    add(renderCreditsBlock);
    add(renderActivityQuip);
    add(renderPlatformBlock);
    add(renderFooter);

    return lines.join('  \n');
}

// --- sections ---

function renderAccountIdentity(state) {
    const { usageData } = state;
    const rawAccountName = usageData?.accountInfo?.name;
    const accountEmail = usageData?.accountInfo?.email;
    const accountName = typeof rawAccountName === 'string'
        ? rawAccountName.replace(/'s Organi[sz]ation$/, '')
        : null;

    if (accountName && accountEmail) {
        const safe = accountName.replace(/([*_`~[\]\\])/g, '\\$1');
        return [`**${safe}** (${accountEmail})`];
    }
    if (accountName) {
        const safe = accountName.replace(/([*_`~[\]\\])/g, '\\$1');
        return [`**${safe}**`];
    }
    if (accountEmail) {
        return [accountEmail];
    }
    return [];
}

function renderPlanAndContext(state) {
    const { usageData, sessionData, credentialsInfo } = state;
    const lines = [];

    if (credentialsInfo) {
        const plan = formatSubscriptionType(credentialsInfo.subscriptionType);
        const tier = formatRateLimitTier(credentialsInfo.rateLimitTier);
        const orgType = usageData?.accountInfo?.orgType;
        const orgName = usageData?.accountInfo?.orgName;

        let planLabel = plan;
        if (plan && orgType) {
            planLabel = `${plan} (${orgType})`;
        } else if (plan && orgName && !/'s Organi[sz]ation$/.test(orgName)) {
            planLabel = `${plan} (${orgName})`;
        } else if (plan) {
            planLabel = `${plan} (Personal)`;
        }

        if (planLabel && tier && tier !== plan) {
            lines.push(`${planLabel} · ${tier}`);
        } else if (planLabel) {
            lines.push(planLabel);
        }
    }

    if (sessionData && sessionData.tokenUsage) {
        const limit = sessionData.tokenUsage.limit;
        const isExtended = limit > STANDARD_LIMIT;
        const confidence = sessionData.tokenUsage.limitConfidence || null;
        let suffix = '';
        if (isExtended && confidence === 'authoritative') {
            suffix = ' (extended)';
        } else if (confidence === 'inferred') {
            suffix = ' (inferred)';
        } else if (confidence === 'configured') {
            suffix = ' (configured)';
        } else if (isExtended) {
            suffix = ' (extended)';
        }
        lines.push(`Context: ${formatCompact(limit)}${suffix}`);
    } else if (credentialsInfo) {
        // Fall back to claudeCode.selectedModel alias parsing when we
        // don't yet have session token data. Kept for parity with the
        // pre-extraction inline logic.
        const model = state.claudeCodeSelectedModel || '';
        const aliasLimit = parseModelAlias(model);
        const fallbackLimit = aliasLimit || STANDARD_LIMIT;
        const isExtended = fallbackLimit > STANDARD_LIMIT;
        lines.push(`Context: ${formatCompact(fallbackLimit)}${isExtended ? ' (extended)' : ''}`);
    }

    return lines;
}

function renderSpacerAfterIdentity(state) {
    // Blank line if we rendered any identity content.
    const hasIdentity = !!(state.usageData?.accountInfo?.name
        || state.usageData?.accountInfo?.email
        || state.credentialsInfo);
    return hasIdentity ? [''] : [];
}

function renderSessionBlock(state) {
    const { usageData, sessionData, config } = state;
    const lines = [];

    let tokenPercent = null;
    if (sessionData && sessionData.tokenUsage) {
        tokenPercent = Math.round(
            (sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100
        );
    }

    if (usageData) {
        const sessionPercent = usageData.usagePercent;
        const resetTimeExpanded = calculateResetClockTimeExpanded(usageData.resetTime);
        lines.push(`**Session ${sessionPercent}%**`);
        if (tokenPercent !== null) {
            lines.push(
                `Tokens: ${formatCompact(sessionData.tokenUsage.current)} / `
                + `${formatCompact(sessionData.tokenUsage.limit)} (${tokenPercent}%)`
            );
        }
        lines.push(`Resets ${resetTimeExpanded}`);
        if (config?.tokenLimitOverride > 0) {
            lines.push(`⚙ Context window override: ${formatCompact(config.tokenLimitOverride)}`);
        }
    } else if (tokenPercent !== null) {
        lines.push('**Session**');
        lines.push(
            `Tokens: ${formatCompact(sessionData.tokenUsage.current)} / `
            + `${formatCompact(sessionData.tokenUsage.limit)} (${tokenPercent}%)`
        );
        if (config?.tokenLimitOverride > 0) {
            lines.push(`⚙ Context window override: ${formatCompact(config.tokenLimitOverride)}`);
        }
    }

    return lines;
}

function renderWeeklyBlock(state) {
    const { usageData } = state;
    if (!usageData || usageData.usagePercentWeek === undefined) return [];

    const weeklyPercent = usageData.usagePercentWeek;
    const weeklyResetTimeExpanded = calculateResetClockTimeExpanded(usageData.resetTimeWeek);
    const lines = ['', `**Weekly ${weeklyPercent}%**`];

    if (usageData.usagePercentSonnet !== null && usageData.usagePercentSonnet !== undefined) {
        lines.push(`Sonnet: ${usageData.usagePercentSonnet}%`);
    }
    if (usageData.usagePercentOpus !== null && usageData.usagePercentOpus !== undefined) {
        lines.push(`Opus: ${usageData.usagePercentOpus}%`);
    }

    lines.push(`Resets ${weeklyResetTimeExpanded}`);
    return lines;
}

function renderCreditsBlock(state) {
    const { usageData } = state;
    if (!usageData) return [];

    if (usageData.monthlyCredits) {
        const credits = usageData.monthlyCredits;
        const currencySymbol = getCurrencySymbol(credits.currency);
        const usedFormatted = `${currencySymbol}${credits.used.toLocaleString()}`;
        const limitFormatted = `${currencySymbol}${credits.limit.toLocaleString()}`;
        const lines = ['', '**Extra Usage**',
            `Used: ${usedFormatted} / ${limitFormatted} ${credits.currency} (${credits.percent}%)`];

        if (usageData.prepaidCredits) {
            const prepaid = usageData.prepaidCredits;
            const prepaidSymbol = getCurrencySymbol(prepaid.currency);
            lines.push(
                `Balance: ${prepaidSymbol}${prepaid.balance.toLocaleString()} ${prepaid.currency}`
            );
        }
        return lines;
    }

    if (usageData.prepaidCredits) {
        const prepaid = usageData.prepaidCredits;
        const prepaidSymbol = getCurrencySymbol(prepaid.currency);
        return ['', '**Credits**',
            `Balance: ${prepaidSymbol}${prepaid.balance.toLocaleString()} ${prepaid.currency}`];
    }

    return [];
}

function renderActivityQuip(state) {
    const { activityStats } = state;
    if (!activityStats || !activityStats.description) return [];
    return ['', `*${activityStats.description.quirky}*`];
}

function renderPlatformBlock(state) {
    // platformTooltipLines comes from claudeLabelComposer.composeClaudeLabel()
    // e.g. ["$(pulse) Service degraded — API delays",
    //       "🍺 Happy hour — off-peak, ends 05:00 local"]
    const { platformTooltipLines } = state;
    if (!Array.isArray(platformTooltipLines) || platformTooltipLines.length === 0) {
        return [];
    }
    return ['', ...platformTooltipLines];
}

function renderFooter(state) {
    const { usageData, extensionVersion, config } = state;
    const lines = [''];
    if (usageData?.timestamp) {
        const ts = usageData.timestamp instanceof Date ? usageData.timestamp : new Date(usageData.timestamp);
        lines.push(`Updated: ${ts.toLocaleTimeString(undefined, { hour12: !config?.use24HourTime })}`);
    }
    if (extensionVersion) {
        lines.push(`Claudemeter v${extensionVersion}`);
    }
    lines.push('[Click to resync account](command:claudemeter.resyncAccount)');
    return lines;
}

module.exports = {
    composeTooltip,
};
