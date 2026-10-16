// A mkdtemp home for tests that load the real extension modules. Every path
// claudemeter resolves must land inside it before a test writes anything.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// Cleared so the developer's own shell cannot change what the token read sees.
const AUTH_OVERRIDE_ENV = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
];

const SANDBOXED_ENV = [
    'HOME',
    'USERPROFILE',
    'XDG_CONFIG_HOME',
    'APPDATA',
    'CLAUDE_CONFIG_DIR',
    'CLAUDE_SECURESTORAGE_CONFIG_DIR',
    ...AUTH_OVERRIDE_ENV,
];

// utils.js fixes claudemeter's config dir at load, so modules are reloaded.
function purgeExtensionModules() {
    const srcDir = path.join(ROOT, 'src') + path.sep;
    const extension = path.join(ROOT, 'extension.js');
    for (const key of Object.keys(require.cache)) {
        if (key === extension || key.startsWith(srcDir)) delete require.cache[key];
    }
}

function createHomeSandbox(prefix = 'claudemeter-home-') {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    const home = path.join(root, 'home');
    const configHome = path.join(home, '.config');
    const claudeDir = path.join(home, '.claude');
    const workspace = path.join(root, 'workspace');
    for (const dir of [home, configHome, claudeDir, workspace]) fs.mkdirSync(dir, { recursive: true });

    const savedEnv = {};
    for (const key of SANDBOXED_ENV) savedEnv[key] = process.env[key];
    for (const key of AUTH_OVERRIDE_ENV) delete process.env[key];
    delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
    process.env.CLAUDE_CONFIG_DIR = claudeDir;

    purgeExtensionModules();

    const inside = (p) => p === root || p.startsWith(root + path.sep);

    // A usable token would let a cache miss reach api.anthropic.com.
    function assertContained() {
        const { PATHS, getDefaultDebugLogPath } = require(path.join(ROOT, 'src', 'utils'));
        const { getConfigDir, credentialsFilePath, readToken } = require(path.join(ROOT, 'src', 'tokenSource'));
        const { getClaudeConfigPath, getClaudeSessionsDir } = require(path.join(ROOT, 'src', 'claudeConfigReader'));
        const { ClaudeDataLoader } = require(path.join(ROOT, 'src', 'claudeDataLoader'));
        const resolved = {
            homedir: os.homedir(),
            claudemeterConfigDir: PATHS.CONFIG_DIR,
            sessionDataFile: PATHS.SESSION_DATA_FILE,
            debugLog: getDefaultDebugLogPath(),
            claudeConfigDir: getConfigDir(),
            credentialsFile: credentialsFilePath(),
            claudeJson: getClaudeConfigPath(),
            sessionsDir: getClaudeSessionsDir(),
        };
        // The Windows-only bases are fixed system paths that are only read.
        if (process.platform !== 'win32') {
            const loader = new ClaudeDataLoader(workspace, () => {});
            loader.claudeConfigPaths.forEach((p, i) => { resolved[`transcriptBase${i}`] = p; });
        }
        const escaped = Object.entries(resolved).filter(([, p]) => !inside(p));
        if (escaped.length > 0) {
            throw new Error(`sandbox escape: ${escaped.map(([k, p]) => `${k}=${p}`).join(', ')}`);
        }
        if (readToken().ok) {
            throw new Error('sandbox holds a usable OAuth token');
        }
        return resolved;
    }

    function restore() {
        purgeExtensionModules();
        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fs.rmSync(root, { recursive: true, force: true });
    }

    return { root, home, configHome, claudeDir, workspace, assertContained, restore };
}

module.exports = { createHomeSandbox, purgeExtensionModules, ROOT };
