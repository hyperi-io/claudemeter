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
const { createHash } = require('crypto');
const { getTokenLimit, splitLines } = require('./utils');
const { observedCompactPoint } = require('./tk/compactPoint');
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

// Active session = the HIGHEST current context consumption across the live
// INTERACTIVE sessions - max contextTotal over the main transcripts modified
// inside the recency window.
//
// Interactive means subagents do not count. They are excluded twice over:
// Claude Code writes them to agent-*.jsonl, which getCurrentSessionUsage()
// filters out by name, and any that leaked into a main transcript would carry
// isSidechain, which foldRecord() skips.
//
// Newest-wins understated multi-session work (it showed a small concurrent
// sub-task, not the heavy orchestrator). A /clear can't be told apart from a
// concurrent session - it starts a fresh transcript with no continuation marker
// - so a cleared session lingers in the max until it ages out of the window.
//
// Ranks on raw tokens, not on each session's share of its own window. The two
// agree whenever the sessions share a window, which is the normal case. Where
// they differ, raw tokens can pick a large roomy session over a smaller one
// that is closer to compacting - see the note in getCurrentSessionUsage().
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

// Transcripts are append-only, so re-reading one whole is wasted work. The
// biggest on the machine this was written on is 162MB / 49,733 lines, and the
// gauge refreshes on a timer and on every debounced write - reading that per
// tick dwarfs everything else the extension does.
//
// So each transcript is read ONCE, and after that only the bytes appended
// since. `readAt` is the byte offset just past the last complete line already
// folded into `summary`; `size`/`mtimeMs` identify the file state that produced
// it. Unchanged file -> one stat and no read at all.
//
// Keyed by path. Entries are small (a summary object and a short array), and a
// transcript that stops changing simply stops being consulted.
const transcriptCache = new Map();

// Discard cached tail state. Only needed by tests, which write several
// different files to the same path faster than mtime can distinguish them.
function resetTranscriptCache() {
    transcriptCache.clear();
}

// Pre-filter for the compact-boundary scan on the FIRST read of a transcript,
// where the whole file has to be looked at once. JSON.parse on every line of a
// 49,733-line file is the expensive part, so a line is only parsed if it
// already contains the marker. Prose mentioning `compact_boundary` matches too
// - a session about Claude Code internals costs a handful of wasted parses -
// but the shape check in autoCompactPreTokensOf() means a false match can never
// become a number. Appended lines are parsed unconditionally: there are only
// ever a handful of them.
const COMPACT_BOUNDARY_MARKER = 'compact_boundary';

// Pull an AUTO compact boundary's pre-compaction size out of a parsed record,
// or 0 if the record is not one.
//
// Claude Code writes a `compact_boundary` system record on every compaction:
//
//   {"type":"system","subtype":"compact_boundary",
//    "compactMetadata":{"trigger":"auto","preTokens":167974,"postTokens":15235}}
//
// `trigger:"auto"` means Claude Code decided to compact, so preTokens records
// the size it actually fires at. `trigger:"manual"` is worthless for this - a
// user can /compact at any size at all.
function autoCompactPreTokensOf(entry) {
    if (entry?.subtype !== COMPACT_BOUNDARY_MARKER) return 0;
    const meta = entry.compactMetadata;
    if (!meta || meta.trigger !== 'auto') return 0;
    const pre = meta.preTokens;
    return Number.isFinite(pre) && pre > 0 ? pre : 0;
}

