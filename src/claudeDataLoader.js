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
const {
    projectDirName,
    normaliseUnicode,
    canonicalisePath,
    pathsEqual,
    firstRecordedCwd,
    resolveProjectDir,
    CWD_PROBE_BYTES,
} = require('./projectDir');

// How long a "no project directory for this workspace" answer stays cached.
// Long enough to keep the refresh timer off the full scan, short enough that a
// first-ever Claude Code session in the workspace lights the gauge up promptly.
const DIR_MISS_TTL_MS = 60 * 1000;

// Active session = the HIGHEST current context consumption across the live
// INTERACTIVE sessions - max contextTotal over the main transcripts whose
// NEWEST PROMPT falls inside the recency window. Prompted, not merely
// modified; getCurrentSessionUsage() has the reason.
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

// Transcripts are append-only and reach hundreds of MB, so each is read once, then
// only the bytes appended since: `readAt` is the offset past the last complete line
// folded into `summary`. `size` and the edge hashes detect a rewrite, mtime is too coarse.
const transcriptCache = new Map();

// Least recently used first, capped so a host that runs for days does not keep
// one entry per transcript ever read.
const TRANSCRIPT_CACHE_MAX = 64;

// In-flight reads, keyed by path. The refresh timer and the debounced
// file-watcher both reach readSessionUsage() with nothing between them, so two
// reads of one transcript can overlap, and whichever finished last would write
// back its `readAt` - regressing the offset if it saw the smaller file.
const inFlightReads = new Map();

function rememberTranscript(filePath, entry) {
    // delete-then-set moves the key to the end: Map.set on an existing key
    // keeps its original insertion position, so without this the eviction
    // below would drop whatever was read FIRST rather than least recently.
    transcriptCache.delete(filePath);
    transcriptCache.set(filePath, entry);
    while (transcriptCache.size > TRANSCRIPT_CACHE_MAX) {
        const oldest = transcriptCache.keys().next().value;
        transcriptCache.delete(oldest);
    }
}

// Discard all cached transcript state, so a test starts from a cold cache.
function resetTranscriptCache() {
    transcriptCache.clear();
    inFlightReads.clear();
}

// Fold one parsed record into the running state: the newest real prompt.
// Shared by the first read and each incremental tail read so the two can
// never drift apart.
//
// The prompt is the SUM of the three input fields: input + cache_creation +
// cache_read. cache_read alone is only what was already cached before the
// turn, so it lags by one turn and collapses on a cache miss - ingest a large
// file and all of it lands in cache_creation. Measured 32K against a real
// 233K prompt in a live session (#54).
function foldRecord(entry, state) {
    // Synthetic and API-error turns carry a token count without being a real
    // prompt, and one would become the session's whole reported context.
    if (entry.isApiErrorMessage || entry.message?.model === '<synthetic>') return;
    // A subagent's turn describes the subagent's context, not this session's.
    // Claude Code keeps them in agent-*.jsonl, which the caller already filters
    // out by name, but a filename convention is not a contract and the flag is
    // free to honour.
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
        // Date.parse yields NaN on a missing or malformed stamp, which
        // `|| null` turns into "unknown". Consumed by the liveness gate in
        // getCurrentSessionUsage().
        lastActivity: Date.parse(entry.timestamp) || null,
    };
}

// Fold one transcript line. A torn or non-JSON line is not a record.
function foldLine(line, state) {
    if (line === null) return;
    let entry;
    try {
        entry = JSON.parse(line.toString('utf-8'));
    } catch (parseError) {
        return;
    }
    if (entry && typeof entry === 'object') foldRecord(entry, state);
}

// Transcripts are scanned in chunks, never decoded whole: a multi-day session
// outgrows the longest string V8 can hold, and decoding it throws.
const CHUNK_BYTES = 1024 * 1024;

// Longest line either scan assembles, past which the visitor gets null. Usage
// rides only on assistant turns, which the output cap keeps far shorter.
const MAX_LINE_BYTES = 16 * 1024 * 1024;

