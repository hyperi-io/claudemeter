// Tests for src/projectDir.js - locating a workspace's Claude transcript
// directory.
//
// This has been wrong four separate times in production (the Windows
// drive-letter colon, spaces #43, underscores #52, non-ASCII #53). Every miss
// blanks the Tk gauge for the whole VS Code window while Se/Wk keep working, so
// it does not look like a path bug. These cases pin the rule character class by
// character class rather than example by example - example by example is how we
// got here.
//
// Every non-ASCII string below is written as an escape, never a pasted glyph.
// The point of those cases is the exact code-unit count, and two spellings of
// the same word can look identical on screen while naming different
// directories. An escape says which one we mean.
//
// The resolution tests use real files in a real temp directory, not a mocked
// fs. The whole point of the fallback is that it reads what Claude Code
// actually wrote, and a mock would only re-assert our own assumptions.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const {
    projectDirName,
    hashPath,
    normaliseUnicode,
    canonicalisePath,
    readRecordedCwd,
    findDirByRecordedCwd,
    resolveProjectDir,
    DEFAULT_MAX_DIR_NAME_LENGTH,
    CWD_PROBE_BYTES,
} = require('../../src/projectDir');

// U+00E9. 'cafe' + this is the composed (NFC) spelling - one code unit.
const E_ACUTE = '\u00E9';
// U+0301. 'cafe' + this is the decomposed (NFD) spelling - two code units,
// which is what macOS filesystems hand back.
const COMBINING_ACUTE = '\u0301';

describe('projectDirName - separators', () => {
    it('maps the Windows drive-letter colon AND backslash, both to dashes', () => {
        // c:\Projects\claudemeter -> c--Projects-claudemeter, not
        // c-Projects-claudemeter. An early version dropped the colon.
        expect(projectDirName('c:\\Projects\\claudemeter')).toBe('c--Projects-claudemeter');
    });

    it('preserves drive-letter case', () => {
        expect(projectDirName('C:\\Users\\alice\\repo')).toBe('C--Users-alice-repo');
    });

    it('treats forward-slash Windows paths the same as backslash ones', () => {
        // Git Bash, MSYS2 and JS path handling all normalise this way.
        expect(projectDirName('c:/Projects/claudemeter')).toBe('c--Projects-claudemeter');
    });

    it('keeps both leading separators of a UNC path', () => {
        expect(projectDirName('\\\\server\\share\\proj')).toBe('--server-share-proj');
    });

    it('maps Unix forward slashes', () => {
        expect(projectDirName('/home/derek/proj')).toBe('-home-derek-proj');
    });

    it('leaves a bare alphanumeric name untouched', () => {
        expect(projectDirName('plainname')).toBe('plainname');
    });

    it('keeps a trailing separator as a trailing dash', () => {
        expect(projectDirName('c:\\Projects\\')).toBe('c--Projects-');
    });
});

describe('projectDirName - punctuation', () => {
    // Each of these was, or would have been, its own bug report under the old
    // enumerate-the-characters approach.
    it('maps spaces (#43)', () => {
        expect(projectDirName('c:\\My Projects\\thing')).toBe('c--My-Projects-thing');
    });

    it('maps underscores (#52)', () => {
        expect(projectDirName('c:\\dev\\hoopy_frood')).toBe('c--dev-hoopy-frood');
    });

    it('maps dots, so a dotfile directory doubles the dash', () => {
        // Verified against a real ~/.claude/projects:
        // /Users/derek/.local/share/hyperi-ai -> -Users-derek--local-share-hyperi-ai
        expect(projectDirName('/Users/derek/.local/share/hyperi-ai'))
            .toBe('-Users-derek--local-share-hyperi-ai');
    });

    it('maps every other ASCII punctuation mark that is legal in a path', () => {
        for (const ch of ['.', '+', '#', '@', '~', '&', '%', '=', ',', "'", '!', '(', ')', '[', ']']) {
            expect(projectDirName(`/a${ch}b`)).toBe('-a-b');
        }
    });

    it('maps a run of punctuation to a run of dashes, never collapsing it', () => {
        // Upstream has no `+` on its character class, so N characters in means
        // N dashes out. Collapsing would quietly break these paths.
        expect(projectDirName('/a...b')).toBe('-a---b');
        expect(projectDirName('/a   b')).toBe('-a---b');
    });
});

