// Regression tests for convertPathToClaudeDir() - the workspace-path
// to Claude-project-directory translator. The Windows variant has bitten
// us once already (the colon was being dropped, producing a single dash
// where Claude Code uses two - see fix(windows): drive-letter colon ->
// dash). These tests pin the exact mapping so the same regression can't
// silently come back the next time someone touches that function.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { ClaudeDataLoader, selectActiveSession, readSessionUsage } = require('../../src/claudeDataLoader');

describe('ClaudeDataLoader.convertPathToClaudeDir', () => {
    // Use a single instance - the method is pure with respect to its
    // argument, so we don't need a fresh loader per case.
    const loader = new ClaudeDataLoader(null, () => {});

    describe('Windows paths', () => {
        it('maps drive-letter colon AND backslash to dashes (lower-case drive)', () => {
            // Real example from the bug report: VS Code workspace at
            // c:\Projects\claudemeter must resolve to Claude's
            // c--Projects-claudemeter dir, not c-Projects-claudemeter.
            expect(loader.convertPathToClaudeDir('c:\\Projects\\claudemeter'))
                .toBe('c--Projects-claudemeter');
        });

        it('preserves drive-letter case', () => {
            expect(loader.convertPathToClaudeDir('C:\\Users\\alice\\repo'))
                .toBe('C--Users-alice-repo');
        });

        it('handles Windows-style paths written with forward slashes', () => {
            // Some tooling normalises Windows paths to forward slashes
            // (Git Bash, MSYS2, JS path handling). Result should match
            // the backslash form.
            expect(loader.convertPathToClaudeDir('c:/Projects/claudemeter'))
                .toBe('c--Projects-claudemeter');
        });

        it('handles UNC paths without losing the leading separator', () => {
            // \\server\share\proj -> -server-share-proj (no colon to map)
            expect(loader.convertPathToClaudeDir('\\\\server\\share\\proj'))
                .toBe('--server-share-proj');
        });
    });

    describe('Unix paths', () => {
        it('maps forward slashes to dashes', () => {
            expect(loader.convertPathToClaudeDir('/home/derek/proj'))
                .toBe('-home-derek-proj');
        });

        it('handles macOS-style nested paths', () => {
            expect(loader.convertPathToClaudeDir('/Users/derek/Code/claudemeter'))
                .toBe('-Users-derek-Code-claudemeter');
        });

        it('leaves paths without separators alone except for any colons', () => {
            expect(loader.convertPathToClaudeDir('plainname')).toBe('plainname');
        });
    });

    describe('edge cases', () => {
        it('maps spaces to dashes (Claude Code dashes them too)', () => {
            // Claude Code converts spaces to dashes when naming the project
            // dir, so we must too or the lookup misses and the gauge shows
            // Tk -. #43
            expect(loader.convertPathToClaudeDir('c:\\My Projects\\thing'))
                .toBe('c--My-Projects-thing');
        });

        it('handles trailing separators', () => {
            expect(loader.convertPathToClaudeDir('c:\\Projects\\'))
                .toBe('c--Projects-');
        });
    });
});

describe('selectActiveSession', () => {
    it('picks the largest live session, not the newest', () => {
        // concurrent sub-agent work: the heavy 181k orchestrator wins over a
        // small 21k sub-task, regardless of order
        const { active, activeSessionCount } = selectActiveSession([
            { file: 'new', contextTotal: 21000 },
            { file: 'old', contextTotal: 181000 },
        ]);
        expect(active.file).toBe('old');
        expect(active.contextTotal).toBe(181000);
        expect(activeSessionCount).toBe(2);
    });

    it('skips leading transcripts with no usage', () => {
        const { active, activeSessionCount } = selectActiveSession([
            { file: 'fresh', contextTotal: 0 },
            { file: 'real', contextTotal: 50000 },
        ]);
        expect(active.file).toBe('real');
        expect(activeSessionCount).toBe(1);
    });

    it('null active when nothing has usage', () => {
        expect(selectActiveSession([{ contextTotal: 0 }]).active).toBeNull();
        expect(selectActiveSession([]).active).toBeNull();
        expect(selectActiveSession(null).activeSessionCount).toBe(0);
    });

    it('ranks on the full prompt, not on cache_read', () => {
        // #54. A session that just took a cache miss reports a small cache_read
        // and a huge cache_creation. Ranking on cache_read would hand the gauge
        // to the smaller session and understate the context by 5x or more.
        const { active } = selectActiveSession([
            { file: 'steady', contextTotal: 90000, cacheRead: 89000, cacheCreation: 1000 },
            { file: 'just-missed-cache', contextTotal: 233456, cacheRead: 32167, cacheCreation: 201287 },
        ]);
        expect(active.file).toBe('just-missed-cache');
    });
});

