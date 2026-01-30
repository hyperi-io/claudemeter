// Project:   Claudemeter
// File:      auth.js
// Purpose:   Cookie-based authentication and session validation
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

const fs = require('fs');
const path = require('path');
const { PATHS, TIMEOUTS, CLAUDE_URLS, isDebugEnabled, getDebugChannel, sleep } = require('./utils');

class ClaudeAuth {
    constructor() {
        this.sessionDir = PATHS.BROWSER_SESSION_DIR;
        this.page = null;
        this.browser = null;
    }

    setPageAndBrowser(page, browser) {
        this.page = page;
        this.browser = browser;
    }

    getSessionDir() {
        return this.sessionDir;
    }

    hasExistingSession() {
        try {
            if (!fs.existsSync(this.sessionDir)) {
                return false;
            }

            // Chromium stores cookies in various locations
            const cookieFiles = [
                path.join(this.sessionDir, 'Default', 'Cookies'),
                path.join(this.sessionDir, 'Default', 'Network', 'Cookies')
            ];

            for (const cookieFile of cookieFiles) {
                if (fs.existsSync(cookieFile)) {
                    const stats = fs.statSync(cookieFile);
                    if (stats.size > 0) {
                        return true;
                    }
                }
            }

            return false;
        } catch (error) {
            console.log('Error checking session:', error);
            return false;
        }
    }

    // Short timeout (5s) to fail fast if session is stale
    async checkCookie() {
        if (!this.page) {
            return { exists: false, expired: true, cookie: null, error: 'no_page' };
        }

        try {
            // Browser must visit domain before cookies are accessible
            const currentUrl = this.page.url();
            if (!currentUrl.includes('claude.ai')) {
                await this.page.goto(CLAUDE_URLS.BASE, {
                    waitUntil: 'domcontentloaded',
                    timeout: 5000
                });
            }

            const cookies = await this.page.cookies(CLAUDE_URLS.BASE);
            const sessionCookie = cookies.find(c => c.name === 'sessionKey');

            if (!sessionCookie) {
                return { exists: false, expired: true, cookie: null, error: null };
            }

            const isExpired = sessionCookie.expires <= Date.now() / 1000;
            return {
                exists: true,
                expired: isExpired,
                cookie: sessionCookie,
                error: null
            };
        } catch (error) {
            console.log('Error checking cookie:', error.message);
            // Return error info so caller can distinguish between "no cookie" and "couldn't check"
            return { exists: false, expired: true, cookie: null, error: error.message };
        }
    }

    // Fast path validation using fetch() instead of page navigation
    async validateSession() {
        if (!this.page) {
            return { valid: false, reason: 'no_page' };
        }

        const debug = isDebugEnabled();

        const cookieCheck = await this.checkCookie();

        // If there was an error checking cookies (network issue, timeout),
        // return a transient error so we can try fetching anyway
        if (cookieCheck.error) {
            if (debug) {
                getDebugChannel().appendLine(`Auth: Error checking cookie: ${cookieCheck.error}`);
            }
            return { valid: false, reason: 'cookie_check_error' };
        }

        if (!cookieCheck.exists) {
            if (debug) {
                getDebugChannel().appendLine('Auth: No sessionKey cookie found');
            }
            return { valid: false, reason: 'no_cookie' };
        }

        if (cookieCheck.expired) {
            if (debug) {
                getDebugChannel().appendLine('Auth: sessionKey cookie expired');
            }
            return { valid: false, reason: 'cookie_expired' };
        }

        try {
            if (debug) {
                getDebugChannel().appendLine('Auth: Validating session with API call...');
            }

            const apiUrl = CLAUDE_URLS.API_ORGS;
            const isValid = await this.page.evaluate(async (url) => {
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        credentials: 'include'
                    });
                    return response.ok;
                } catch {
                    return false;
                }
            }, apiUrl);

            if (debug) {
                getDebugChannel().appendLine(`Auth: API validation result: ${isValid ? 'valid' : 'invalid'}`);
            }

            return {
                valid: isValid,
                reason: isValid ? 'valid' : 'server_rejected'
            };
        } catch (error) {
            if (debug) {
                getDebugChannel().appendLine(`Auth: Validation error: ${error.message}`);
            }
            return { valid: false, reason: 'validation_error' };
        }
    }

    // Poll for sessionKey cookie without disturbing the login page
    async waitForLogin(maxWaitMs = TIMEOUTS.LOGIN_WAIT, pollIntervalMs = TIMEOUTS.LOGIN_POLL) {
        const debug = isDebugEnabled();
        const startTime = Date.now();

        if (debug) {
            getDebugChannel().appendLine(`Auth: Waiting for login (max ${maxWaitMs / 1000}s)...`);
        }

        while (Date.now() - startTime < maxWaitMs) {
            await sleep(pollIntervalMs);

            try {
                if (!this.browser || !this.page) {
                    if (debug) {
                        getDebugChannel().appendLine('Auth: Browser closed by user - login cancelled');
                    }
                    return { success: false, cancelled: true };
                }

                if (!this.browser.isConnected()) {
                    if (debug) {
                        getDebugChannel().appendLine('Auth: Browser disconnected - login cancelled');
                    }
                    return { success: false, cancelled: true };
                }

                const cookies = await this.page.cookies(CLAUDE_URLS.BASE);
                const hasSessionKey = cookies.some(c => c.name === 'sessionKey');

                if (hasSessionKey) {
                    if (debug) {
                        getDebugChannel().appendLine('Auth: sessionKey cookie detected - login successful');
                    }
                    return { success: true, cancelled: false };
                }
            } catch (error) {
                // Browser closed errors
                if (error.message.includes('Target closed') ||
                    error.message.includes('Protocol error') ||
                    error.message.includes('Session closed') ||
                    error.message.includes('Connection closed')) {
                    if (debug) {
                        getDebugChannel().appendLine(`Auth: Browser closed - ${error.message}`);
                    }
                    return { success: false, cancelled: true };
                }
                console.log('Cookie check error:', error.message);
            }
        }

        if (debug) {
            getDebugChannel().appendLine('Auth: Login timeout');
        }
        return { success: false, cancelled: false };
    }

    async clearSession() {
        const debug = isDebugEnabled();

        if (debug) {
            getDebugChannel().appendLine(`\n=== CLEAR SESSION (${new Date().toLocaleString()}) ===`);
        }

        try {
            if (fs.existsSync(this.sessionDir)) {
                fs.rmSync(this.sessionDir, { recursive: true, force: true });
                if (debug) {
                    getDebugChannel().appendLine(`Deleted session directory: ${this.sessionDir}`);
                }
            }

            if (debug) {
                getDebugChannel().appendLine('Session cleared - next fetch will prompt for fresh login');
            }

            return { success: true, message: 'Session cleared successfully. Next fetch will prompt for login.' };
        } catch (error) {
            console.error('Failed to delete session directory:', error);
            if (debug) {
                getDebugChannel().appendLine(`Failed to delete session directory: ${error.message}`);
            }
            return { success: false, message: `Failed to clear session: ${error.message}` };
        }
    }

    getDiagnostics() {
        return {
            sessionDir: this.sessionDir,
            hasExistingSession: this.hasExistingSession(),
            hasPage: !!this.page,
            hasBrowser: !!this.browser
        };
    }
}

module.exports = { ClaudeAuth };