describe('projectDirName - non-ASCII (#53)', () => {
    // The rule under test is "one dash per UTF-16 code unit", so each case
    // asserts the code-unit count first and then builds the expectation from
    // it. That catches both ways this can go wrong: collapsing a run of dashes,
    // and counting glyphs instead of code units.
    it('maps Mandarin characters one dash each', () => {
        // 'Don't panic' - the towel-carrier's first principle.
        const mandarin = '\u522B\u614C';   // 'Don\'t panic'
        expect(mandarin.length).toBe(2);
        expect(projectDirName(`/home/ford/${mandarin}`))
            .toBe('-home-ford-' + '-'.repeat(mandarin.length));
    });

    it('maps Japanese characters one dash each', () => {
        const japanese = '\u9280\u6CB3\u30D2\u30C3\u30C1\u30CF\u30A4\u30AF\u30FB\u30AC\u30A4\u30C9';
        expect(japanese.length).toBe(12);
        expect(projectDirName(`/home/arthur/${japanese}`))
            .toBe('-home-arthur-' + '-'.repeat(japanese.length));
    });

    it('maps Greek characters one dash each, including the space', () => {
        const greek = '\u039C\u03B7 \u03C0\u03B1\u03BD\u03B9\u03BA\u03BF\u03B2\u03AC\u03BB\u03BB\u03B5\u03C3\u03B1\u03B9';
        expect(greek.length).toBe(17);
        expect(projectDirName(`C:\\Users\\zaphod\\Documents\\${greek}`))
            .toBe('C--Users-zaphod-Documents-' + '-'.repeat(greek.length));
    });

    it('drops a composed accented letter (NFC) entirely', () => {
        // 'caf' + U+00E9. The accented letter is one code unit, so it becomes
        // one dash and the 'e' never appears.
        expect(projectDirName(`/home/u/caf${E_ACUTE}`)).toBe('-home-u-caf-');
    });

    it('keeps the base letter of a decomposed accent (NFD) and dashes only the mark', () => {
        // 'cafe' + U+0301. Identical on screen to the case above, but the bare
        // ASCII 'e' survives and only the combining mark becomes a dash.
        //
        // So the two spellings of one word name two DIFFERENT directories -
        // `caf-` and `cafe-` - and only one of them exists on disk. macOS
        // filesystems hand back the decomposed form, which is why
        // canonicalisePath() normalises to NFC before deriving anything.
        expect(projectDirName(`/home/u/cafe${COMBINING_ACUTE}`)).toBe('-home-u-cafe-');
        expect(projectDirName(`/home/u/cafe${COMBINING_ACUTE}`))
            .not.toBe(projectDirName(`/home/u/caf${E_ACUTE}`));
    });

    it('maps a non-BMP character as TWO dashes (surrogate pair)', () => {
        // Deliberate. Upstream's regex has no `u` flag, so it walks UTF-16 code
        // units, and an emoji is a surrogate pair - two dashes. Adding `u` here
        // would give one dash and miss the directory.
        expect(projectDirName('/home/u/\u{1F600}')).toBe('-home-u---');
    });
});

