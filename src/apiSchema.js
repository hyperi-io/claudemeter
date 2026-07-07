// Project:   Claudemeter
// File:      apiSchema.js
// Purpose:   Usage-payload field mappings (centralised for easy updates)
// Language:  JavaScript (CommonJS)
//
// Field paths for the api.anthropic.com/api/oauth/usage payload (the same
// field names the old claude.ai usage endpoint used, which is why the switch
// to the OAuth source needed no schema change). Consumed by processApiResponse.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Usage payload: five_hour / seven_day / seven_day_{opus,sonnet} / extra_usage
const USAGE_API_SCHEMA = {
    fiveHour: {
        utilization: { path: 'five_hour.utilization', type: 'percent', default: 0 },
        resetsAt: { path: 'five_hour.resets_at', type: 'time', default: null },
    },
    sevenDay: {
        utilization: { path: 'seven_day.utilization', type: 'percent', default: 0 },
        resetsAt: { path: 'seven_day.resets_at', type: 'time', default: null },
    },
    sevenDaySonnet: {
        utilization: { path: 'seven_day_sonnet.utilization', type: 'percent', default: null },
        resetsAt: { path: 'seven_day_sonnet.resets_at', type: 'time', default: null },
    },
    sevenDayOpus: {
        utilization: { path: 'seven_day_opus.utilization', type: 'percent', default: null },
        resetsAt: { path: 'seven_day_opus.resets_at', type: 'time', default: null },
    },
    extraUsage: {
        value: { path: 'extra_usage', type: 'raw', default: null },
    },
};

// Overage/extra-usage mapping. oauthFetcher.deriveCreditsArgs adapts the
// usage payload's `extra_usage` block into this shape for processOverageData.
const OVERAGE_API_SCHEMA = {
    isEnabled: { path: 'is_enabled', type: 'boolean', default: false },
    monthlyLimit: { path: 'monthly_credit_limit', type: 'cents', default: 0 },
    usedCredits: { path: 'used_credits', type: 'cents', default: 0 },
    currency: { path: 'currency', type: 'string', default: 'USD' },
    outOfCredits: { path: 'out_of_credits', type: 'boolean', default: false },
};

// Keys that traverse into the prototype chain. Even though schema
// paths in this project are hardcoded and not user-derived, guarding
// here makes this helper safe to reuse.
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Traverse object by dot-notation path (e.g. "five_hour.utilization")
function getNestedValue(obj, path, defaultValue = null) {
    if (!obj || !path) return defaultValue;

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return defaultValue;
        }
        if (PROTO_KEYS.has(part)) {
            return defaultValue;
        }
        current = current[part]; // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- guarded above; write is to local `current`, not mutating obj.
    }

    return current ?? defaultValue;
}

function extractFromSchema(response, schema) {
    const result = {};

    for (const [groupName, fields] of Object.entries(schema)) {
        if (typeof fields === 'object' && fields.path) {
            result[groupName] = getNestedValue(response, fields.path, fields.default);
        } else {
            result[groupName] = {};
            for (const [fieldName, config] of Object.entries(fields)) {
                result[groupName][fieldName] = getNestedValue(response, config.path, config.default);
            }
        }
    }

    return result;
}

// Convert cents to dollars and calculate percentage
function processOverageData(overageData) {
    if (!overageData) return null;

    const extracted = extractFromSchema(overageData, OVERAGE_API_SCHEMA);

    if (!extracted.isEnabled) return null;

    const usedDollars = extracted.usedCredits / 100;
    const limitDollars = extracted.monthlyLimit / 100;

    return {
        limit: limitDollars,
        used: usedDollars,
        currency: extracted.currency,
        percent: limitDollars > 0 ? Math.round((usedDollars / limitDollars) * 100) : 0,
        outOfCredits: extracted.outOfCredits,
    };
}

// API field names vary - try common alternatives
function processPrepaidData(creditsData) {
    if (!creditsData) return null;

    const balanceCents = creditsData.remaining_credits
        ?? creditsData.balance
        ?? creditsData.credit_balance
        ?? creditsData.available_credits
        ?? 0;

    if (balanceCents === 0) return null;

    const balanceDollars = balanceCents / 100;
    const currency = creditsData.currency ?? 'USD';

    return {
        balance: balanceDollars,
        currency: currency,
    };
}

// Convert ISO timestamp to relative time string (e.g. "2h 30m", "5d 21h")
function calculateResetTime(isoTimestamp) {
    if (!isoTimestamp) return 'Unknown';

    try {
        const resetDate = new Date(isoTimestamp);
        const now = new Date();
        const diffMs = resetDate - now;

        if (diffMs <= 0) return 'Soon';

        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 24) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            return `${days}d ${remainingHours}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    } catch (error) {
        console.error('Error calculating reset time:', error);
        return 'Unknown';
    }
}

// Build standardised usage response from raw API data
function processApiResponse(apiResponse, creditsData, overageData, accountInfo) {
    const data = extractFromSchema(apiResponse, USAGE_API_SCHEMA);
    const monthlyCredits = processOverageData(overageData);
    const prepaidCredits = processPrepaidData(creditsData);

    return {
        usagePercent: data.fiveHour.utilization,
        resetTime: calculateResetTime(data.fiveHour.resetsAt),
        usagePercentWeek: data.sevenDay.utilization,
        resetTimeWeek: calculateResetTime(data.sevenDay.resetsAt),
        usagePercentSonnet: data.sevenDaySonnet.utilization,
        resetTimeSonnet: calculateResetTime(data.sevenDaySonnet.resetsAt),
        usagePercentOpus: data.sevenDayOpus.utilization,
        resetTimeOpus: calculateResetTime(data.sevenDayOpus.resetsAt),
        extraUsage: data.extraUsage.value,
        prepaidCredits: prepaidCredits,
        monthlyCredits: monthlyCredits,
        accountInfo: accountInfo,
        timestamp: new Date(),
        rawData: apiResponse,
        schemaVersion: getSchemaInfo().version,
    };
}

function getSchemaInfo() {
    return {
        version: '2.0',
        usageFields: Object.keys(USAGE_API_SCHEMA),
        overageFields: Object.keys(OVERAGE_API_SCHEMA),
    };
}

module.exports = {
    USAGE_API_SCHEMA,
    OVERAGE_API_SCHEMA,
    getNestedValue,
    extractFromSchema,
    processOverageData,
    processPrepaidData,
    calculateResetTime,
    processApiResponse,
    getSchemaInfo,
};
