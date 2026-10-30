// Project:   Claudemeter
// File:      agents/registry.js
// Purpose:   The supplementary agents claudemeter reports beside Claude, and the cached read of their usage.
// Language:  JavaScript (CommonJS)
//
// A provider is a module with { id, name, shortLabel, read({ command }) }. read resolves to the
// provider-neutral usage (see limits.js), or null when the agent is absent or signed out. Adding an
// agent is one provider file, one entry here, and its `claudemeter.agents.<id>.*` settings.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const { headlineLimit } = require('./limits');

const PROVIDERS = [require('./codex')];

// Each read spawns a process, so an agent is asked at most this often whatever the refresh interval.
const MIN_READ_INTERVAL_MS = 5 * 60 * 1000;

const cache = new Map();

function readProvider(provider, command, now) {
    const hit = cache.get(provider.id);
    if (hit && hit.command === command && now - hit.at < MIN_READ_INTERVAL_MS) return hit;
    const pending = Promise.resolve()
        .then(() => provider.read({ command }))
        .catch(() => null);
    const entry = { at: now, command, pending };
    cache.set(provider.id, entry);
    return entry;
}

/**
 * Usage for every enabled agent that reported some, in registry order. readAt is when that
 * usage was read, so a cached answer keeps its first time.
 *
 * @param {(id: string) => {enabled: boolean, command: string}} settingsFor - the agent's settings
 * @returns {Promise<{id: string, name: string, shortLabel: string, usage: object, readAt: number}[]>}
 */
async function readAgents(settingsFor, { providers = PROVIDERS, now = Date.now() } = {}) {
    const enabled = providers.filter((p) => settingsFor(p.id).enabled);
    const entries = enabled.map((p) => readProvider(p, settingsFor(p.id).command, now));
    const usages = await Promise.all(entries.map((e) => e.pending));
    return enabled
        .map((p, i) => ({ id: p.id, name: p.name, shortLabel: p.shortLabel, usage: usages[i], readAt: entries[i].at }))
        .filter((a) => a.usage);
}

function resetAgentCache() {
    cache.clear();
}

// The history series an agent's headline limit is kept under.
const agentSeries = (id) => `agent:${id}`;

// A usage history sample holding each agent's headline limit, for the same strip the Claude gauges draw.
function agentSample(agents, ts) {
    const scoped = {};
    for (const agent of agents) {
        const head = headlineLimit(agent.usage.limits);
        if (head) scoped[agentSeries(agent.id)] = { pct: head.percent, resetsAt: head.resetsAt };
    }
    if (Object.keys(scoped).length === 0) return null;
    const none = { pct: null, resetsAt: null };
    return { ts, fiveHour: none, sevenDay: none, scoped };
}

module.exports = { PROVIDERS, MIN_READ_INTERVAL_MS, readAgents, resetAgentCache, agentSeries, agentSample };
