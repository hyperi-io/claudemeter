import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.js'],
        // Intercept `require('vscode')` in source files via a setup file
        // (there's no VS Code extension host under vitest). The setup
        // patches Node's Module resolver so any require('vscode') from
        // source or test code returns a local stub.
        setupFiles: [path.resolve(__dirname, 'tests/setup.js')],
    },
});
