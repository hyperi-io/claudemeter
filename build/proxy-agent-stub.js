// Build-time stub replacing the `proxy-agent` package in our bundle.
//
// Why this exists:
//   puppeteer-core -> @puppeteer/browsers -> proxy-agent -> pac-proxy-agent
//   -> get-uri -> basic-ftp
//
// The only runtime use of `proxy-agent` inside `@puppeteer/browsers` is in
// `httpUtil.js`, which is called when puppeteer downloads a browser binary.
// claudemeter never downloads browsers — it always launches a user-installed
// Chrome via `executablePath` — so that code path is dead.
//
// But the `require("proxy-agent")` at the top of httpUtil.js runs at module
// load time, pulling in the entire pac-proxy-agent + get-uri + basic-ftp
// chain (which ships FTP client code, CRLF-injection CVEs, etc.). Via an
// esbuild `alias`, we redirect `proxy-agent` to this stub so none of that
// code gets bundled.
//
// The stub exposes a minimal `ProxyAgent` class so the `new ProxyAgent()`
// call at httpUtil.js:72 doesn't throw at module load. It will throw a
// descriptive error if any code ever actually invokes it at runtime,
// which would indicate someone has started calling puppeteer's download
// path and we need to reconsider this shim.

class ProxyAgent {
    constructor() {
        // Deliberately a no-op. If puppeteer-core ever actually issues a
        // request through this agent, the first method call will throw
        // the error below.
    }

    addRequest() {
        throw new Error(
            'claudemeter: proxy-agent is stubbed at build time. ' +
            'If you hit this, puppeteer is trying to download a browser ' +
            'binary via an HTTP proxy. claudemeter always uses a locally ' +
            'installed Chrome, so this should never happen.'
        );
    }
}

module.exports = {
    ProxyAgent,
    default: { ProxyAgent },
};
module.exports.default = module.exports;
