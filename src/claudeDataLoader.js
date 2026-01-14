// Project:   Claudemeter
// File:      claudeDataLoader.js
// Purpose:   Parse Claude Code JSONL files for token usage
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { TIMEOUTS } = require('./utils');

class ClaudeDataLoader {
    constructor(workspacePath = null, debugLogger = null) {
        this.claudeConfigPaths = this.getClaudeConfigPaths();
        this.workspacePath = workspacePath;
        this.projectDirName = workspacePath ? this.convertPathToClaudeDir(workspacePath) : null;
        this.log = debugLogger || (() => {});
    }

    // Claude replaces forward slashes with dashes in directory names
    convertPathToClaudeDir(workspacePath) {
        return workspacePath.replace(/\//g, '-');
    }

    setWorkspacePath(workspacePath) {
        this.workspacePath = workspacePath;
        this.projectDirName = workspacePath ? this.convertPathToClaudeDir(workspacePath) : null;
    }

    async getProjectDataDirectory() {
        if (!this.projectDirName) {
            this.log('No workspace path set, falling back to global search');
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

        paths.push(path.join(homeDir, '.config', 'claude', 'projects'));
        paths.push(path.join(homeDir, '.claude', 'projects'));

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
                const fullPath = path.join(dirPath, entry.name);

                if (entry.isDirectory()) {
                    const subFiles = await this.findJsonlFiles(fullPath);
                    jsonlFiles.push(...subFiles);
                } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                    jsonlFiles.push(fullPath);
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${dirPath}:`, error.message);
        }

        return jsonlFiles;
    }

    async parseJsonlFile(filePath) {
        const records = [];

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());

            for (const line of lines) {
                try {
                    const record = JSON.parse(line);

                    if (this.isValidUsageRecord(record)) {
                        records.push(record);
                    }
                } catch (parseError) {
                    console.warn(`Failed to parse line in ${filePath}:`, parseError.message);
                }
            }
        } catch (error) {
            console.error(`Error reading JSONL file ${filePath}:`, error.message);
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

        const sessionStart = Date.now() - TIMEOUTS.SESSION_DURATION;

        let dataDir = null;

        if (this.projectDirName) {
            dataDir = await this.getProjectDataDirectory();

            if (!dataDir) {
                // Don't fall back to global search to avoid cross-project data
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
            dataDir = await this.findClaudeDataDirectory();
        }

        if (!dataDir) {
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

        try {
            const allJsonlFiles = await this.findJsonlFiles(dataDir);

            // Filter to main session files (UUID format), excluding agent-* subprocesses
            const mainSessionFiles = allJsonlFiles.filter(filePath => {
                const filename = path.basename(filePath);
                if (filename.startsWith('agent-')) {
                    return false;
                }
                const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
                return uuidPattern.test(filename);
            });

            const recentFiles = [];
            for (const filePath of mainSessionFiles) {
                try {
                    const stats = await fs.stat(filePath);
                    if (stats.mtimeMs >= sessionStart) {
                        recentFiles.push({
                            path: filePath,
                            modified: stats.mtimeMs
                        });
                    }
                } catch (statError) {
                    continue;
                }
            }

            recentFiles.sort((a, b) => b.modified - a.modified);

            if (recentFiles.length === 0) {
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

            // Check ALL recent session files and find the highest cache_read value
            // This ensures we show the session closest to the context limit when multiple sessions are running
            let highestSessionTokens = 0;
            let highestCacheCreation = 0;
            let highestCacheRead = 0;
            let totalMessageCount = 0;
            let activeSessionCount = 0;

            for (const fileInfo of recentFiles) {
                const filePath = fileInfo.path;
                const filename = path.basename(filePath);

                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const lines = content.trim().split('\n');

                    // Parse from end to find last assistant message with cache data
                    for (let i = lines.length - 1; i >= 0; i--) {
                        try {
                            const entry = JSON.parse(lines[i]);

                            if (entry.type === 'assistant' && entry.message?.usage) {
                                const usage = entry.message.usage;
                                const entryCache = (usage.cache_creation_input_tokens || 0) +
                                                  (usage.cache_read_input_tokens || 0);

                                if (entryCache > 0) {
                                    const cacheRead = usage.cache_read_input_tokens || 0;
                                    activeSessionCount++;
                                    totalMessageCount += lines.length;

                                    // Track the session with the highest cache_read (closest to limit)
                                    if (cacheRead > highestCacheRead) {
                                        highestCacheRead = cacheRead;
                                        highestCacheCreation = usage.cache_creation_input_tokens || 0;
                                        highestSessionTokens = cacheRead;
                                    }
                                    break;
                                }
                            }
                        } catch (parseError) {
                            continue;
                        }
                    }
                } catch (readError) {
                    this.log(`Error reading ${filename}: ${readError.message}`);
                    continue;
                }
            }

            return {
                totalTokens: highestSessionTokens,
                inputTokens: 0,
                outputTokens: 0,
                cacheCreationTokens: highestCacheCreation,
                cacheReadTokens: highestCacheRead,
                messageCount: totalMessageCount,
                isActive: highestSessionTokens > 0,
                activeSessionCount: activeSessionCount
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
                isActive: false
            };
        }
    }

    async getTodayUsage() {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        return await this.loadUsageRecords(startOfDay.getTime());
    }
}

module.exports = { ClaudeDataLoader };
