// Project:   Claudemeter
// File:      apiSchema.js
// Purpose:   Claude.ai API field mappings (centralised for easy updates)
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

// Usage API: /api/organizations/{org}/usage
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

// Overage API: /api/organizations/{org}/overage_spend_limit
const OVERAGE_API_SCHEMA = {
    isEnabled: { path: 'is_enabled', type: 'boolean', default: false },
    monthlyLimit: { path: 'monthly_credit_limit', type: 'cents', default: 0 },
    usedCredits: { path: 'used_credits', type: 'cents', default: 0 },
    currency: { path: 'currency', type: 'string', default: 'USD' },
    outOfCredits: { path: 'out_of_credits', type: 'boolean', default: false },
};

// Prepaid Credits API: /api/organizations/{org}/prepaid/credits
const PREPAID_API_SCHEMA = {
    balance: { path: 'remaining_credits', type: 'cents', default: 0 },
    currency: { path: 'currency', type: 'string', default: 'USD' },
};

// URL patterns for request interception
const API_ENDPOINTS = {
    usage: {
        pattern: '/api/organizations/',
        contains: '/usage',
    },
    prepaidCredits: {
        pattern: '/api/organizations/',
        contains: '/prepaid/credits',
    },
    overageSpendLimit: {
        pattern: '/api/organizations/',
        contains: '/overage_spend_limit',
    },
};

// Traverse object by dot-notation path (e.g. "five_hour.utilization")
function getNestedValue(obj, path, defaultValue = null) {
    if (!obj || !path) return defaultValue;

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
        if (current === null || current === undefined) {
            return defaultValue;
        }
        current = current[part];
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

function matchesEndpoint(url, endpointConfig) {
    return url.includes(endpointConfig.pattern) && url.includes(endpointConfig.contains);
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

function getSchemaInfo() {
    return {
        usageFields: Object.keys(USAGE_API_SCHEMA),
        overageFields: Object.keys(OVERAGE_API_SCHEMA),
        endpoints: Object.keys(API_ENDPOINTS),
    };
}

module.exports = {
    USAGE_API_SCHEMA,
    OVERAGE_API_SCHEMA,
    PREPAID_API_SCHEMA,
    API_ENDPOINTS,
    getNestedValue,
    extractFromSchema,
    matchesEndpoint,
    processOverageData,
    processPrepaidData,
    getSchemaInfo,
};
