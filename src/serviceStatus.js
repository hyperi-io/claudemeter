// Project:   Claudemeter
// File:      serviceStatus.js
// Purpose:   Fetch Claude service status from status.claude.com
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

const https = require('https');

const STATUS_API_URL = 'https://status.claude.com/api/v2/status.json';
const STATUS_PAGE_URL = 'https://status.claude.com';

// Status indicators from Atlassian Statuspage
// none = operational, minor = degraded, major = partial outage, critical = major outage
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
        color: 'editorWarning.foreground',
        level: 'degraded'
    },
    major: {
        icon: '$(error)',
        label: 'Partial Outage',
        color: 'errorForeground',
        level: 'outage'
    },
    critical: {
        icon: '$(error)',
        label: 'Major Outage',
        color: 'errorForeground',
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

/**
 * Fetch service status from status.claude.com API
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

                    const json = JSON.parse(data);
                    const result = {
                        indicator: json.status?.indicator || 'unknown',
                        description: json.status?.description || 'Status unknown',
                        updatedAt: json.page?.updated_at || null,
                        pageUrl: STATUS_PAGE_URL
                    };

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

module.exports = {
    fetchServiceStatus,
    getStatusDisplay,
    formatStatusTime,
    clearStatusCache,
    STATUS_PAGE_URL,
    STATUS_INDICATORS
};