// Fold one parsed record into the running state, which is everything a
// transcript contributes: the newest real prompt, and every auto compaction.
// Shared by the first full read and each incremental tail read so the two can
// never drift apart.
//
// The prompt is the SUM of the three input fields: input + cache_creation +
// cache_read. cache_read alone is only what was already cached before the
// turn, so it lags by one turn and collapses on a cache miss - ingest a large
// file and all of it lands in cache_creation. Measured 32K against a real
// 233K prompt in a live session (#54).
// Record an auto compaction, once. Claude Code rewrites earlier lines when a
// session is resumed, so the same boundary can appear more than once -
// measured 18 records for 16 real compactions in one transcript. Counting a
// duplicate twice would weight it double in the median. The uuid is the
// record's identity; without one, fall back to the value so an exact repeat
// still folds.
function foldBoundary(entry, state) {
    const preTokens = autoCompactPreTokensOf(entry);
    if (!preTokens) return;
    const id = entry.uuid || `v:${preTokens}`;
    if (state.seenBoundaries.has(id)) return;
    state.seenBoundaries.add(id);
    state.autoCompacts.push(preTokens);
}

function foldRecord(entry, state) {
    foldBoundary(entry, state);

    // Same shapes isValidUsageRecord() rejects. These carry a token count
    // without being a real prompt, and one would become the session's whole
    // reported context.
    if (entry.isApiErrorMessage || entry.message?.model === '<synthetic>') return;
    // A subagent's turn describes the subagent's context, not this session's.
    // Claude Code keeps them in agent-*.jsonl, which the caller already filters
    // out, and no main transcript on the machine this was written on carries
    // one - but the flag is free to honour and a filename convention is not a
    // contract.
    if (entry.isSidechain) return;
    if (entry.type !== 'assistant' || !entry.message?.usage) return;

    const u = entry.message.usage;
    if (typeof u.input_tokens !== 'number' || typeof u.output_tokens !== 'number') return;
    const input = u.input_tokens || 0;
    const cacheCreation = u.cache_creation_input_tokens || 0;
    const cacheRead = u.cache_read_input_tokens || 0;
    const contextTotal = input + cacheCreation + cacheRead;
    // "Had a prompt", not "hit the cache". The first turn after a miss reports
    // cache_read 0 with a full-size cache_creation, and gating on cache_read
    // hid those sessions entirely.
    if (contextTotal <= 0) return;

    state.latest = {
        contextTotal,
        input,
        cacheRead,
        cacheCreation,
        model: entry.message?.model || null,
    };
}

// First read of a transcript: the whole file, once.
//
// Scans BACKWARD because the newest prompt is normally a few lines from the
// end, and only parses a line past that point if it contains the boundary
// marker - which keeps JSON.parse off the ~49,000 lines of a large transcript.
// Auto compactions come out newest-first and get reversed to match the
// oldest-first order every other path produces.
function scanWholeTranscript(lines) {
    const state = { latest: null, autoCompacts: [], seenBoundaries: new Set() };
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (state.latest && !line.includes(COMPACT_BOUNDARY_MARKER)) continue;
        try {
            const entry = JSON.parse(line);
            // Scanning backward, so the FIRST usage record found is the newest.
            // Once it is in hand only boundaries are still wanted - folding a
            // whole record here would let an older prompt overwrite it.
            if (state.latest) foldBoundary(entry, state);
            else foldRecord(entry, state);
        } catch (parseError) {
            continue;
        }
    }
    state.autoCompacts.reverse();
    return state;
}

// Byte offset just past the last newline, i.e. the end of the last COMPLETE
// line. A transcript being appended to mid-read leaves a partial final line;
// stopping short of it means the next read picks it up whole.
function lastCompleteLineEnd(buffer) {
    return buffer.lastIndexOf('\n') + 1;
}

// Split a newline-terminated chunk into records, dropping the empty tail the
// final newline produces. Both read paths go through this so `messageCount`
// means the same thing whether a transcript was read whole or in pieces.
function recordLines(text) {
    return splitLines(text).filter(line => line.trim());
}

// Bytes hashed to tell "the same file, longer" from "a different file at the
// same path". 1024 is what Filebeat and FastForward use; a Claude Code
// transcript's first record is far shorter than that, so the window covers the
// whole of it plus room to spare.
const FINGERPRINT_BYTES = 1024;

