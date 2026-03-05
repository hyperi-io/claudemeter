#!/usr/bin/env node
/**
 * Clears the session cookie for fresh authentication testing.
 * Also cleans up any legacy browser session directories.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function getConfigDir() {
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'claudemeter');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'claudemeter');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claudemeter');
}

const configDir = getConfigDir();

// Delete session cookie (v2)
const cookieFile = path.join(configDir, 'session-cookie.json');
if (fs.existsSync(cookieFile)) {
    fs.unlinkSync(cookieFile);
    console.log('Session cookie cleared:', cookieFile);
} else {
    console.log('No session cookie to clear');
}

// Clean up legacy browser session (v1)
const legacyDir = path.join(configDir, 'browser-session');
if (fs.existsSync(legacyDir)) {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    console.log('Legacy browser session cleared:', legacyDir);
}

// Clean up login session dir
const loginDir = path.join(configDir, 'login-session');
if (fs.existsSync(loginDir)) {
    fs.rmSync(loginDir, { recursive: true, force: true });
    console.log('Login session cleared:', loginDir);
}

process.exit(0);
