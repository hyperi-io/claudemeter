// Project:   Claudemeter
// File:      projectDir.js
// Purpose:   Locate a workspace's ~/.claude/projects/<dir> transcript directory
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED
//
// Two layers:
//
//   1. NAMING     - port of Claude Code's directory-naming function. Pure, no
//                   I/O, right nearly always.
//   2. RESOLUTION - find it on disk. Derived name first, then match the cwd
//                   Claude Code recorded inside its own transcripts.
//
// Layer 2 exists because layer 1 guesses at someone else's internals.
// Enumerating the characters to replace instead of applying the rule cost us
// four rounds of the same bug - drive-letter colon, spaces (#43), underscores
// (#52), non-ASCII (#53). A miss blanks Tk for the whole window while Se/Wk
// keep working, so it reads as a display bug rather than a path bug.

const fs = require('fs').promises;
const path = require('path');

// ---------------------------------------------------------------------------
// Layer 1: the naming rule
// ---------------------------------------------------------------------------

// From the installed CLI bundle, confirmed against every directory in a real
// ~/.claude/projects:
//
//     function Dw(e) {
//         let t = e.replace(/[^a-zA-Z0-9]/g, "-");
//         if (t.length <= dBt) return t;              // dBt = 200
//         return `${t.slice(0, dBt)}-${wim(e)}`;      // hash of the ORIGINAL
//     }
//     function wim(e) { return Math.abs(f7e(e)).toString(36) }
//     function f7e(e) {
//         let t = 0;
//         for (let r = 0; r < e.length; r++) t = (t << 5) - t + e.charCodeAt(r) | 0;
//         return t;
//     }
const DEFAULT_MAX_DIR_NAME_LENGTH = 200;

// Separators, dots, underscores and every non-ASCII character alike.
const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/g;

// Claude Code's string hash - `h * 31 + c` wrapped to int32 each step. Only
// disambiguates truncated names, so it has to match upstream bit for bit.
function hashPath(workspacePath) {
    let hash = 0;
    for (let i = 0; i < workspacePath.length; i++) {
        hash = (hash << 5) - hash + workspacePath.charCodeAt(i) | 0;
    }
    return hash;
}

// Derive the directory name Claude Code uses for a workspace path. Expects an
// already-canonical path - see canonicalisePath().
//
// The regex has no `u` flag, matching upstream, so it walks UTF-16 code units.
// A non-BMP character is a surrogate pair and becomes TWO dashes. Adding `u`
// would give one and miss the directory.
function projectDirName(workspacePath, maxLength = DEFAULT_MAX_DIR_NAME_LENGTH) {
    const dashed = workspacePath.replace(NON_ALPHANUMERIC, '-');
    if (dashed.length <= maxLength) {
        return dashed;
    }
    // Hash of the ORIGINAL path, not the truncated one - otherwise two paths
    // sharing a 200-char prefix collide onto one directory.
    return `${dashed.slice(0, maxLength)}-${Math.abs(hashPath(workspacePath)).toString(36)}`;
}

// Claude Code stores its cwd as `cwd.normalize("NFC")` before deriving the
// name. macOS hands paths back decomposed (NFD), and the two spellings of one
// word give different names: composed, the whole letter is non-ASCII and
// becomes one dash (`caf-`); decomposed, the base letter is ASCII and survives
// while only the mark becomes a dash (`cafe-`). Skip this and every accented
// path misses on macOS.
//
// Split out from canonicalisePath() because it needs no I/O - callers with
// only a synchronous moment (a constructor) still get most of the benefit.
function normaliseUnicode(workspacePath) {
    return workspacePath.normalize('NFC');
}

