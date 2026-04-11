// vitest setup: register a global mock for 'vscode' so CommonJS modules
// doing `require('vscode')` at load time get our stub instead of failing
// with MODULE_NOT_FOUND.
//
// The project source uses `const vscode = require('vscode')` at the top
// of several files (utils.js, statusBar.js, extension.js). Under the VS
// Code extension host this is provided by the runtime. In vitest there
// is no host, so we intercept via Node's require cache.

const Module = require('module');
const path = require('path');

const stubPath = path.resolve(__dirname, '__mocks__/vscode.js');
const stub = require(stubPath);

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
    if (request === 'vscode') {
        return stubPath;
    }
    return originalResolve.call(this, request, parent, ...rest);
};

// Pre-load the stub under the 'vscode' id so require('vscode') returns it
// without even hitting the resolve hook in some fast paths.
require.cache['vscode'] = {
    id: 'vscode',
    filename: stubPath,
    loaded: true,
    exports: stub,
    children: [],
    paths: [],
};
