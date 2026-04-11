const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Aliased packages: replace the real module with a build-time stub so its
// transitive deps get dropped from the bundle. See build/proxy-agent-stub.js
// for the full rationale — short version: puppeteer's proxy-agent chain
// drags in basic-ftp + pac-proxy-agent code paths that we never execute,
// and those are a recurring source of CVEs.
const aliases = {
    'proxy-agent': path.resolve(__dirname, 'build/proxy-agent-stub.js'),
};

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['extension.js'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode', 'typescript'],
        alias: aliases,
        logLevel: 'info',
        plugins: [
            {
                name: 'watch-plugin',
                setup(build) {
                    build.onEnd(result => {
                        if (result.errors.length > 0) {
                            console.error('Build failed with errors');
                        } else {
                            console.log('Build completed successfully');
                        }
                    });
                }
            }
        ]
    });

    if (watch) {
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