// Visit each complete line in [start, end) in order with the offset past it, until
// `visit` returns true. Returns the offset past the last line visited, so a partial
// trailing line waits for the next read. A visited Buffer is valid only during the call.
async function forEachLine(handle, start, end, visit) {
    const chunk = Buffer.alloc(Math.max(0, Math.min(CHUNK_BYTES, end - start)));
    let pieces = [];
    let pieceBytes = 0;
    let consumed = start;
    for (let pos = start; pos < end;) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, end - pos), pos);
        if (bytesRead === 0) break;
        const data = chunk.subarray(0, bytesRead);
        let from = 0;
        for (let nl = data.indexOf(0x0a); nl !== -1; nl = data.indexOf(0x0a, from)) {
            const tail = data.subarray(from, nl);
            let line = null;
            if (pieceBytes + tail.length <= MAX_LINE_BYTES) {
                line = pieces.length ? Buffer.concat([...pieces, tail]) : tail;
            }
            pieces = [];
            pieceBytes = 0;
            from = nl + 1;
            consumed = pos + from;
            if (visit(line, consumed)) return consumed;
        }
        if (from < bytesRead) {
            pieceBytes += bytesRead - from;
            // Copied, because the next read overwrites `chunk`.
            if (pieceBytes <= MAX_LINE_BYTES) pieces.push(Buffer.from(data.subarray(from)));
            else pieces = [];
        }
        pos += bytesRead;
    }
    return consumed;
}

// Visit complete lines in [0, end) newest first until `visit` returns true. The newest
// prompt is near the end, so JSON.parse stays off everything behind it. `end` must sit
// just past a newline, or the scan starts inside a partial line.
async function forEachLineBackward(handle, end, visit) {
    let pieces = [];
    let pieceBytes = 0;
    const emit = (head) => {
        let line = null;
        if (head.length + pieceBytes <= MAX_LINE_BYTES) {
            line = pieces.length ? Buffer.concat([head, ...pieces]) : head;
        }
        pieces = [];
        pieceBytes = 0;
        return visit(line);
    };
    for (let pos = end; pos > 0;) {
        const length = Math.min(CHUNK_BYTES, pos);
        pos -= length;
        const data = await readBytes(handle, pos, length);
        let stop = data.length;
        while (stop > 0) {
            const nl = data.lastIndexOf(0x0a, stop - 1);
            if (nl === -1) break;
            if (emit(data.subarray(nl + 1, stop))) return;
            stop = nl;
        }
        if (stop > 0) {
            pieceBytes += stop;
            if (pieceBytes <= MAX_LINE_BYTES) pieces.unshift(data.subarray(0, stop));
            else pieces = [];
        }
    }
    emit(Buffer.alloc(0));
}

// Offset just past the last newline in [0, size), or 0 when there is none. A
// transcript normally ends on a newline, so this is one small read.
const LAST_LINE_STEP_BYTES = 64 * 1024;

async function lastLineEnd(handle, size) {
    for (let pos = size; pos > 0;) {
        const length = Math.min(LAST_LINE_STEP_BYTES, pos);
        pos -= length;
        const nl = (await readBytes(handle, pos, length)).lastIndexOf(0x0a);
        if (nl !== -1) return pos + nl + 1;
    }
    return 0;
}

// The origin cwd from complete lines in [start, end) inside the head the directory
// scan probes, so the two agree on where a session started. Returns how far the
// probe got, CWD_PROBE_BYTES once the head is exhausted.
async function probeHeadCwd(handle, start, end) {
    let cwd = null;
    const probed = await forEachLine(handle, start, Math.min(end, CWD_PROBE_BYTES), (line) => {
        if (line !== null) cwd = firstRecordedCwd([line.toString('utf-8')]);
        return cwd !== null;
    });
    return { cwd, headBytes: end > CWD_PROBE_BYTES ? CWD_PROBE_BYTES : probed };
}

// How far in to look for the first line, and how much of the tail to hash.
// 1024 is the window Filebeat and FastForward fingerprint over, and a Claude
// Code transcript's first record sits well inside it.
const FINGERPRINT_BYTES = 1024;

// `head` is the file's identity, so it hashes the first LINE: a fixed byte window
// changes on every append while the file is shorter than it. A first line longer
// than the window is hashed as the window, and null (unterminated) means unknown.
async function readEdgeHashes(handle, size) {
    if (size <= 0) return { head: null, tail: 'empty' };

    const window = Math.min(FINGERPRINT_BYTES, size);
    const front = await readBytes(handle, 0, window);
    const firstNewline = front.indexOf(0x0a);
    let head = null;
    if (firstNewline !== -1) {
        head = createHash('sha1').update(front.subarray(0, firstNewline)).digest('hex');
    } else if (size > FINGERPRINT_BYTES) {
        head = createHash('sha1').update(front).digest('hex');
    }

    // A same-size rewrite inside one timestamp tick leaves size, mtime and inode
    // unchanged, so the last kilobyte is hashed too. consumedHash() covers the
    // window behind the read offset, and an edit further back than both goes unseen.
    const tail = createHash('sha1')
        .update(size <= window ? front : await readBytes(handle, size - window, window))
        .digest('hex');

    return { head, tail };
}

