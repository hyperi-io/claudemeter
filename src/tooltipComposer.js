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
//     usageData,                   // from oauthFetcher
//     sessionData,                 // from sessionTracker
//     credentialsInfo,             // from credentialsReader
//     activityStats,               // from activityMonitor
//     platformTooltipLines,        // from claudeLabelComposer (service status)
//     activityQuipOverride,        // optional override for activity status line
//     happyHourState,              // { active, icon, endsAt } from happyHour resolver
//     extensionVersion,            // from vscode.extensions.getExtension(...)
//     repositoryUrl,               // manifest repo URL, footer version links to it
//     marketplaceUrl,              // marketplace review deep-link, footer "rate it"
//     brandIconDataUri,            // tiny HyperI hound data URI, footer brand link
//     claudeCodeSelectedModel,     // from workspace config
//     tokensInfo,                  // { current, limit, knownLimit, recommendation }
//     config: {                    // pre-resolved config values
//       tokenLimitOverride,
//       use24HourTime,
//       weeklyPrecisionThreshold,
//     }
//   }) -> string (markdown body, sections joined with "  \n")

const {
    calculateResetClockTimeExpanded,
    getCurrencySymbol,
    formatCompact,
} = require('./utils');
const { formatSubscriptionType, formatRateLimitTier } = require('./credentialsReader');
const { parseModelAlias, STANDARD_LIMIT } = require('./modelContextWindows');

// The activity quip is free-text and can be long. A VS Code markdown tooltip
// has no width control - its widest line sets the whole tooltip's width - so an
// unwrapped quip stretches the tooltip. Hard-wrap it to roughly the width of
// the normal text lines (e.g. "Resets Wednesday 8 July at 12:52 pm"). Just a
// quip, so an approximate character column is fine.
const QUIP_WRAP_COLUMN = 42;

// Greedy word-wrap to at most `width` chars per line, breaking only on spaces
// (a single word longer than width stays whole rather than chopped). Returns
// an array of lines.
function wrapText(text, width) {
    const lines = [];
    let line = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        if (!line) line = word;
        else if (line.length + 1 + word.length <= width) line += ' ' + word;
        else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines;
}

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
    // Current context (the per-workspace Tk gauge) leads - it's the number a
    // coder acts on most - then the account-global Session and Weekly. Each
    // block self-separates with a leading blank, so order is free to change.
    add(renderCurrentContextBlock);
    add(renderSessionBlock);
    add(renderWeeklyBlock);
    add(renderCreditsBlock);
    add(renderHappyHourRow);
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

function renderSessionBlock(state) {
    const { usageData, config } = state;
    if (!usageData) return [];

    const lines = [''];  // leading blank line for visual separation
    const sessionPercent = usageData.usagePercent;
    const resetTimeExpanded = calculateResetClockTimeExpanded(usageData.resetTime);
    lines.push(`**Session - ${sessionPercent}%**`);
    lines.push(`Resets ${resetTimeExpanded}`);
    if (config?.tokenLimitOverride > 0) {
        lines.push(`⚙ Context window override ${formatCompact(config.tokenLimitOverride)}`);
    }

    return lines;
}

function renderCurrentContextBlock(state) {
    const { sessionData, tokensInfo } = state;
    if (!sessionData || !sessionData.tokenUsage) return [];

    const tokenPercent = Math.round(
        (sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100
    );

    const lines = [
        '',  // blank line for visual separation
        `**Current context - ${tokenPercent}%**`,
        `Tokens ${formatCompact(sessionData.tokenUsage.current)} / `
        + `${formatCompact(sessionData.tokenUsage.limit)}`,
    ];

    if (tokensInfo?.recommendation) {
        // Recommendations are pre-split into short segments separated
        // by markdown line breaks. Emit each segment as its own
        // italic line so the tooltip width is bounded by the longest
        // single line, not the longest sentence. Italic span across a
        // <br>-converted markdown line break doesn't render reliably,
        // hence the per-segment push.
        for (const segment of tokensInfo.recommendation.split('  \n')) {
            lines.push(`_${segment}_`);
        }
    }

    return lines;
}

function renderWeeklyBlock(state) {
    const { usageData } = state;
    if (!usageData || usageData.usagePercentWeek === undefined) return [];

    const weeklyPercent = usageData.usagePercentWeek;
    const weeklyResetTimeExpanded = calculateResetClockTimeExpanded(usageData.resetTimeWeek);
    const lines = ['', `**Weekly - ${weeklyPercent}%**`];

    if (usageData.usagePercentSonnet !== null && usageData.usagePercentSonnet !== undefined) {
        lines.push(`Sonnet ${usageData.usagePercentSonnet}%`);
    }
    if (usageData.usagePercentOpus !== null && usageData.usagePercentOpus !== undefined) {
        lines.push(`Opus ${usageData.usagePercentOpus}%`);
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
            `Used ${usedFormatted} / ${limitFormatted} ${credits.currency} (${credits.percent}%)`];

        if (usageData.prepaidCredits) {
            const prepaid = usageData.prepaidCredits;
            const prepaidSymbol = getCurrencySymbol(prepaid.currency);
            lines.push(
                `Balance ${prepaidSymbol}${prepaid.balance.toLocaleString()} ${prepaid.currency}`
            );
        }
        return lines;
    }

    if (usageData.prepaidCredits) {
        const prepaid = usageData.prepaidCredits;
        const prepaidSymbol = getCurrencySymbol(prepaid.currency);
        return ['', '**Credits**',
            `Balance ${prepaidSymbol}${prepaid.balance.toLocaleString()} ${prepaid.currency}`];
    }

    return [];
}

