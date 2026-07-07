// Project:   Claudemeter
// File:      claudeDataLoader.js
// Purpose:   Parse Claude Code JSONL files for token usage
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { getTokenLimit, splitLines } = require('./utils');

// Active session = the largest live session - max cache_read across the main
// transcripts modified inside the recency window. Newest-wins understated
// sub-agent / multi-session work (it showed a small concurrent sub-task, not
// the heavy orchestrator). A /clear can't be told apart from a concurrent
// session - it starts a fresh transcript with no continuation marker - so a
// cleared session lingers in the max until it ages out of the window.
function selectActiveSession(sessions) {
    let active = null;
    let activeSessionCount = 0;
    for (const s of sessions || []) {
        if (s && s.cacheRead > 0) {
            activeSessionCount++;
            if (active === null || s.cacheRead > active.cacheRead) {
                active = s;
            }
        }
    }
    return { active, activeSessionCount };
}

// Parse a transcript's latest assistant cache_read into a session summary, or
// null if it has no usage yet. Module-level so both the live scan and the
// aged-out fallback reuse it.
async function readSessionUsage(filePath, log) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = splitLines(content.trim());
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);
                if (entry.type === 'assistant' && entry.message?.usage) {
                    const cacheRead = entry.message.usage.cache_read_input_tokens || 0;
                    if (cacheRead > 0) {
                        const model = entry.message?.model;
                        return {
                            file: path.basename(filePath),
                            cacheRead,
                            cacheCreation: entry.message.usage.cache_creation_input_tokens || 0,
                            messageCount: lines.length,
                            model: (model && model !== '<synthetic>') ? model : null,
                        };
                    }
                }
            } catch (parseError) {
                continue;
            }
        }
    } catch (readError) {
        if (log) log(`Error reading ${path.basename(filePath)}: ${readError.message}`);
    }
    return null;
}

class ClaudeDataLoader {
    constructor(workspacePath = null, debugLogger = null) {
        this.claudeConfigPaths = this.getClaudeConfigPaths();
        this.workspacePath = workspacePath;
        this.projectDirName = workspacePath ? this.convertPathToClaudeDir(workspacePath) : null;
        this.log = debugLogger || console.log.bind(console);
        this.log(`ClaudeDataLoader initialised with workspace: ${workspacePath || '(none)'}`);
        if (this.projectDirName) {
            this.log(`   Looking for project dir: ${this.projectDirName}`);
        }
    }