// Same directory?
//
// Case- and separator-insensitive on Windows only. VS Code's `uri.fsPath`
// lower-cases the drive letter while PowerShell, cmd and the Git Bash
// translator report it upper-case, and one session's recorded cwd has been
// seen oscillating between the two as shell calls report the real casing back
// (claude-code#75855, #62288, #76994). realpath settles separators for a path
// that exists, but a deleted worktree comes back as the raw recorded string.
//
// Case-SENSITIVE elsewhere on purpose. A case-sensitive macOS volume is legal
// and there `/Foo` and `/foo` are two projects - folding case would risk
// attributing one project's context to another.
function pathsEqual(a, b) {
    if (a === b) return true;
    if (process.platform !== 'win32') return false;
    return a.toLowerCase().replace(/\//g, '\\') === b.toLowerCase().replace(/\//g, '\\');
}

// Resolve symlinks, then normalise.
//
// Claude Code realpaths before deriving - verified by running the CLI from a
// symlinked directory and watching the transcript land in the target's folder.
// A workspace opened via a symlink (`/projects` -> `/Volumes/projects`) would
// otherwise derive a directory that does not exist.
//
// An unresolvable path (deleted, permission denied, a remote URI) is
// normalised and returned as-is. A best-effort name beats no name.
async function canonicalisePath(workspacePath) {
    try {
        return normaliseUnicode(await fs.realpath(workspacePath));
    } catch (error) {
        return normaliseUnicode(workspacePath);
    }
}

// ---------------------------------------------------------------------------
// Layer 2: resolution
// ---------------------------------------------------------------------------

// Probe window for finding a transcript's `cwd`. Sized from a measured store
// (141 transcripts, 2026-07-20): the first cwd-bearing entry sat at a median
// of ~1.9KB, a p90 of ~19KB and a max of ~217KB, because the first entry
// carries the whole system prompt and any always-loaded project context. A
// 16KB window missed 21% of them. The window has to clear the tail, not the
// median. Re-measure before shrinking it.
const CWD_PROBE_BYTES = 262144;

// Transcripts to open per candidate directory. Bounds the work of the scan:
// each probe reads up to CWD_PROBE_BYTES, and the scan walks every project
// directory. One transcript usually settles a directory.
const MAX_CWD_PROBES_PER_DIR = 8;

// First cwd recorded in a set of transcript lines, or null.
//
// Shared so the two halves of the attribution cannot drift: the directory
// scan matches on this field, and claudeDataLoader's per-session filter
// rejects on it. If one side changed which entry it trusted, the scan would
// pick a directory whose sessions the filter then threw away, and Tk would
// blank with the right directory in hand.
function firstRecordedCwd(lines) {
    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            if (typeof entry.cwd === 'string' && entry.cwd) return entry.cwd;
        } catch (parseError) {
            continue;
        }
    }
    return null;
}

// Working directory Claude Code recorded in a transcript, or null. Reads a
// bounded head, never the whole file - these run to tens of megabytes.
async function readRecordedCwd(filePath) {
    let handle = null;
    try {
        handle = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(CWD_PROBE_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, CWD_PROBE_BYTES, 0);
        const text = buffer.toString('utf-8', 0, bytesRead);
        const lines = text.split('\n');
        // Drop a line the window cut mid-JSON. A file exactly the probe size
        // ends on a real boundary, so test the newline, not the byte count.
        if (bytesRead === CWD_PROBE_BYTES && !text.endsWith('\n')) {
            lines.pop();
        }
        return firstRecordedCwd(lines);
    } catch (readError) {
        return null;
    } finally {
        if (handle) await handle.close().catch(() => {});
    }
}