function renderHappyHourRow(state) {
    const { happyHourState, config } = state;
    if (!happyHourState?.active) return [];
    const icon = happyHourState.icon || '';
    const endsLine = happyHourState.endsAt instanceof Date
        ? ` — off-peak, ends ${formatHappyHourEndsAt(happyHourState.endsAt, !!config?.use24HourTime)}`
        : ' — off-peak';
    return ['', `${icon} Happy hour${endsLine}`];
}

function formatHappyHourEndsAt(date, use24Hour) {
    return date.toLocaleString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: 'numeric',
        minute: '2-digit',
        hour12: !use24Hour,
    });
}

function renderActivityQuip(state) {
    const { activityStats, activityQuipOverride } = state;
    // When the platform is in a special state (e.g. critical outage),
    // the caller can supply a thematic line that REPLACES the cute
    // activity quip - so "He's dead, Jim." displaces the usual
    // chuckle rather than appearing alongside it.
    const quip = activityQuipOverride
        || (activityStats && activityStats.description && activityStats.description.quirky);
    if (!quip) return [];
    // Wrap to a fixed column so a long quip can't stretch the tooltip width.
    // composeTooltip joins array elements with a markdown hard break, so each
    // emphasised line renders on its own line.
    return ['', ...wrapText(quip, QUIP_WRAP_COLUMN).map((line) => `*${line}*`)];
}

function renderPlatformBlock(state) {
    // platformTooltipLines comes from claudeLabelComposer.composeClaudeLabel()
    // e.g. ["$(warning) Service degraded - API delays",
    //       "[View status page](...)"]
    const { platformTooltipLines } = state;
    if (!Array.isArray(platformTooltipLines) || platformTooltipLines.length === 0) {
        return [];
    }
    return ['', ...platformTooltipLines];
}

// HyperI brand link on the footer version line. Hardcoded for now (the
// manifest carries no company URL); revisit if a homepage field is added.
const HYPERI_URL = 'https://hyperi.io';

function renderFooter(state) {
    const { usageData, extensionVersion, repositoryUrl, marketplaceUrl, brandIconDataUri, config } = state;
    const lines = [''];
    if (usageData?.timestamp) {
        const ts = usageData.timestamp instanceof Date ? usageData.timestamp : new Date(usageData.timestamp);
        lines.push(`Updated ${ts.toLocaleTimeString(undefined, { hour12: !config?.use24HourTime })}`);
    }
    if (extensionVersion) {
        // Gentle support nudge above the version line. Each link appears only
        // when its URL is known. The star glyph is functional UI output.
        const nudges = [];
        if (repositoryUrl) nudges.push(`[star](${repositoryUrl})`);
        if (marketplaceUrl) nudges.push(`[rate](${marketplaceUrl})`);
        if (nudges.length) lines.push(`Is this useful for you? ⭐ Please ${nudges.join(' or ')} it`);

        const label = `Claudemeter v${extensionVersion}`;
        // Version text links to the source repo when we have a URL; plain
        // text otherwise.
        const version = repositoryUrl ? `[${label}](${repositoryUrl})` : label;
        // Tiny HyperI hound ahead of the version, linking to hyperi.io. The
        // clickable image is a data URI (works identically on every platform);
        // omitted if the asset couldn't be embedded.
        const brand = brandIconDataUri ? `[![HyperI](${brandIconDataUri})](${HYPERI_URL}) ` : '';
        lines.push(`${brand}${version}`);
    }
    return lines;
}

module.exports = {
    composeTooltip,
};
