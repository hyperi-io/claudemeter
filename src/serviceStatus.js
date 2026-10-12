// Project:   Claudemeter
// File:      serviceStatus.js
// Purpose:   Fetch Claude service status from status.claude.com
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const https = require('https');

// summary.json rather than status.json: the page-wide indicator rolls up every
// component, so a Console or claude.ai incident would read as Claude Code down.
const STATUS_API_URL = 'https://status.claude.com/api/v2/summary.json';
const STATUS_PAGE_URL = 'https://status.claude.com';

// The components Claude Code depends on, in tie-break order. Matched by id
// first because a Statuspage id survives a rename, by name if the component
// is ever recreated.
const WATCHED_COMPONENTS = [
    { id: 'yyzkbfz2thpt', name: 'Claude Code', label: 'Claude Code' },
    { id: 'k8w3r06qmzrp', name: 'Claude API (api.anthropic.com)', label: 'Claude API' }
];

// Worst wins when the watched components disagree.
const INDICATOR_SEVERITY = { none: 0, unknown: 1, minor: 2, major: 3, critical: 4 };

// Statuspage component status -> the page-level indicator the renderers use.
const COMPONENT_INDICATOR = {
    operational: 'none',
    degraded_performance: 'minor',
    under_maintenance: 'minor',
    partial_outage: 'major',
    major_outage: 'critical'
};

// Status indicators from Atlassian Statuspage
// none = operational, minor = degraded, major = partial outage, critical = major outage
//
// Icons chosen to be visually distinct per level. Kept in sync with
// claudeLabelComposer.SERVICE_RENDER which is the actual render path.
//   - minor:    $(warning) caution triangle - service degraded
//   - major:    $(error)   red X - partial outage, real impact
//   - critical: $(error) + red background - Claude is dead, total outage
const STATUS_INDICATORS = {
    none: {
        icon: '$(check)',
        label: 'Operational',
        color: undefined,  // default/green
        level: 'operational'
    },
    minor: {
        icon: '$(warning)',
        label: 'Degraded',
        color: 'charts.yellow',
        level: 'degraded'
    },
    major: {
        icon: '$(error)',
        label: 'Partial Outage',
        color: 'claudemeter.outageRed',
        level: 'outage'
    },
    critical: {
        icon: '$(error)',
        label: 'Major Outage',
        color: 'claudemeter.outageRed',
        level: 'critical'
    },
    unknown: {
        icon: '$(question)',
        label: 'Unknown',
        color: undefined,
        level: 'unknown'
    }
};

let cachedStatus = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60000; // Cache for 1 minute

// UI-observable state (previously lived in statusBar.js):
//   - currentStatus: last successful fetch result, consumed by renderers
//   - currentError:  set when a refresh fails; cleared on next success
// These are separate from `cachedStatus` above (which is the 60s API-
// result cache used inside fetchServiceStatus). Two caches, two jobs:
// the API cache limits outbound calls; the UI cache holds the last-
// good result for rendering between refresh ticks.
let currentStatus = null;
let currentError = null;

function humaniseComponentStatus(status) {
    const words = String(status).split('_');
    const sentence = words.join(' ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function findComponent(components, watched) {
    return components.find(c => c?.id === watched.id)
        || components.find(c => c?.name === watched.name);
}

/**
 * Reduce a Statuspage summary.json payload to the worst status across the
 * watched components (Claude Code and the API it calls). The description
 * names that component, then the open incident naming it, else its status
 * in words.
 * @param {object} summary - Parsed summary.json
 * @returns {{indicator: string, description: string, updatedAt: string|null, pageUrl: string}}
 */
function parseServiceStatus(summary) {
    const components = Array.isArray(summary?.components) ? summary.components : [];
    const incidents = Array.isArray(summary?.incidents) ? summary.incidents : [];

    let worst = null;
    for (const watched of WATCHED_COMPONENTS) {
        const component = findComponent(components, watched);
        if (!component) continue;
        const indicator = COMPONENT_INDICATOR[component.status] || 'unknown';
        if (!worst || INDICATOR_SEVERITY[indicator] > INDICATOR_SEVERITY[worst.indicator]) {
            worst = { watched, component, indicator };
        }
    }

    if (!worst) {
        return {
            indicator: 'unknown',
            description: 'Claude Code status not reported',
            updatedAt: summary?.page?.updated_at || null,
            pageUrl: STATUS_PAGE_URL
        };
    }

    const { watched, component, indicator } = worst;
    const incident = incidents.find(i =>
        Array.isArray(i?.components) && i.components.some(c => c?.id === component.id));
    const detail = incident?.name || humaniseComponentStatus(component.status || 'unknown');

    return {
        indicator,
        description: `${watched.label}: ${detail}`,
        updatedAt: component.updated_at || summary?.page?.updated_at || null,
        pageUrl: STATUS_PAGE_URL
    };
}

/**
 * Fetch the watched component status from status.claude.com
 * @returns {Promise<{indicator: string, description: string, updatedAt: string}>}
 */
async function fetchServiceStatus() {
    // Return cached result if still fresh
    const now = Date.now();
    if (cachedStatus && (now - lastFetchTime) < CACHE_TTL_MS) {
        return cachedStatus;
    }

    return new Promise((resolve, reject) => {
        const request = https.get(STATUS_API_URL, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Claudemeter-VSCode/1.0'
            }
        }, (response) => {
            let data = '';

            response.on('data', (chunk) => {
                data += chunk;
            });

            response.on('end', () => {
                try {
                    if (response.statusCode !== 200) {
                        throw new Error(`HTTP ${response.statusCode}`);
                    }

                    const result = parseServiceStatus(JSON.parse(data));

                    // Update cache
                    cachedStatus = result;
                    lastFetchTime = now;

                    resolve(result);
                } catch (parseError) {
                    reject(new Error(`Failed to parse status response: ${parseError.message}`));
                }
            });
        });

        request.on('error', (error) => {
            reject(new Error(`Failed to fetch service status: ${error.message}`));
        });

        request.on('timeout', () => {
            request.destroy();
            reject(new Error('Service status request timed out'));
        });
    });
}

