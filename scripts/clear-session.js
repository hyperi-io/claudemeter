#!/usr/bin/env node
/**
 * Clears the browser session directory for fresh authentication testing
 * Used by VS Code debug configuration "Run Extension (Test Auth - Clear Session)"
 *
 * Note: The extension itself closes the Puppeteer browser when it stops.
 * This script just clears the session data directory.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const sessionDir = path.join(os.homedir(), '.claudemeter-browser-session');

if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    console.log('Browser session cleared:', sessionDir);
} else {
    console.log('No session to clear');
}

process.exit(0);
