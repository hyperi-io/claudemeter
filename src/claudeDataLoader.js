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
const {
    projectDirName,
    normaliseUnicode,
    canonicalisePath,
    pathsEqual,
    firstRecordedCwd,
    resolveProjectDir,
} = require('./projectDir');

// How long a "no project directory for this workspace" answer stays cached.
// Long enough to keep the refresh timer off the full scan, short enough that a
// first-ever Claude Code session in the workspace lights the gauge up promptly.
const DIR_MISS_TTL_MS = 60 * 1000;

// Active session = the largest live session - max context across the main
// transcripts modified inside the recency window. Newest-wins understated
// sub-agent / multi-session work (it showed a small concurrent sub-task, not
// the heavy orchestrator). A /clear can't be told apart from a concurrent
// session - it starts a fresh transcript with no continuation marker - so a
// cleared session lingers in the max until it ages out of the window.
function selectActiveSession(sessions) {
    let active = null;
    let activeSessionCount = 0;
    for (const s of sessions || []) {
        if (s && s.contextTotal > 0) {
            activeSessionCount++;
            if (active === null || s.contextTotal > active.contextTotal) {
                active = s;
            }
        }
    }
    return { active, activeSessionCount };
}

// Parse a transcript's latest assistant prompt size into a session summary, or
// null if it has no usage yet. Module-level so both the live scan and the
// aged-out fallback reuse it.
//
// The prompt is the SUM of the three input fields: input + cache_creation +
// cache_read. cache_read alone is only what was already cached before the
// turn, so it lags by one turn and collapses on a cache miss - ingest a large
// file and all of it lands in cache_creation. Measured 32K against a real
// 233K prompt in a live session (#54).
async function readSessionUsage(filePath, log) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = splitLines(content.trim());
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const entry = JSON.parse(lines[i]);
                // Same shapes isValidUsageRecord() rejects. These carry a
                // token count without being a real prompt, and one would
                // become the session's whole reported context.
                if (entry.isApiErrorMessage || entry.message?.model === '<synthetic>') {
                    continue;
                }
                if (entry.type === 'assistant' && entry.message?.usage) {
                    const usage = entry.message.usage;
                    if (typeof usage.input_tokens !== 'number'
                        || typeof usage.output_tokens !== 'number') {
                        continue;
                    }
                    const input = usage.input_tokens || 0;
                    const cacheCreation = usage.cache_creation_input_tokens || 0;
                    const cacheRead = usage.cache_read_input_tokens || 0;
                    const contextTotal = input + cacheCreation + cacheRead;
                    // "Had a prompt", not "hit the cache". The first turn
                    // after a miss reports cache_read 0 with a full-size
                    // cache_creation, and gating on cache_read hid those
                    // sessions entirely.
                    if (contextTotal > 0) {
                        const model = entry.message?.model;
                        return {
                            file: path.basename(filePath),
                            contextTotal,
                            input,
                            cacheRead,
                            cacheCreation,
                            messageCount: lines.length,
                            model: model || null,
                            // Where the session STARTED, which is the project
                            // it belongs to. `cwd` is a per-entry field and it
                            // moves - a Bash `cd`, a worktree, an
                            // added-directory turn all rewrite it (measured
                            // 2026-07-20: 28% of 141 transcripts recorded more
                            // than one, one recorded 24). The last turn's cwd
                            // would misattribute a long session to whatever it
                            // touched last. See makeSessionFilter().
                            cwd: firstRecordedCwd(lines),
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

    // Best-effort name for logging and the "is a workspace open" guard.
    // Synchronous, so it normalises Unicode but cannot resolve symlinks. The
    // authoritative name comes from getProjectDataDirectory(). See
    // src/projectDir.js.
    convertPathToClaudeDir(workspacePath) {
        return projectDirName(normaliseUnicode(workspacePath));
    }

    setWorkspacePath(workspacePath) {
        this.workspacePath = workspacePath;
        this.dirMiss = null;
        this.projectDirName = workspacePath ? this.convertPathToClaudeDir(workspacePath) : null;
        this.log(`ClaudeDataLoader workspace set to: ${workspacePath}`);
        this.log(`   Project dir name: ${this.projectDirName}`);
    }

    async getProjectDataDirectory() {
        if (!this.workspacePath) {
            this.log('No workspace path set - no project directory');
            return null;
        }

        const baseDir = await this.findClaudeDataDirectory();
        if (!baseDir) {
            return null;
        }

        // Throttle the fallback scan, not the lookup. The derived stats still
        // run every time, so a workspace's first session lights the gauge
        // straight away. Only the walk over every project directory is
        // rate-limited - this runs on the refresh timer and on every debounced
        // JSONL event.
        const missKey = `${baseDir}|${this.workspacePath}`;
        const scannedRecently = this.dirMiss?.key === missKey
            && Date.now() - this.dirMiss.at < DIR_MISS_TTL_MS;

        const resolved = await resolveProjectDir(baseDir, this.workspacePath, (m) => this.log(m), !scannedRecently);
        if (!resolved) {
            if (!scannedRecently) this.dirMiss = { key: missKey, at: Date.now() };
            this.log(`Project directory not found for workspace: ${this.workspacePath}`);
            return null;
        }

        this.log(`Found project-specific directory (${resolved.method}): ${resolved.dir}`);
        if (resolved.method === 'recorded-cwd') {
            // Naming rule missed and the transcripts settled it. The rule has
            // drifted - re-check src/projectDir.js against the current CLI.
            this.log('   Naming rule did not match - resolved from the recorded cwd instead');
        }
        return resolved.dir;
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

    // `seen` carries resolved transcript paths down the recursion so a
    // symlinked transcript is not returned twice.
    async findJsonlFiles(dirPath, seen = new Set()) {
        const jsonlFiles = [];

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- entry.name from fs.readdir is a bare filename (OS forbids separators); dirPath is an internal Claude data dir.

                // Symlinked FILES are followed, symlinked DIRECTORIES are not.
                //
                // People do symlink transcripts (shared session storage, GNU
                // Stow dotfiles) and Claude Code stopped following those in
                // 2.1.104 (claude-code#51488, #46342), so a linked .jsonl is
                // worth picking up. Recursing through a linked DIRECTORY is
                // not: this walk has no cycle detection, and project dirs
                // already carry links pointing outside the Claude tree (a
                // `memory` link is common). Two links resolving to an ancestor
                // spin until the kernel's symlink limit and hang the refresh.
                // A link to an ancestor also yields the same transcript once
                // per level, which inflates the live-session count.
                //
                // Symlinked project directories are handled a level up, in
                // projectDir.findDirByRecordedCwd, which stats them without
                // recursing.
                let isDir = entry.isDirectory();
                let isFile = entry.isFile();
                if (entry.isSymbolicLink()) {
                    try {
                        isFile = (await fs.stat(fullPath)).isFile();
                    } catch (linkError) {
                        continue;  // dangling link
                    }
                }

                if (isDir) {
                    const subFiles = await this.findJsonlFiles(fullPath, seen);
                    jsonlFiles.push(...subFiles);
                } else if (isFile && entry.name.endsWith('.jsonl')) {
                    // Deduplicate on the resolved path. A link pointing at a
                    // transcript we already have would otherwise count as a
                    // second live session. One realpath per transcript is
                    // nothing next to reading the file, which we do anyway.
                    let realPath;
                    try {
                        realPath = await fs.realpath(fullPath);
                    } catch (linkError) {
                        continue;
                    }
                    if (seen.has(realPath)) continue;
                    seen.add(realPath);
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

    // Did this session run in OUR workspace?
    //
    // The directory is not a per-project guarantee. The name is a lossy
    // encoding - `/work/my-api`, `/work/my/api`, `/work/my_api` and
    // `/work-my/api` all collapse to one folder (claude-code#19972) - so a
    // directory can hold several unrelated projects, silently merged.
    //
    // Matches the ORIGIN cwd, same field findDirByRecordedCwd uses. The last
    // turn's cwd would drop any session that ended in a subdirectory, a
    // worktree or another repo - measured 2026-07-20, 4% of 141 transcripts,
    // and the biggest ones at that.
    //
    // Permissive: dropped only when it HAS a cwd and that cwd is elsewhere. A
    // transcript with none is kept, since blanking the gauge over a parsing
    // gap is worse than the rare over-inclusion.
    async makeSessionFilter() {
        if (!this.workspacePath) return async () => true;
        const canonical = await canonicalisePath(this.workspacePath);
        return async (session) => {
            if (!session.cwd) return true;
            if (pathsEqual(await canonicalisePath(session.cwd), canonical)) return true;
            this.log(`   Skipping ${session.file}: ran in ${session.cwd}, not this workspace`);
            return false;
        };
    }

    // Extract the prompt size of the most recent assistant message as the
    // session context size (input + cache_creation + cache_read).
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

            const ours = await this.makeSessionFilter();

            const liveSessions = [];
            for (const f of liveFiles) {
                const s = await readSessionUsage(f.path, (m) => this.log(m));
                if (s && await ours(s)) liveSessions.push(s);
            }

            let { active, activeSessionCount } = selectActiveSession(liveSessions);
            let agedOut = false;

            if (!active) {
                // Nothing live with usage. Fall back to the most-recent session
                // still inside the hard deck - last-known context, not a blank.
                for (const f of relevantFiles) {
                    const s = await readSessionUsage(f.path, (m) => this.log(m));
                    if (s && await ours(s)) {
                        active = s;
                        activeSessionCount = 1;
                        agedOut = true;
                        break;
                    }
                }
            }

            const modelIds = active && active.model ? [active.model] : [];

            if (active) {
                const resolvedLimit = getTokenLimit(modelIds, active.contextTotal);
                const pct = ((active.contextTotal / resolvedLimit) * 100).toFixed(2);
                this.log(`Showing ${agedOut ? 'latest aged-out' : 'largest live'} session: ${active.file}`);
                this.log(`   Models: ${modelIds.join(', ') || 'none'} | Window: ${resolvedLimit.toLocaleString()} | context: ${active.contextTotal.toLocaleString()} (${pct}%)`);
                this.log(`   input: ${active.input.toLocaleString()} + cache_creation: ${active.cacheCreation.toLocaleString()} + cache_read: ${active.cacheRead.toLocaleString()}`);
            } else {
                this.log('No session with usage - inactive');
            }

            return {
                totalTokens: active ? active.contextTotal : 0,
                inputTokens: active ? active.input : 0,
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

module.exports = { ClaudeDataLoader, selectActiveSession, readSessionUsage };
