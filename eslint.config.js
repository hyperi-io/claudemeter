// Project:   Claudemeter
// File:      eslint.config.js
// Purpose:   ESLint flat config for CommonJS VS Code extension
// Language:  JavaScript (CommonJS)
//
// License:   FSL-1.1-ALv2
// Copyright: (c) 2026 HYPERI PTY LIMITED

const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                // Node.js
                require: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                // Node 18+ globals
                fetch: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                destructuredArrayIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_|^e$|^err$|^error$|Error$',
            }],
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-useless-assignment': 'warn',
            'preserve-caught-error': 'off',
        },
    },
    {
        // Puppeteer scripts run in browser context
        files: ['src/scraper.js'],
        languageOptions: {
            globals: {
                document: 'readonly',
            },
        },
    },
    {
        // Vitest test files use ESM-style imports (`import { describe, ... } from 'vitest'`)
        // alongside CommonJS require() for local modules.
        files: ['tests/**/*.js', 'tests/**/*.test.js'],
        languageOptions: {
            sourceType: 'module',
            globals: {
                describe: 'readonly',
                it: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeAll: 'readonly',
                beforeEach: 'readonly',
                afterAll: 'readonly',
                afterEach: 'readonly',
                vi: 'readonly',
            },
        },
    },
    {
        ignores: ['node_modules/**', '.tmp/**', '*.vsix'],
    },
];