describe('projectDirName - the 200-character cap', () => {
    // Not reported by a user yet, but it is in upstream and any deeply nested
    // monorepo path reaches it.
    const long = '/' + 'a'.repeat(400);

    it('leaves a name at exactly the cap alone', () => {
        const atCap = '/' + 'a'.repeat(DEFAULT_MAX_DIR_NAME_LENGTH - 1);
        const derived = projectDirName(atCap);
        expect(derived.length).toBe(DEFAULT_MAX_DIR_NAME_LENGTH);
        expect(derived).toBe(atCap.replace('/', '-'));
    });

    it('truncates past the cap and appends a hash', () => {
        const derived = projectDirName(long);
        expect(derived.startsWith('-' + 'a'.repeat(DEFAULT_MAX_DIR_NAME_LENGTH - 1))).toBe(true);
        expect(derived.length).toBeGreaterThan(DEFAULT_MAX_DIR_NAME_LENGTH);
        expect(derived[DEFAULT_MAX_DIR_NAME_LENGTH]).toBe('-');
    });

    it('hashes the ORIGINAL path, so two paths sharing a 200-char prefix differ', () => {
        // The whole reason the hash exists. Hashing the truncated string
        // instead would collide and point both workspaces at one directory.
        const a = projectDirName('/' + 'a'.repeat(300) + '/one');
        const b = projectDirName('/' + 'a'.repeat(300) + '/two');
        expect(a).not.toBe(b);
        expect(a.slice(0, DEFAULT_MAX_DIR_NAME_LENGTH)).toBe(b.slice(0, DEFAULT_MAX_DIR_NAME_LENGTH));
    });

    it('emits an unsigned base-36 hash', () => {
        expect(projectDirName(long).slice(DEFAULT_MAX_DIR_NAME_LENGTH + 1)).toMatch(/^[0-9a-z]+$/);
    });
});

describe('hashPath', () => {
    it('matches upstream for a known value', () => {
        // (h << 5) - h + c, wrapped back to int32 each step.
        let expected = 0;
        for (const ch of 'abc') expected = (expected << 5) - expected + ch.charCodeAt(0) | 0;
        expect(hashPath('abc')).toBe(expected);
        expect(hashPath('abc')).toBe(96354);
    });

    it('is zero for the empty string', () => {
        expect(hashPath('')).toBe(0);
    });

    it('wraps to int32 rather than growing without bound', () => {
        // Without the `| 0` the accumulator runs past Number.MAX_SAFE_INTEGER
        // and the base-36 suffix stops matching upstream. Compare against a
        // deliberately unwrapped walk over a path long enough to overflow.
        const long = '/' + 'x'.repeat(5000);
        let unwrapped = 0;
        for (let i = 0; i < long.length; i++) unwrapped = unwrapped * 31 + long.charCodeAt(i);

        expect(unwrapped).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
        expect(hashPath(long)).not.toBe(unwrapped);
        expect(Math.abs(hashPath(long))).toBeLessThanOrEqual(2 ** 31);
    });
});

describe('normaliseUnicode', () => {
    it('composes NFD input to NFC, so both spellings name one directory', () => {
        const nfd = `/home/u/cafe${COMBINING_ACUTE}`;
        const nfc = `/home/u/caf${E_ACUTE}`;
        expect(nfd).not.toBe(nfc);
        expect(normaliseUnicode(nfd)).toBe(nfc);
        expect(projectDirName(normaliseUnicode(nfd))).toBe(projectDirName(nfc));
    });

    it('leaves ASCII untouched', () => {
        expect(normaliseUnicode('/home/u/plain')).toBe('/home/u/plain');
    });
});