describe('readSessionUsage - context accounting (#54)', () => {
    let dir;

    const write = async (name, usage, extra = {}) => {
        const file = path.join(dir, name);
        await fsp.writeFile(file, JSON.stringify({
            type: 'assistant',
            cwd: '/some/project',
            message: { model: 'claude-opus-4-8', usage },
            ...extra,
        }) + '\n', 'utf-8');
        return file;
    };

    beforeAll(async () => {
        dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claudemeter-usage-'));
    });

    afterAll(async () => {
        if (dir) await fsp.rm(dir, { recursive: true, force: true });
    });

    it('sums input + cache_creation + cache_read', async () => {
        // Real numbers from a live transcript. cache_read alone reports 87427
        // against a true prompt of 89637.
        const file = await write('steady.jsonl', {
            input_tokens: 2,
            cache_creation_input_tokens: 2208,
            cache_read_input_tokens: 87427,
            output_tokens: 500,
        });
        const s = await readSessionUsage(file);
        expect(s.contextTotal).toBe(89637);
        expect(s.cacheRead).toBe(87427);
    });

    it('holds steady across a cache miss instead of collapsing', async () => {
        // The failure that made the gauge look like it had switched sessions:
        // cache_read stuck at 32167 while the real prompt climbed to 233456.
        const file = await write('miss.jsonl', {
            input_tokens: 2,
            cache_creation_input_tokens: 201287,
            cache_read_input_tokens: 32167,
            output_tokens: 900,
        });
        const s = await readSessionUsage(file);
        expect(s.contextTotal).toBe(233456);
    });

    it('counts a first turn with no cache read at all', async () => {
        // cache_read 0 with a full-size cache_creation is what a fresh session
        // or a hard cache invalidation looks like. Gating liveness on
        // cache_read made these sessions invisible - Tk showed nothing at all.
        const file = await write('firstturn.jsonl', {
            input_tokens: 3190,
            cache_creation_input_tokens: 47738,
            cache_read_input_tokens: 0,
            output_tokens: 120,
        });
        const s = await readSessionUsage(file);
        expect(s).not.toBeNull();
        expect(s.contextTotal).toBe(50928);
    });

    it('treats missing usage fields as zero', async () => {
        const file = await write('sparse.jsonl', { input_tokens: 1234, output_tokens: 10 });
        const s = await readSessionUsage(file);
        expect(s.contextTotal).toBe(1234);
        expect(s.cacheRead).toBe(0);
        expect(s.cacheCreation).toBe(0);
    });

    it('returns null for a zero-token entry, a file with no assistant turn, and a missing file', async () => {
        const zero = await write('zero.jsonl', {
            input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0,
        });
        expect(await readSessionUsage(zero)).toBeNull();

        const userOnly = path.join(dir, 'useronly.jsonl');
        await fsp.writeFile(userOnly, JSON.stringify({ type: 'user', cwd: '/x' }) + '\n', 'utf-8');
        expect(await readSessionUsage(userOnly)).toBeNull();

        expect(await readSessionUsage(path.join(dir, 'ghost.jsonl'))).toBeNull();
    });

    it('reports the LATEST assistant turn, not the first', async () => {
        const file = path.join(dir, 'multi.jsonl');
        const turn = (cr) => JSON.stringify({
            type: 'assistant',
            cwd: '/some/project',
            message: { model: 'claude-opus-4-8', usage: { input_tokens: 1, cache_read_input_tokens: cr, output_tokens: 1 } },
        });
        await fsp.writeFile(file, [turn(1000), turn(50000)].join('\n') + '\n', 'utf-8');
        const s = await readSessionUsage(file);
        expect(s.contextTotal).toBe(50001);
    });

    it('carries the cwd through for per-session attribution', async () => {
        const file = await write('attributed.jsonl', { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 1 });
        expect((await readSessionUsage(file)).cwd).toBe('/some/project');
    });

    it('skips synthetic and API-error turns, reporting the last real one', async () => {
        // These carry a token count without representing a real prompt. Left
        // in, one of them becomes the session's whole reported context and the
        // gauge collapses to a few tokens.
        const real = JSON.stringify({
            type: 'assistant',
            cwd: '/some/project',
            message: { model: 'claude-opus-4-8', usage: { input_tokens: 2, cache_read_input_tokens: 120000, output_tokens: 5 } },
        });
        const synthetic = JSON.stringify({
            type: 'assistant',
            message: { model: '<synthetic>', usage: { input_tokens: 5, cache_read_input_tokens: 10, output_tokens: 1 } },
        });
        const apiError = JSON.stringify({
            type: 'assistant',
            isApiErrorMessage: true,
            message: { model: 'claude-opus-4-8', usage: { input_tokens: 7, cache_read_input_tokens: 0, output_tokens: 1 } },
        });

        const file = path.join(dir, 'noise.jsonl');
        await fsp.writeFile(file, [real, synthetic, apiError].join('\n') + '\n', 'utf-8');
        expect((await readSessionUsage(file)).contextTotal).toBe(120002);

        const onlyNoise = path.join(dir, 'onlynoise.jsonl');
        await fsp.writeFile(onlyNoise, [synthetic, apiError].join('\n') + '\n', 'utf-8');
        expect(await readSessionUsage(onlyNoise)).toBeNull();
    });
});

