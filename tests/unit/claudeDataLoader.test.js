// Regression tests for convertPathToClaudeDir() — the workspace-path
// to Claude-project-directory translator. The Windows variant has bitten
// us once already (the colon was being dropped, producing a single dash
// where Claude Code uses two — see fix(windows): drive-letter colon →
// dash). These tests pin the exact mapping so the same regression can't
// silently come back the next time someone touches that function.

import { describe, it, expect } from 'vitest';
const { ClaudeDataLoader } = require('../../src/claudeDataLoader');

describe('ClaudeDataLoader.convertPathToClaudeDir', () => {
    // Use a single instance — the method is pure with respect to its
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
            // \\server\share\proj → -server-share-proj (no colon to map)
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
        it('preserves spaces in path segments', () => {
            // Spaces are valid in Claude project dir names — they don't
            // get touched by the converter.
            expect(loader.convertPathToClaudeDir('c:\\My Projects\\thing'))
                .toBe('c--My Projects-thing');
        });

        it('handles trailing separators', () => {
            expect(loader.convertPathToClaudeDir('c:\\Projects\\'))
                .toBe('c--Projects-');
        });
    });
});