describe('projectDir resolution against real files', () => {
    let base;
    let root;          // stands in for ~/.claude/projects
    let workspace;     // stands in for the VS Code workspace
    let linkedWorkspace;

    const writeTranscript = async (dir, name, cwd) => {
        await fs.mkdir(dir, { recursive: true });
        const lines = [
            JSON.stringify({ type: 'summary', summary: 'this entry has no cwd' }),
            JSON.stringify({ type: 'user', cwd, sessionId: 'abc' }),
        ];
        await fs.writeFile(path.join(dir, name), lines.join('\n') + '\n', 'utf-8');
    };

    beforeAll(async () => {
        // Genuine process-local scratch, removed in afterAll.
        base = await fs.mkdtemp(path.join(os.tmpdir(), 'claudemeter-projectdir-'));
        root = path.join(base, 'projects');
        workspace = path.join(base, 'workspace');
        linkedWorkspace = path.join(base, 'linked');
        await fs.mkdir(root, { recursive: true });
        await fs.mkdir(workspace, { recursive: true });
        await fs.symlink(workspace, linkedWorkspace, 'dir');
    });

    afterAll(async () => {
        if (base) await fs.rm(base, { recursive: true, force: true });
    });

    it('resolves via the derived name when the rule matches', async () => {
        const realWorkspace = await fs.realpath(workspace);
        const dir = path.join(root, projectDirName(normaliseUnicode(realWorkspace)));
        await writeTranscript(dir, 'a.jsonl', realWorkspace);

        const resolved = await resolveProjectDir(root, workspace);
        expect(resolved.method).toBe('derived');
        expect(resolved.dir).toBe(dir);
    });

    it('resolves a symlinked workspace to the target directory', async () => {
        // Claude Code realpaths before naming - verified by running the CLI
        // from a symlinked directory and watching where the transcript landed.
        // Without canonicalisation we derive the LINK's name, which does not
        // exist, and the gauge blanks.
        const resolved = await resolveProjectDir(root, linkedWorkspace);
        expect(resolved).not.toBeNull();
        expect(resolved.method).toBe('derived');
        // Asserted against the TARGET's directory, built independently of the
        // function under test.
        expect(path.basename(resolved.dir))
            .toBe((await fs.realpath(workspace)).replace(/[^a-zA-Z0-9]/g, '-'));
        expect(path.basename(resolved.dir)).not.toContain('linked');
    });

    it('falls back to the recorded cwd when the naming rule misses', async () => {
        // Stands in for upstream changing the rule on us. The transcript sits
        // under a name we would never derive, but it records our cwd, so the
        // gauge keeps working instead of blanking.
        const orphan = path.join(base, 'orphan');
        await fs.mkdir(orphan, { recursive: true });
        const odd = path.join(root, 'some_future_naming_scheme_v9');
        await writeTranscript(odd, 'c.jsonl', await fs.realpath(orphan));

        const resolved = await resolveProjectDir(root, orphan);
        expect(resolved.method).toBe('recorded-cwd');
        expect(resolved.dir).toBe(odd);
    });

    it('matches the recorded cwd through a symlink too', async () => {
        const orphanLink = path.join(base, 'orphan-link');
        await fs.symlink(path.join(base, 'orphan'), orphanLink, 'dir');
        const resolved = await resolveProjectDir(root, orphanLink);
        expect(resolved.method).toBe('recorded-cwd');
        expect(resolved.dir).toBe(path.join(root, 'some_future_naming_scheme_v9'));
    });

    it('returns null rather than guessing when nothing records our cwd', async () => {
        // The safety property. An unmatched workspace gets NO directory, never
        // "the most recent one" - guessing would leak another project's context
        // into this window's gauge, which is the bug the per-project lookup
        // exists to prevent.
        const stranger = path.join(base, 'stranger');
        await fs.mkdir(stranger, { recursive: true });
        expect(await resolveProjectDir(root, stranger)).toBeNull();
    });

    it('returns null for a missing base dir or an absent workspace path', async () => {
        expect(await resolveProjectDir(path.join(root, 'nope'), workspace)).toBeNull();
        expect(await resolveProjectDir(root, null)).toBeNull();
        expect(await resolveProjectDir(null, workspace)).toBeNull();
    });
});