/**
 * Get display info for a status indicator
 * @param {string} indicator - Status indicator from API (none, minor, major, critical)
 * @returns {{icon: string, label: string, color: string|undefined, level: string}}
 */
function getStatusDisplay(indicator) {
    return STATUS_INDICATORS[indicator] || STATUS_INDICATORS.unknown;
}

/**
 * Format the updated_at timestamp for display
 * @param {string} isoTimestamp - ISO 8601 timestamp
 * @returns {string} Formatted time string
 */
function formatStatusTime(isoTimestamp) {
    if (!isoTimestamp) return 'Unknown';

    try {
        const date = new Date(isoTimestamp);
        return date.toLocaleString();
    } catch (e) {
        return 'Unknown';
    }
}

/**
 * Clear the cached status (useful for forcing a refresh)
 */
function clearStatusCache() {
    cachedStatus = null;
    lastFetchTime = 0;
}

/**
 * Refresh the service-status UI state. Wraps fetchServiceStatus with
 * state persistence: on success, stores into `currentStatus` and clears
 * `currentError`; on failure, stores into `currentError` and nulls out
 * the status so the caller knows the data is stale.
 *
 * Callers should re-render after this resolves (state is now updated).
 *
 * @returns {Promise<{indicator: string, description: string, updatedAt: string}|null>}
 */
async function refreshStatus() {
    // Dev simulation override - when active, the real API is not called
    // and the injected status is preserved across refresh ticks.
    if (simulatedIndicator) {
        return currentStatus;
    }
    try {
        currentStatus = await fetchServiceStatus();
        currentError = null;
        return currentStatus;
    } catch (error) {
        currentError = error;
        currentStatus = null;
        return null;
    }
}

// Dev override - set by the "Simulate Service Status" command. While
// non-null, refreshStatus() short-circuits and keeps the injected
// status in place. Set to null to resume real fetches.
let simulatedIndicator = null;

function setSimulatedStatus(indicator) {
    if (!indicator || indicator === 'clear' || indicator === 'none') {
        simulatedIndicator = null;
        // Returning to live mode - null out so the next refresh repopulates
        // from the real API rather than leaving a stale simulated status.
        currentStatus = null;
        currentError = null;
        return;
    }
    if (!STATUS_INDICATORS[indicator]) {
        return;
    }
    simulatedIndicator = indicator;
    currentStatus = {
        indicator,
        description: `Simulated ${STATUS_INDICATORS[indicator].label}`,
        updatedAt: new Date().toISOString(),
        pageUrl: STATUS_PAGE_URL
    };
    currentError = null;
}

function getSimulatedStatus() {
    return simulatedIndicator;
}

/**
 * Return the cached UI-observable status (from the last successful
 * refresh). Returns null if we've never fetched or the last refresh
 * failed.
 */
function getCurrentStatus() {
    return currentStatus;
}

/**
 * Return the error from the last refresh, if any. Cleared on next
 * successful refresh.
 */
function getCurrentError() {
    return currentError;
}

/**
 * Reset the UI-observable state. Used by tests; not called in prod.
 */
function resetState() {
    currentStatus = null;
    currentError = null;
}

module.exports = {
    fetchServiceStatus,
    parseServiceStatus,
    getStatusDisplay,
    formatStatusTime,
    clearStatusCache,
    refreshStatus,
    getCurrentStatus,
    getCurrentError,
    resetState,
    setSimulatedStatus,
    getSimulatedStatus,
    STATUS_PAGE_URL,
    STATUS_INDICATORS
};