describe('readSessionUsage - session attribution by origin cwd', () => {
    let dir;

    // A session that starts in the workspace and wanders: a Bash `cd`, a
    // worktree, a turn in another repo. The LAST entry's cwd is not where the
    // session belongs.
    const wandering = (start, end) => [
        JSON.stringify({ type: 'user', cwd: start }),
        JSON.stringify({
            type: 'assistant', cwd: start,
            message: { model: 'claude-opus-4-8', usage: { input_tokens: 2, cache_read_input_tokens: 100000, output_tokens: 5 } },
        }),
        JSON.stringify({ type: 'user', cwd: end }),
        JSON.stringify({
            type: 'assistant', cwd: end,
            message: { model: 'claude-opus-4-8', usage: { input_tokens: 2, cache_read_input_tokens: 200000, output_tokens: 5 } },
        }),
    ].join('\n') + '\n';

    beforeAll(async () => {
        dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claudemeter-attrib-'));
    });

    afterAll(async () => {
        if (dir) await fsp.rm(dir, { recursive: true, force: true });
    });

    it('reports where the session STARTED, not where it ended', async () => {
        // On a real store, 28% of transcripts record more than one cwd and one
        // records 24. Attributing on the last cwd drops the session from its
        // own project and blanks the gauge - including sessions carrying most
        // of a million tokens of context.
        const file = path.join(dir, 'wandered.jsonl');
        await fsp.writeFile(file, wandering('/repo', '/repo/.worktrees/spike'), 'utf-8');
        const s = await readSessionUsage(file);
        expect(s.cwd).toBe('/repo');
        expect(s.contextTotal).toBe(200002);   // usage still comes from the LAST turn
    });

    it('finds the origin cwd on a user entry before any assistant turn', async () => {
        const file = path.join(dir, 'userfirst.jsonl');
        await fsp.writeFile(file, wandering('/repo', '/elsewhere'), 'utf-8');
        expect((await readSessionUsage(file)).cwd).toBe('/repo');
    });

    it('is null when no entry records a cwd', async () => {
        const file = path.join(dir, 'nocwd.jsonl');
        await fsp.writeFile(file, JSON.stringify({
            type: 'assistant',
            message: { model: 'claude-opus-4-8', usage: { input_tokens: 1, cache_read_input_tokens: 9, output_tokens: 1 } },
        }) + '\n', 'utf-8');
        expect((await readSessionUsage(file)).cwd).toBeNull();
    });
});