// Hash of the window ending at a read offset: the last bytes already folded
// in, which an append cannot touch and a rewrite almost always does. At the
// end of the file it is the tail hash, so the common case reads nothing more.
async function consumedHash(handle, readAt, size, edges) {
    if (readAt === size) return edges.tail;
    const start = Math.max(0, readAt - FINGERPRINT_BYTES);
    return createHash('sha1').update(await readBytes(handle, start, readAt - start)).digest('hex');
}

// Only the bytes actually read: a file truncated mid-scan returns short.
async function readBytes(handle, position, length) {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
}

// Windows can report ino/dev as 0 on some filesystems, in which case they
// carry no information and the first-line hash does the work on its own.
// Null when the first line is not terminated yet - there is no identity to
// compare, which is different from comparing and finding a mismatch.
function identityOf(stats, headHash) {
    if (!headHash) return null;
    return `${stats.dev || 0}:${stats.ino || 0}:${headHash}`;
}

// Parse a transcript's latest assistant prompt size into a session summary, or
// null if it has no usage yet. Reads only the bytes appended since the last call.
// A call arriving mid-read marks it dirty and shares its result, and a dirty read
// runs once more, so no caller gets an answer older than its own call.
async function readSessionUsage(filePath, log) {
    let flight = inFlightReads.get(filePath);
    if (flight) {
        flight.dirty = true;
    } else {
        flight = { dirty: false, done: null };
        flight.done = flyRead(filePath, log, flight);
        inFlightReads.set(filePath, flight);
    }
    const summary = await flight.done;
    return summary ? { ...summary } : null;
}

async function flyRead(filePath, log, flight) {
    try {
        let summary;
        do {
            flight.dirty = false;
            summary = await readTranscript(filePath, log);
        } while (flight.dirty);
        return summary;
    } finally {
        if (inFlightReads.get(filePath) === flight) inFlightReads.delete(filePath);
    }
}

// Cache what a read established and return a copy of the summary it yields.
async function remember(filePath, handle, stats, edges, identity, entry) {
    const summary = entry.state.latest
        ? { file: path.basename(filePath), ...entry.state.latest, cwd: entry.cwd }
        : null;
    rememberTranscript(filePath, {
        ...entry,
        identity,
        size: stats.size,
        tail: edges.tail,
        consumed: await consumedHash(handle, entry.readAt, stats.size, edges),
        summary,
    });
    return summary ? { ...summary } : null;
}

