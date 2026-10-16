import { describe, it, expect, beforeAll, afterAll } from 'vitest';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vscode = require('vscode');
const { initFileLogger } = require('../../src/utils');

// The log carries project names and request detail, so only its owner reads it.
describe.skipIf(process.platform === 'win32')('FileLogger.log - permissions on create', () => {
    let dir;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-log-'));
        vscode._setConfigValues({ debug: true });
    });

    afterAll(() => {
        vscode._resetConfigValues();
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('creates the log directory owner-only and the log file owner read-write', () => {
        const logger = initFileLogger('/some/workspace');
        logger.logFile = path.join(dir, 'nested', 'debug.log');
        logger.log('first line');
        expect(fs.statSync(path.dirname(logger.logFile)).mode & 0o777).toBe(0o700);
        expect(fs.statSync(logger.logFile).mode & 0o777).toBe(0o600);
    });

    it('leaves the mode of an existing log file alone', () => {
        const logger = initFileLogger('/some/workspace');
        logger.logFile = path.join(dir, 'existing.log');
        fs.writeFileSync(logger.logFile, '', { mode: 0o644 });
        fs.chmodSync(logger.logFile, 0o644);
        logger.log('appended');
        expect(fs.statSync(logger.logFile).mode & 0o777).toBe(0o644);
    });
});

describe('FileLogger.trimIfNeeded', () => {
    let dir;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudemeter-log-'));
    });

    afterAll(() => {
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps whole lines from the end of a log far past its cap', () => {
        const logger = initFileLogger('/some/workspace');
        logger.logFile = path.join(dir, 'debug.log');
        logger.maxSizeBytes = 64 * 1024;

        const lines = [];
        for (let i = 0; i < 100_000; i++) lines.push(`2026-10-16T00:00:00.000Z line ${i} é`);
        fs.writeFileSync(logger.logFile, lines.join('\n') + '\n');

        logger.trimIfNeeded();

        const kept = fs.readFileSync(logger.logFile, 'utf-8');
        expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(logger.maxSizeBytes * 0.75);
        expect(kept.startsWith('2026-10-16T00:00:00.000Z line ')).toBe(true);
        expect(kept.endsWith('line 99999 é\n')).toBe(true);
    });

    it('leaves a log under its cap alone', () => {
        const logger = initFileLogger('/some/workspace');
        logger.logFile = path.join(dir, 'small.log');
        logger.maxSizeBytes = 64 * 1024;
        fs.writeFileSync(logger.logFile, 'one\ntwo\n');

        logger.trimIfNeeded();

        expect(fs.readFileSync(logger.logFile, 'utf-8')).toBe('one\ntwo\n');
    });
});