describe('readRecordedCwd', () => {
    let dir;

    beforeAll(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claudemeter-cwd-'));
    });

    afterAll(async () => {
        if (dir) await fs.rm(dir, { recursive: true, force: true });
    });

    it('finds a cwd that is not on the first line', async () => {
        const file = path.join(dir, 'later.jsonl');
        await fs.writeFile(file, [
            JSON.stringify({ type: 'summary' }),
            JSON.stringify({ type: 'user', cwd: '/real/place' }),
        ].join('\n'), 'utf-8');
        expect(await readRecordedCwd(file)).toBe('/real/place');
    });

    it('skips malformed lines instead of throwing', async () => {
        const file = path.join(dir, 'broken.jsonl');
        await fs.writeFile(file, [
            'not json at all',
            '{"half": ',
            JSON.stringify({ cwd: '/good' }),
        ].join('\n'), 'utf-8');
        expect(await readRecordedCwd(file)).toBe('/good');
    });

    it('returns null for an empty file, a cwd-less file, and a missing file', async () => {
        const empty = path.join(dir, 'empty.jsonl');
        await fs.writeFile(empty, '', 'utf-8');
        expect(await readRecordedCwd(empty)).toBeNull();

        const noCwd = path.join(dir, 'nocwd.jsonl');
        await fs.writeFile(noCwd, JSON.stringify({ type: 'user' }) + '\n', 'utf-8');
        expect(await readRecordedCwd(noCwd)).toBeNull();

        expect(await readRecordedCwd(path.join(dir, 'ghost.jsonl'))).toBeNull();
    });

    it('ignores an empty-string cwd', async () => {
        const file = path.join(dir, 'blankcwd.jsonl');
        await fs.writeFile(file, JSON.stringify({ cwd: '' }) + '\n', 'utf-8');
        expect(await readRecordedCwd(file)).toBeNull();
    });

    it('reads a bounded head, not the whole transcript', async () => {
        // A real transcript runs to tens of megabytes, so the probe must not
        // pull it all into memory. The cwd here sits past the probe window, and
        // giving up is the correct behaviour.
        const big = path.join(dir, 'big.jsonl');
        const filler = JSON.stringify({ type: 'user', text: 'x'.repeat(2000) });
        const lines = [];
        while (lines.join('\n').length < CWD_PROBE_BYTES * 2) lines.push(filler);
        lines.push(JSON.stringify({ cwd: '/way/past/the/window' }));
        await fs.writeFile(big, lines.join('\n'), 'utf-8');
        expect(await readRecordedCwd(big)).toBeNull();
    });

    it('keeps the final line of a file that ends exactly on the probe boundary', async () => {
        // A file whose size happens to equal the probe window ends on a real
        // line boundary. Dropping the last line whenever the buffer is full
        // loses a perfectly good cwd, so the guard tests for the newline rather
        // than for the byte count.
        const entry = { cwd: '/exact/boundary', pad: '' };
        entry.pad = 'y'.repeat(CWD_PROBE_BYTES - JSON.stringify(entry).length - 1);
        const exact = path.join(dir, 'exact.jsonl');
        await fs.writeFile(exact, JSON.stringify(entry) + '\n', 'utf-8');

        expect((await fs.stat(exact)).size).toBe(CWD_PROBE_BYTES);
        expect(await readRecordedCwd(exact)).toBe('/exact/boundary');
    });

    it('discards a line the probe window genuinely cut in half', async () => {
        const edge = path.join(dir, 'edge.jsonl');
        // Entry longer than the window, so the read stops mid-JSON with no
        // trailing newline.
        await fs.writeFile(edge, JSON.stringify({ cwd: '/x', pad: 'y'.repeat(CWD_PROBE_BYTES) }), 'utf-8');
        expect(await readRecordedCwd(edge)).toBeNull();
    });
});

describe('canonicalisePath', () => {
    it('normalises a path that does not exist rather than throwing', async () => {
        // Remote and virtual workspaces, and deleted directories, must degrade
        // to a best-effort name.
        expect(await canonicalisePath(`/definitely/not/here/cafe${COMBINING_ACUTE}`))
            .toBe(`/definitely/not/here/caf${E_ACUTE}`);
    });
});

describe('findDirByRecordedCwd', () => {
    it('returns null for an unreadable base directory', async () => {
        expect(await findDirByRecordedCwd('/definitely/not/here', '/whatever')).toBeNull();
    });
});