async function readTranscript(filePath, log) {
    let handle = null;
    try {
        // Stat through the handle, so a file replaced between the two calls
        // cannot pair one file's inode with another's bytes.
        handle = await fs.open(filePath, 'r');
        const stats = await handle.stat();
        const cached = transcriptCache.get(filePath);

        const edges = await readEdgeHashes(handle, stats.size);
        const identity = identityOf(stats, edges.head);

        // Same file. Only then does the cached byte offset mean anything.
        // Both sides must actually HAVE an identity - two nulls are two
        // unknowns, not a match.
        const sameFile = Boolean(cached && identity && cached.identity === identity);

        // The window behind the cached offset still holds the bytes already
        // folded in. An append cannot touch it, so a mismatch is a rewrite and
        // the cached offset points into a file that no longer exists.
        const consumedIntact = sameFile
            && stats.size >= cached.readAt
            && await consumedHash(handle, cached.readAt, stats.size, edges) === cached.consumed;

        // Same file, same length, same bytes at both ends of what was read:
        // nothing new. Re-filed as most recently used, so a transcript read on
        // every tick is never the one evicted.
        if (consumedIntact && stats.size === cached.size && edges.tail === cached.tail) {
            rememberTranscript(filePath, cached);
            return cached.summary ? { ...cached.summary } : null;
        }

        // Grew, and everything already consumed is still behind us: read only
        // the new bytes. A partial trailing line is re-read next time, whole.
        if (consumedIntact && stats.size >= cached.size) {
            const state = { latest: cached.state.latest };
            let { cwd, headBytes } = cached;
            const readAt = await forEachLine(handle, cached.readAt, stats.size, (line, lineEnd) => {
                if (cwd === null && headBytes < CWD_PROBE_BYTES) {
                    headBytes = Math.min(lineEnd, CWD_PROBE_BYTES);
                    if (line !== null && lineEnd <= CWD_PROBE_BYTES) {
                        cwd = firstRecordedCwd([line.toString('utf-8')]);
                    }
                }
                foldLine(line, state);
            });
            return await remember(filePath, handle, stats, edges, identity, {
                readAt, cwd, headBytes, resyncs: cached.resyncs, state,
            });
        }

        // Full read: first sight of this transcript, or it changed underneath us.
        // The new identity and hashes are stored below, so a settled file does not
        // resync again. No identity on one side means nothing to compare, not a resync.
        let why = null;
        if (cached && cached.identity && identity && cached.identity !== identity) {
            why = `changed identity (${cached.identity} -> ${identity})`;
        } else if (sameFile) {
            why = consumedIntact ? 'shrank' : 'was rewritten behind the read offset';
        }
        const resyncs = (cached ? cached.resyncs : 0) + (why ? 1 : 0);
        if (why && log) log(`${path.basename(filePath)} ${why} - re-reading in full (resync #${resyncs})`);

        // The session's origin cwd is its project. `cwd` moves (Bash `cd`, worktrees,
        // added directories), so the last turn's would misattribute a long session.
        const { cwd, headBytes } = await probeHeadCwd(handle, 0, stats.size);

        const readAt = await lastLineEnd(handle, stats.size);
        const state = { latest: null };
        await forEachLineBackward(handle, readAt, (line) => {
            foldLine(line, state);
            return state.latest !== null;
        });

        return await remember(filePath, handle, stats, edges, identity, {
            readAt, cwd, headBytes, resyncs, state,
        });
    } catch (readError) {
        if (log) log(`Error reading ${path.basename(filePath)}: ${readError.message}`);
        return null;
    } finally {
        if (handle) await handle.close().catch(() => {});
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

    async getProjectDataDirectory() {
        if (!this.workspacePath) {
            this.log('No workspace path set - no project directory');
            return null;
        }

        // A resolved directory is kept while it still exists, so a match on
        // recorded cwd does not re-scan every project directory each refresh.
        if (this.dirHit) {
            try {
                if ((await fs.stat(this.dirHit)).isDirectory()) return this.dirHit;
            } catch (statError) {
                // Gone - resolve again below.
            }
            this.dirHit = null;
        }

        const bases = await this.findClaudeDataDirectories();
        if (bases.length === 0) {
            return null;
        }

        // Throttle the fallback scan, not the lookup. The derived stats still
        // run every time, so a workspace's first session lights the gauge
        // straight away. Only the walk over every project directory is
        // rate-limited - this runs on the refresh timer and on every debounced
        // JSONL event.
        const missKey = `${bases.join(',')}|${this.workspacePath}`;
        const scannedRecently = this.dirMiss?.key === missKey
            && Date.now() - this.dirMiss.at < DIR_MISS_TTL_MS;

        // Every base by name before any by scan, so a leftover base listed
        // first cannot hide the live one.
        let resolved = await this.resolveInBases(bases, false);
        if (!resolved && !scannedRecently) resolved = await this.resolveInBases(bases, true);
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
        this.dirHit = resolved.dir;
        return resolved.dir;
    }

    async resolveInBases(bases, allowScan) {
        for (const baseDir of bases) {
            const resolved = await resolveProjectDir(baseDir, this.workspacePath, (m) => this.log(m), allowScan);
            if (resolved) return resolved;
        }
        return null;
    }

    getClaudeConfigPaths() {
        const paths = [];
        const homeDir = os.homedir();

        // The config dir itself, the ~/.claude equivalent, so transcripts sit
        // one level down.
        const envPath = process.env.CLAUDE_CONFIG_DIR;
        if (envPath) {
            paths.push(...envPath.split(',').map(p => p.trim()).filter(Boolean).map(p => path.join(p, 'projects')));
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

    // Every candidate location that exists, in search order.
    async findClaudeDataDirectories() {
        const found = [];
        for (const dirPath of new Set(this.claudeConfigPaths)) {
            try {
                if ((await fs.stat(dirPath)).isDirectory()) found.push(dirPath);
            } catch (error) {
                continue;
            }
        }
        return found;
    }

    async findClaudeDataDirectory() {
        const [first] = await this.findClaudeDataDirectories();
        if (!first) this.log('Could not find Claude data directory in any standard location');
        return first || null;
    }

    // Transcripts in the project directory itself. Claude Code keeps agent-*.jsonl
    // and tool results in a per-session subdirectory with thousands of files the
    // caller would discard, so the walk does not descend.
    async findJsonlFiles(dirPath) {
        const jsonlFiles = [];
        const seen = new Set();

        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.name.endsWith('.jsonl')) continue;
                const fullPath = path.join(dirPath, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- entry.name from fs.readdir is a bare filename (OS forbids separators); dirPath is an internal Claude data dir.

                // A symlinked transcript is followed: people link them (shared
                // session storage, GNU Stow dotfiles) and Claude Code stopped
                // following those in 2.1.104 (claude-code#51488, #46342).
                let isFile = entry.isFile();
                if (entry.isSymbolicLink()) {
                    try {
                        isFile = (await fs.stat(fullPath)).isFile();
                    } catch (linkError) {
                        continue;  // dangling link
                    }
                }

                if (isFile) {
                    // Deduplicate on the resolved path, or a link to a transcript we
                    // already have counts as a second live session.
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
            this.log(`Error reading directory ${dirPath}: ${error.message}`);
        }

        return jsonlFiles;
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
    // worktree or another repo - 4% of a 141-transcript store, and the biggest
    // ones at that.
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
                    isActive: false,
                    activeSessionCount: 0
                };
            }

            // Live = a PROMPT written inside the live window. Show the one
            // consuming the most context; see selectActiveSession.
            //
            // mtime is the cheap pre-filter, not the answer. It cannot
            // under-include - an append always bumps it, so an old mtime never
            // hides a new prompt - but it over-includes freely: reading a
            // transcript without appending to it (the --resume picker
            // enumerating sessions, any tool opening one) moves mtime on a
            // conversation that ended days ago. Only the timestamp on the
            // newest prompt establishes that someone is using the session.
            const liveCutoff = Date.now() - windowMs;
            const touchedFiles = relevantFiles.filter(f => f.modified >= liveCutoff);

            const ours = await this.makeSessionFilter();

            const liveSessions = [];
            let staleCount = 0;
            for (const f of touchedFiles) {
                const s = await readSessionUsage(f.path, (m) => this.log(m));
                if (!s || !(await ours(s))) continue;
                // Unknown stamp falls back to mtime rather than dropping the
                // session: an unparseable or future transcript shape must not
                // blank the gauge.
                if (s.lastActivity !== null && s.lastActivity < liveCutoff) {
                    staleCount++;
                    continue;
                }
                liveSessions.push(s);
            }
            this.log(`${liveSessions.length} live (${Math.round(windowMs / 60000)}min) of ${touchedFiles.length} touched, ${relevantFiles.length} in-deck, ${allFiles.length} total`);
            if (staleCount > 0) {
                this.log(`   ${staleCount} touched but stale: mtime fresh, newest prompt older than the window`);
            }

            let { active, activeSessionCount } = selectActiveSession(liveSessions);
            let agedOut = false;

            if (!active) {
                // Nothing live with usage. Fall back to the most-recent session
                // still inside the hard deck - last-known context, not a blank.
                // Same content-timestamp rule as the live gate: a transcript
                // whose newest prompt predates the deck is dead however
                // recently something touched the file.
                for (const f of relevantFiles) {
                    const s = await readSessionUsage(f.path, (m) => this.log(m));
                    if (!s || !(await ours(s))) continue;
                    if (s.lastActivity !== null && s.lastActivity < hardDeckCutoff) continue;
                    active = s;
                    activeSessionCount = 1;
                    agedOut = true;
                    break;
                }
            }

            const modelIds = active && active.model ? [active.model] : [];

            if (active) {
                this.log(`Showing ${agedOut ? 'latest aged-out' : 'highest-consumption live'} session: ${active.file}`);
                this.log(`   Model: ${active.model || 'none'} | context: ${active.contextTotal.toLocaleString()}`);
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
                isActive: !!active,
                activeSessionCount: activeSessionCount,
                modelIds: modelIds,
            };

        } catch (error) {
            this.log(`Error getting current session usage: ${error.message}`);
            return {
                totalTokens: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheCreationTokens: 0,
                cacheReadTokens: 0,
                isActive: false,
                activeSessionCount: 0
            };
        }
    }
}

module.exports = {
    ClaudeDataLoader,
    selectActiveSession,
    readSessionUsage,
    resetTranscriptCache,
    TRANSCRIPT_CACHE_MAX,
};
