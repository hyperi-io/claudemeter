// Project:   Claudemeter v2 (Lightweight)
// File:      auth.js
// Purpose:   Session cookie management (file-based, no browser dependency)
// Language:  JavaScript (CommonJS)
//
// v2 auth: manages a session cookie stored as a JSON file. No Puppeteer or
// browser dependency — cookie is extracted during the one-time login flow
// in httpFetcher.js and persisted for subsequent HTTP-only fetches.
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

const fs = require('fs');
const path = require('path');
const { PATHS, isDebugEnabled, getDebugChannel, fileLog } = require('./utils');

class ClaudeAuth {
    constructor() {
        this.cookieFile = PATHS.SESSION_COOKIE_FILE;
    }

    hasExistingSession() {
        try {
            if (!fs.existsSync(this.cookieFile)) {
                return false;
            }
            const data = JSON.parse(fs.readFileSync(this.cookieFile, 'utf-8'));
            if (!data.sessionKey) return false;

            // Check expiry
            if (data.expires && data.expires <= Date.now() / 1000) {
                return false;
            }
            return true;
        } catch (error) {
            console.log('Error checking session:', error.message);
            return false;
        }
    }

    saveCookie(sessionKey, expires, orgId) {
        const dir = path.dirname(this.cookieFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const data = {
            sessionKey,
            expires,
            savedAt: new Date().toISOString(),
            orgId: orgId || null,
        };
        fs.writeFileSync(this.cookieFile, JSON.stringify(data, null, 2));
        fileLog('Session cookie saved');
    }

    readCookie() {
        try {
            if (!fs.existsSync(this.cookieFile)) return null;
            const data = JSON.parse(fs.readFileSync(this.cookieFile, 'utf-8'));
            if (!data.sessionKey) return null;
            return data;
        } catch (error) {
            fileLog(`Error reading cookie: ${error.message}`);
            return null;
        }
    }

    isCookieValid() {
        const cookie = this.readCookie();
        if (!cookie) return false;
        if (cookie.expires && cookie.expires <= Date.now() / 1000) return false;
        return true;
    }

    async clearSession() {
        const debug = isDebugEnabled();

        if (debug) {
            getDebugChannel().appendLine(`\n=== CLEAR SESSION (${new Date().toLocaleString()}) ===`);
        }

        try {
            if (fs.existsSync(this.cookieFile)) {
                fs.unlinkSync(this.cookieFile);
                if (debug) {
                    getDebugChannel().appendLine(`Deleted session cookie: ${this.cookieFile}`);
                }
            }

            // Clean up old v1 browser-session directory if it exists
            const oldSessionDir = path.join(PATHS.CONFIG_DIR, 'browser-session');
            if (fs.existsSync(oldSessionDir)) {
                fs.rmSync(oldSessionDir, { recursive: true, force: true });
                if (debug) {
                    getDebugChannel().appendLine('Cleaned up old browser-session directory');
                }
            }

            if (debug) {
                getDebugChannel().appendLine('Session cleared - next fetch will prompt for login');
            }

            return { success: true, message: 'Session cleared. Next fetch will prompt for login.' };
        } catch (error) {
            console.error('Failed to clear session:', error);
            if (debug) {
                getDebugChannel().appendLine(`Failed to clear session: ${error.message}`);
            }
            return { success: false, message: `Failed to clear session: ${error.message}` };
        }
    }

    getDiagnostics() {
        const cookie = this.readCookie();
        return {
            cookieFile: this.cookieFile,
            hasExistingSession: this.hasExistingSession(),
            hasCookie: !!cookie,
            cookieExpires: cookie?.expires ? new Date(cookie.expires * 1000).toISOString() : null,
            cookieSavedAt: cookie?.savedAt || null,
        };
    }
}

module.exports = { ClaudeAuth };