// The project directory whose transcripts record OUR workspace as their cwd.
// Newest first, so the common case exits after a read or two.
//
// An EXACT match on the canonical path, never a "most recent session" guess,
// so it can only return this workspace's own directory.
async function findDirByRecordedCwd(baseDir, canonicalWorkspacePath, log = null) {
    let entries;
    try {
        entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch (error) {
        return null;
    }

    const candidates = [];
    for (const entry of entries) {
        // Not `entry.isDirectory()` alone. A Dirent does not follow symlinks,
        // and people symlink project directories - shared session storage
        // between accounts, GNU Stow dotfiles. Claude Code stopped following
        // those in 2.1.104 and users lost sessions (claude-code#51488, #46342).
        // The stat below does follow, so let it decide.
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const dir = path.join(baseDir, entry.name); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- entry.name from fs.readdir is a bare filename (the OS forbids separators); baseDir is an internal Claude data dir.
        try {
            const stat = await fs.stat(dir);
            if (!stat.isDirectory()) continue;
            candidates.push({ dir, modified: stat.mtimeMs });
        } catch (statError) {
            continue;
        }
    }
    candidates.sort((a, b) => b.modified - a.modified);

    for (const candidate of candidates) {
        let files;
        try {
            files = (await fs.readdir(candidate.dir)).filter(f => f.endsWith('.jsonl'));
        } catch (error) {
            continue;
        }
        // Every OPEN counts against the cap, not just the ones that yield a
        // cwd. Counting only successes leaves the work unbounded - a directory
        // of quiet transcripts would be read in full at CWD_PROBE_BYTES each.
        let probed = 0;
        for (const file of files) {
            if (probed >= MAX_CWD_PROBES_PER_DIR) {
                if (log) log(`   ${path.basename(candidate.dir)}: stopped after ${probed} of ${files.length} transcripts`);
                break;
            }
            probed++;
            const recorded = await readRecordedCwd(path.join(candidate.dir, file)); // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- file from fs.readdir is a bare filename; candidate.dir is an internal Claude data dir.
            if (!recorded) continue;
            if (pathsEqual(await canonicalisePath(recorded), canonicalWorkspacePath)) {
                if (log) log(`   Matched by recorded cwd: ${candidate.dir}`);
                return candidate.dir;
            }
            // Keep going. The encoding is lossy - `my-api`, `my/api`, `my_api`
            // and `work-my/api` all name the SAME directory
            // (claude-code#19972) - so one folder can hold several unrelated
            // projects and the first transcript read may be a neighbour's.
        }
    }
    return null;
}

// Resolve a workspace path to its Claude project directory, or null.
//
// Returns { dir, name, method }. method 'recorded-cwd' means the naming rule
// missed and the transcripts settled it - worth an issue, the rule has drifted.
// allowScan false skips the fallback walk and keeps only the cheap stats.
async function resolveProjectDir(baseDir, workspacePath, log = null, allowScan = true) {
    if (!baseDir || !workspacePath) return null;

    const canonical = await canonicalisePath(workspacePath);

    // Two candidates, physical first. Claude Code is not consistent about
    // which it uses - `process.cwd()` resolves through symlinks, `$PWD` does
    // not, and sessions exist under each (claude-code#72049, #74043, and
    // #71224 where the VS Code extension host and the CLI subprocess resolved
    // one NTFS junction differently and never saw each other's data).
    // Anthropic fixed one shape of this in 2.1.50 and it came back in another.
    // Trying both costs one stat.
    const candidateNames = [projectDirName(canonical)];
    const logicalName = projectDirName(normaliseUnicode(workspacePath));
    if (logicalName !== candidateNames[0]) candidateNames.push(logicalName);

    for (const name of candidateNames) {
        const derived = path.join(baseDir, name);
        try {
            const stat = await fs.stat(derived);
            if (stat.isDirectory()) {
                return { dir: derived, name, method: 'derived' };
            }
        } catch (error) {
            continue;
        }
    }

    if (!allowScan) return null;

    if (log) log(`   Derived directory not present (${candidateNames.join(', ')}) - matching on recorded cwd`);
    const matched = await findDirByRecordedCwd(baseDir, canonical, log);
    if (matched) {
        return { dir: matched, name: path.basename(matched), method: 'recorded-cwd' };
    }
    return null;
}

module.exports = {
    projectDirName,
    firstRecordedCwd,
    hashPath,
    normaliseUnicode,
    pathsEqual,
    canonicalisePath,
    readRecordedCwd,
    findDirByRecordedCwd,
    resolveProjectDir,
    DEFAULT_MAX_DIR_NAME_LENGTH,
    CWD_PROBE_BYTES,
};