// File identity, the way log tailers do it: device + inode + a hash of the
// head. Inode alone is not enough - inodes get reused, which is why Vector
// defaults to a content checksum instead - and a head hash alone collides
// across files that begin identically. Together they catch every way a
// transcript can stop being the file we were reading:
//
//   truncated in place  -> size drops below what we already consumed
//   replaced at path    -> device/inode change
//   rewritten from 0    -> head hash changes
//
// Any of those means the cached byte offset points into a file that no longer
// exists, so the answer is to forget it and read the whole thing again.
async function readFingerprint(handle, size) {
    const length = Math.min(FINGERPRINT_BYTES, size);
    if (length <= 0) return 'empty';
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return createHash('sha1').update(buffer).digest('hex');
}

// Windows can report ino/dev as 0 on some filesystems, in which case they
// carry no information and the head hash does the work on its own.
function identityOf(stats, fingerprint) {
    return `${stats.dev || 0}:${stats.ino || 0}:${fingerprint}`;
}

// Parse a transcript's latest assistant prompt size into a session summary, or
// null if it has no usage yet. Module-level so both the live scan and the
// aged-out fallback reuse it.
//
// Reads each transcript once and thereafter only the bytes appended since -
// these files are append-only and reach 162MB, while the gauge refreshes on a
// timer and on every debounced write. An unchanged file costs one stat.
async function readSessionUsage(filePath, log) {
    let handle = null;
    try {
        const stats = await fs.stat(filePath);
        const cached = transcriptCache.get(filePath);

        // Nothing has touched the file since the last look - one stat, no read
        // and no hash. This is the common case by a wide margin.
        if (cached
            && cached.size === stats.size
            && cached.mtimeMs === stats.mtimeMs
            && cached.dev === (stats.dev || 0)
            && cached.ino === (stats.ino || 0)) {
            return cached.summary ? { ...cached.summary } : null;
        }

        handle = await fs.open(filePath, 'r');
        const fingerprint = await readFingerprint(handle, stats.size);
        const identity = identityOf(stats, fingerprint);

        // Same file, and everything we consumed is still there: read only what
        // was appended. Anything else - truncated, replaced, rewritten from the
        // top - and the cached offset is meaningless.
        const continues = cached
            && cached.identity === identity
            && stats.size >= cached.readAt;

        if (continues && stats.size === cached.readAt) {
            // Touched but no COMPLETE new line yet (a write caught mid-flight).
            // Re-stamp so the cheap path catches it next time.
            await handle.close();
            handle = null;
            transcriptCache.set(filePath, {
                ...cached,
                size: stats.size,
                mtimeMs: stats.mtimeMs,
            });
            return cached.summary ? { ...cached.summary } : null;
        }

        if (continues) {
            const length = stats.size - cached.readAt;
            const buffer = Buffer.alloc(length);
            await handle.read(buffer, 0, length, cached.readAt);
            await handle.close();
            handle = null;

            const text = buffer.toString('utf-8');
            const complete = lastCompleteLineEnd(text);
            // Carries `seenBoundaries` forward so a boundary rewritten into the
            // appended bytes is not counted a second time.
            const state = {
                latest: cached.state.latest,
                autoCompacts: cached.state.autoCompacts,
                seenBoundaries: cached.state.seenBoundaries,
            };
            let added = 0;
            for (const line of recordLines(text.slice(0, complete))) {
                added++;
                try {
                    // Appended lines are a handful per turn, so parse them all
                    // rather than pre-filtering - the tail is where the newest
                    // prompt lives and it has to be parsed regardless.
                    foldRecord(JSON.parse(line), state);
                } catch (parseError) {
                    continue;
                }
            }

            const messageCount = cached.messageCount + added;
            const summary = state.latest ? {
                file: path.basename(filePath),
                ...state.latest,
                messageCount,
                cwd: cached.cwd,
                autoCompacts: [...state.autoCompacts],
            } : null;

            transcriptCache.set(filePath, {
                identity,
                dev: stats.dev || 0,
                ino: stats.ino || 0,
                size: stats.size,
                mtimeMs: stats.mtimeMs,
                // Only what was consumed: a partial trailing line is re-read
                // next time, whole.
                readAt: cached.readAt + Buffer.byteLength(text.slice(0, complete), 'utf-8'),
                messageCount,
                cwd: cached.cwd,
                resyncs: cached.resyncs,
                state,
                summary,
            });
            return summary ? { ...summary } : null;
        }

        await handle.close();
        handle = null;

        // Full read. Either the first sight of this transcript, or its identity
        // changed underneath us.
        //
        // A resync can only repeat if the identity keeps changing, because the
        // NEW identity is stored below and the next tick compares equal to it.
        // If Claude Code ever did rewrite a transcript on every write, this
        // would settle into a full read per tick - which is exactly what this
        // code replaced, so the worst case is the old cost, not a hang or a
        // wrong number. The counter makes that visible instead of silent.
        const resyncs = cached ? cached.resyncs + 1 : 0;
        if (cached && log) {
            log(`${path.basename(filePath)} changed identity (${cached.identity} -> ${identity})`
                + ` - re-reading in full (resync #${resyncs})`);
        }

        const content = await fs.readFile(filePath, 'utf-8');
        const complete = lastCompleteLineEnd(content);
        const consumed = content.slice(0, complete);
        const lines = recordLines(consumed);
        const state = scanWholeTranscript(lines);
        // Where the session STARTED, which is the project it belongs to. `cwd`
        // is a per-entry field and it moves - a Bash `cd`, a worktree, an
        // added-directory turn all rewrite it (measured 2026-07-20: 28% of 141
        // transcripts recorded more than one, one recorded 24). The last turn's
        // cwd would misattribute a long session to whatever it touched last.
        // It cannot change once recorded, so it is resolved once and cached.
        const cwd = firstRecordedCwd(lines);
        const messageCount = lines.length;
        const summary = state.latest ? {
            file: path.basename(filePath),
            ...state.latest,
            messageCount,
            cwd,
            autoCompacts: [...state.autoCompacts],
        } : null;

        transcriptCache.set(filePath, {
            identity,
            dev: stats.dev || 0,
            ino: stats.ino || 0,
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            readAt: Buffer.byteLength(consumed, 'utf-8'),
            messageCount,
            cwd,
            resyncs,
            state,
            summary,
        });
        return summary ? { ...summary } : null;
    } catch (readError) {
        if (handle) {
            try { await handle.close(); } catch { /* already gone */ }
        }
        if (log) log(`Error reading ${path.basename(filePath)}: ${readError.message}`);
        return null;
    }
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

            // Live = written inside the live window (a subset of the deck).
            // Show the one consuming the most context; see selectActiveSession.
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
            // Where THIS session actually compacts, from its own history. Null
            // until it has auto-compacted at least once, and the tiers fall
            // back to the window-minus-reserve model then.
            const compactPoint = active ? observedCompactPoint(active.autoCompacts) : null;

            if (active) {
                const resolvedLimit = getTokenLimit(modelIds, active.contextTotal);
                const pct = ((active.contextTotal / resolvedLimit) * 100).toFixed(2);
                this.log(`Showing ${agedOut ? 'latest aged-out' : 'highest-consumption live'} session: ${active.file}`);
                this.log(`   Models: ${modelIds.join(', ') || 'none'} | Window: ${resolvedLimit.toLocaleString()} | context: ${active.contextTotal.toLocaleString()} (${pct}%)`);
                this.log(`   input: ${active.input.toLocaleString()} + cache_creation: ${active.cacheCreation.toLocaleString()} + cache_read: ${active.cacheRead.toLocaleString()}`);
                this.log(compactPoint
                    ? `   compacts at ~${compactPoint.toLocaleString()} (from ${active.autoCompacts.length} auto-compaction(s) this session)`
                    : '   never auto-compacted - tiers fall back to window minus reserve');
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
                compactPoint,
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

module.exports = {
    ClaudeDataLoader,
    selectActiveSession,
    readSessionUsage,
    autoCompactPreTokensOf,
    resetTranscriptCache,
};