    // Claude replaces path separators with dashes in directory names.
    // Works for both Unix (/) and Windows (\) paths.
    //
    // Windows note: Claude Code converts the drive-letter colon to a dash
    // rather than dropping it, so `c:\Projects\foo` becomes
    // `c--Projects-foo` - one dash from the colon, one from the first
    // backslash. Earlier versions dropped the colon and produced
    // `c-Projects-foo`, which caused the project-dir lookup to silently
    // miss whenever a workspace was open and forced the status bar to
    // render `Tk -` (no active session) for the entire VS Code window.
    convertPathToClaudeDir(workspacePath) {
        return workspacePath
            .replace(/\\/g, '-')  // Windows backslashes
            .replace(/\//g, '-')  // Unix forward slashes
            .replace(/:/g, '-')   // Windows drive-letter colon
            .replace(/ /g, '-');  // spaces - Claude Code dashes these too, #43
    }

    setWorkspacePath(workspacePath) {
        this.workspacePath = workspacePath;
        this.projectDirName = workspacePath ? this.convertPathToClaudeDir(workspacePath) : null;
        this.log(`ClaudeDataLoader workspace set to: ${workspacePath}`);
        this.log(`   Project dir name: ${this.projectDirName}`);
    }

    async getProjectDataDirectory() {
        if (!this.projectDirName) {
            this.log('No workspace path set - no project directory');
            return null;
        }

        const baseDir = await this.findClaudeDataDirectory();
        if (!baseDir) {
            return null;
        }

        const projectDir = path.join(baseDir, this.projectDirName);
        try {
            const stat = await fs.stat(projectDir);
            if (stat.isDirectory()) {
                this.log(`Found project-specific directory: ${projectDir}`);
                return projectDir;
            }
        } catch (error) {
            this.log(`Project directory not found: ${projectDir}`);
        }

        return null;
    }

    getClaudeConfigPaths() {
        const paths = [];
        const homeDir = os.homedir();

        const envPath = process.env.CLAUDE_CONFIG_DIR;
        if (envPath) {
            paths.push(...envPath.split(',').map(p => p.trim()));
        }

        // Standard locations (cross-platform)
        paths.push(path.join(homeDir, '.config', 'claude', 'projects'));
        paths.push(path.join(homeDir, '.claude', 'projects'));

        // Windows-specific: AppData and Program Files locations
        if (process.platform === 'win32') {
            const appData = process.env.APPDATA;
            const localAppData = process.env.LOCALAPPDATA;
            const programData = process.env.ProgramData || 'C:\\ProgramData';
            if (appData) {
                paths.push(path.join(appData, 'claude', 'projects'));
                paths.push(path.join(appData, 'Claude', 'projects'));
            }
            if (localAppData) {
                paths.push(path.join(localAppData, 'claude', 'projects'));
                paths.push(path.join(localAppData, 'Claude', 'projects'));
            }
            // New Anthropic path (March 2026+)
            paths.push('C:\\Program Files\\ClaudeCode\\projects');
            // Legacy enterprise managed path
            paths.push(path.join(programData, 'ClaudeCode', 'projects'));
        }

        return paths;
    }

    async findClaudeDataDirectory() {
        for (const dirPath of this.claudeConfigPaths) {
            try {
                const stat = await fs.stat(dirPath);
                if (stat.isDirectory()) {
                    this.log(`Found Claude data directory: ${dirPath}`);
                    return dirPath;
                }
            } catch (error) {
                continue;
            }
        }
        console.warn('Could not find Claude data directory in any standard location');
        return null;
    }

    async findJsonlFiles(dirPath) {
        const jsonlFiles = [];

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- entry.name from fs.readdir is a bare filename (OS forbids separators); dirPath is an internal Claude data dir.

                if (entry.isDirectory()) {
                    const subFiles = await this.findJsonlFiles(fullPath);
                    jsonlFiles.push(...subFiles);
                } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                    jsonlFiles.push(fullPath);
                }
            }
        } catch (error) {
            console.error('Error reading directory:', dirPath, error.message);
        }

        return jsonlFiles;
    }

    async parseJsonlFile(filePath) {
        const records = [];

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = splitLines(content).filter(line => line.trim());

            for (const line of lines) {
                try {
                    const record = JSON.parse(line);

                    if (this.isValidUsageRecord(record)) {
                        records.push(record);
                    }
                } catch (parseError) {
                    console.warn('Failed to parse line in:', filePath, parseError.message);
                }
            }
        } catch (error) {
            console.error('Error reading JSONL file:', filePath, error.message);
        }

        return records;
    }

    isValidUsageRecord(record) {
        return record &&
            record.message &&
            record.message.usage &&
            typeof record.message.usage.input_tokens === 'number' &&
            typeof record.message.usage.output_tokens === 'number' &&
            record.message.model !== '<synthetic>' &&
            !record.isApiErrorMessage;
    }

    getRecordHash(record) {
        const messageId = record.message?.id || '';
        const requestId = record.requestId || '';
        return `${messageId}-${requestId}`;
    }

    calculateTotalTokens(usage) {
        return (usage.input_tokens || 0) +
               (usage.output_tokens || 0) +
               (usage.cache_creation_input_tokens || 0) +
               (usage.cache_read_input_tokens || 0);
    }

    async loadUsageRecords(sinceTimestamp = null) {
        const dataDir = await this.findClaudeDataDirectory();
        if (!dataDir) {
            return {
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                messageCount: 0,
                records: []
            };
        }

        const jsonlFiles = await this.findJsonlFiles(dataDir);
        this.log(`Found ${jsonlFiles.length} JSONL files in ${dataDir}`);

        const allRecords = [];
        for (const filePath of jsonlFiles) {
            const records = await this.parseJsonlFile(filePath);
            allRecords.push(...records);
        }

        let filteredRecords = allRecords;
        if (sinceTimestamp) {
            filteredRecords = allRecords.filter(record => {
                const recordTime = new Date(record.timestamp).getTime();
                return recordTime >= sinceTimestamp;
            });
        }

        const uniqueRecords = [];
        const seenHashes = new Set();
        for (const record of filteredRecords) {
            const hash = this.getRecordHash(record);
            if (!seenHashes.has(hash)) {
                seenHashes.add(hash);
                uniqueRecords.push(record);
            }
        }

        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCacheCreationTokens = 0;
        let totalCacheReadTokens = 0;

        for (const record of uniqueRecords) {
            const usage = record.message.usage;
            totalInputTokens += usage.input_tokens || 0;
            totalOutputTokens += usage.output_tokens || 0;
            totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
            totalCacheReadTokens += usage.cache_read_input_tokens || 0;
        }

        const totalTokens = totalInputTokens + totalOutputTokens +
                           totalCacheCreationTokens + totalCacheReadTokens;

        return {
            totalTokens,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            cacheCreationTokens: totalCacheCreationTokens,
            cacheReadTokens: totalCacheReadTokens,
            messageCount: uniqueRecords.length,
            records: uniqueRecords
        };
    }

    // Extract cache_read from most recent assistant message as session context size
    // Only searches project-specific directory when workspace is set to avoid cross-project data
    async getCurrentSessionUsage() {
        this.log('getCurrentSessionUsage() - extracting cache size from most recent message');
        this.log(`   this.projectDirName = ${this.projectDirName}`);
        this.log(`   this.workspacePath = ${this.workspacePath}`);

        // Live window + hard deck (minutes). Live window: how recently a session
        // must have been written to count as live (we show the largest live one).
        // Hard deck: max age before a session is dead - the local Claude Code CLI
        // drops an idle session after ~30min, losing its context, so older
        // transcripts are ignored entirely, not even used as a fallback. Both
        // configurable. Lazy vscode read so the module stays importable outside
        // the extension host (tests).
        let windowMs = 10 * 60 * 1000;
        let hardDeckMs = 30 * 60 * 1000;
        try {
            const cfg = require('vscode').workspace.getConfiguration('claudemeter');
            const win = cfg.get('sessionWindowMinutes', 10);
            const deck = cfg.get('sessionMaxAgeMinutes', 30);
            if (typeof win === 'number' && win > 0) windowMs = win * 60 * 1000;
            if (typeof deck === 'number' && deck > 0) hardDeckMs = deck * 60 * 1000;
        } catch (e) {
            // not running in the extension host - keep the defaults
        }

        let dataDir;

        if (this.projectDirName) {
            dataDir = await this.getProjectDataDirectory();
            this.log(`   Project-specific dataDir = ${dataDir}`);

            if (!dataDir) {
                this.log(`Project directory not found for: ${this.projectDirName}`);
                this.log('   Not falling back to global search to avoid cross-project data');
                return {
                    totalTokens: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheCreationTokens: 0,
                    cacheReadTokens: 0,
                    messageCount: 0,
                    isActive: false
                };
            }
        } else {
            // No workspace open (e.g. an empty VS Code window). There is no
            // project to attribute a session to, so show nothing rather than
            // leaking another project's context via a global search - the Tk
            // gauge is per-project, only the web usage (Se/Wk) is account-global.
            this.log('   No workspace open - no project session to show (Tk -)');
            return {
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                messageCount: 0,
                isActive: false,
                activeSessionCount: 0,
            };
        }

        // Reaching here guarantees a project-specific dataDir (the no-workspace
        // and project-not-found cases returned above).
        try {
            const allJsonlFiles = await this.findJsonlFiles(dataDir);
            this.log(`Found ${allJsonlFiles.length} JSONL files in the project directory`);

            // Filter to main session files (UUID format), excluding agent-* subprocesses
            const mainSessionFiles = allJsonlFiles.filter(filePath => {
                const filename = path.basename(filePath);
                if (filename.startsWith('agent-')) {
                    return false;
                }
                const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
                return uuidPattern.test(filename);
            });

            this.log(`Filtered to ${mainSessionFiles.length} main session files (excluding agent files)`);

            // Stat every main session file, newest-first.
            const allFiles = [];
            for (const filePath of mainSessionFiles) {
                try {
                    const stats = await fs.stat(filePath);
                    allFiles.push({ path: filePath, modified: stats.mtimeMs });
                } catch (statError) {
                    continue;
                }
            }
            allFiles.sort((a, b) => b.modified - a.modified);

            // Hard deck: anything whose last-modified is older than the max age
            // is dead (the CLI dropped the idle session, context gone). If
            // nothing is within the deck, return inactive (Tk -) - this wins
            // ahead of the aged-out fallback below.
            const hardDeckCutoff = Date.now() - hardDeckMs;
            const relevantFiles = allFiles.filter(f => f.modified >= hardDeckCutoff);

            if (relevantFiles.length === 0) {
                this.log(`No session files within the ${Math.round(hardDeckMs / 60000)}min hard deck - inactive`);
                return {
                    totalTokens: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheCreationTokens: 0,
                    cacheReadTokens: 0,
                    messageCount: 0,
                    isActive: false,
                    activeSessionCount: 0
                };
            }

            // Live = written inside the live window (a subset of the deck). Show
            // the LARGEST live session - concurrent sub-agent work leaves several
            // mains live and we want the heavy orchestrator, not a small sub-task.
            const liveCutoff = Date.now() - windowMs;
            const liveFiles = relevantFiles.filter(f => f.modified >= liveCutoff);
            this.log(`${liveFiles.length} live (${Math.round(windowMs / 60000)}min) of ${relevantFiles.length} in-deck, ${allFiles.length} total`);

            const liveSessions = [];
            for (const f of liveFiles) {
                const s = await readSessionUsage(f.path, (m) => this.log(m));
                if (s) liveSessions.push(s);
            }

            let { active, activeSessionCount } = selectActiveSession(liveSessions);
            let agedOut = false;

            if (!active) {
                // Nothing live with usage. Fall back to the most-recent session
                // still inside the hard deck - last-known context, not a blank.
                for (const f of relevantFiles) {
                    const s = await readSessionUsage(f.path, (m) => this.log(m));
                    if (s) {
                        active = s;
                        activeSessionCount = 1;
                        agedOut = true;
                        break;
                    }
                }
            }

            const modelIds = active && active.model ? [active.model] : [];

            if (active) {
                const resolvedLimit = getTokenLimit(modelIds, active.cacheRead);
                const pct = ((active.cacheRead / resolvedLimit) * 100).toFixed(2);
                this.log(`Showing ${agedOut ? 'latest aged-out' : 'largest live'} session: ${active.file}`);
                this.log(`   Models: ${modelIds.join(', ') || 'none'} | Window: ${resolvedLimit.toLocaleString()} | cache_read: ${active.cacheRead.toLocaleString()} (${pct}%)`);
            } else {
                this.log('No session with usage - inactive');
            }

            return {
                totalTokens: active ? active.cacheRead : 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheCreationTokens: active ? active.cacheCreation : 0,
                cacheReadTokens: active ? active.cacheRead : 0,
                messageCount: active ? active.messageCount : 0,
                isActive: !!active,
                activeSessionCount: activeSessionCount,
                modelIds: modelIds,
            };

        } catch (error) {
            console.error(`Error getting current session usage: ${error.message}`);
            return {
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                messageCount: 0,
                isActive: false,
                activeSessionCount: 0
            };
        }
    }

    async getTodayUsage() {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        return await this.loadUsageRecords(startOfDay.getTime());
    }
}

module.exports = { ClaudeDataLoader, selectActiveSession };