describe('makeSessionFilter', () => {
    // Guards against a directory holding sessions from more than one project.
    // Claude Code's directory encoding is lossy, so /work/my-api, /work/my/api
    // and /work/my_api all land in the same folder (claude-code#19972).
    const filterFor = async (workspace) => {
        const loader = new ClaudeDataLoader(workspace, () => {});
        return loader.makeSessionFilter();
    };

    it('keeps a session that started in this workspace', async () => {
        const ours = await filterFor('/repo');
        expect(await ours({ file: 'a', cwd: '/repo' })).toBe(true);
    });

    it('drops a session that started in a different project', async () => {
        const ours = await filterFor('/repo');
        expect(await ours({ file: 'b', cwd: '/other-repo' })).toBe(false);
    });

    it('keeps a session with no recorded cwd', async () => {
        // Permissive on missing data. Blanking the gauge because a transcript
        // did not parse is worse than the rare over-inclusion.
        const ours = await filterFor('/repo');
        expect(await ours({ file: 'c', cwd: null })).toBe(true);
    });

    it('keeps everything when no workspace is set', async () => {
        const ours = await filterFor(null);
        expect(await ours({ file: 'd', cwd: '/anywhere' })).toBe(true);
    });

    it('is not fooled by a prefix that is not a path boundary', async () => {
        // /repo-backup starts with /repo but is a different project.
        const ours = await filterFor('/repo');
        expect(await ours({ file: 'e', cwd: '/repo-backup' })).toBe(false);
    });
});

describe('findJsonlFiles - symlink handling', () => {
    let base;
    let proj;

    beforeAll(async () => {
        base = await fsp.mkdtemp(path.join(os.tmpdir(), 'claudemeter-links-'));
        proj = path.join(base, 'proj');
        const sub = path.join(proj, 'sub');
        await fsp.mkdir(sub, { recursive: true });
        await fsp.writeFile(path.join(proj, 'a.jsonl'), '{}\n', 'utf-8');
        await fsp.writeFile(path.join(sub, 'real.jsonl'), '{}\n', 'utf-8');
        // A transcript reached through a link - shared session storage, GNU
        // Stow dotfiles (claude-code#51488, #46342).
        await fsp.symlink(path.join(base, 'outside.jsonl'), path.join(proj, 'linked.jsonl'));
        await fsp.writeFile(path.join(base, 'outside.jsonl'), '{}\n', 'utf-8');
        // Two directory links back to an ancestor.
        await fsp.symlink(proj, path.join(proj, 'loopA'), 'dir');
        await fsp.symlink(proj, path.join(sub, 'loopB'), 'dir');
        await fsp.symlink(path.join(base, 'gone'), path.join(proj, 'dangling.jsonl'));
    });

    afterAll(async () => {
        if (base) await fsp.rm(base, { recursive: true, force: true });
    });

    it('terminates on a symlink cycle instead of hanging', async () => {
        // Recursing through linked directories spins until the kernel symlink
        // limit - measured at 70k+ readdir calls and 255MB RSS without
        // returning, which freezes the refresh timer and the extension host.
        const loader = new ClaudeDataLoader(proj, () => {});
        const files = await Promise.race([
            loader.findJsonlFiles(proj),
            new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 5000)),
        ]);
        expect(Array.isArray(files)).toBe(true);
    });

    it('follows a symlinked transcript but not a symlinked directory', async () => {
        const loader = new ClaudeDataLoader(proj, () => {});
        const names = (await loader.findJsonlFiles(proj)).map(f => path.basename(f)).sort();
        expect(names).toContain('linked.jsonl');
        expect(names).toContain('a.jsonl');
        expect(names).toContain('real.jsonl');
    });

    it('returns each transcript once, however many links point at it', async () => {
        // Duplicates would each be counted as another live session.
        const loader = new ClaudeDataLoader(proj, () => {});
        const files = await loader.findJsonlFiles(proj);
        const resolved = files.map(f => fs.realpathSync(f));
        expect(new Set(resolved).size).toBe(resolved.length);
    });

    it('skips a dangling link', async () => {
        const loader = new ClaudeDataLoader(proj, () => {});
        const names = (await loader.findJsonlFiles(proj)).map(f => path.basename(f));
        expect(names).not.toContain('dangling.jsonl');
    });
});

describe('getCurrentSessionUsage - no workspace (empty VS Code window)', () => {
    // Regression: an empty window (no workspace) must NOT show another
    // project's context. With no workspace the Tk gauge stays blank - the
    // loader returns inactive early, before any filesystem/global search.
    it('returns inactive without touching the filesystem', async () => {
        const loader = new ClaudeDataLoader(null, () => {});
        const usage = await loader.getCurrentSessionUsage();
        expect(usage.isActive).toBe(false);
        expect(usage.totalTokens).toBe(0);
        expect(usage.cacheReadTokens).toBe(0);
    });
});
