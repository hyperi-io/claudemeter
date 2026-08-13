//  Project:      Claudemeter
//  File:         src/declutter/state.js
//  Purpose:      Pure predicates over the Nopilot groups: what is applied and
//                what is left to write.
//
//                The reader is injected, so this is testable without vscode.
//                read(key) returns the effective value, undefined when unset.
//
//                Comparison is strict equality, so every target value must
//                stay primitive. An object-valued setting needs a definition
//                of "partially applied" before it can go in the registry.
//
//  License:      MIT
//  Copyright:    (c) 2026 HYPERI PTY LIMITED

const { GROUPS, coreGroup } = require('./groups');

// A reader over the scope Nopilot actually WRITES to. Reading the effective
// value instead would never agree with a Global write: a workspace pinning a
// key away from target leaves it pending forever, so the offer returns after
// every apply and re-writes Global each time.
function globalScopeReader(config) {
    return (key) => {
        const v = config.inspect(key);
        if (!v) return undefined;
        return v.globalValue !== undefined ? v.globalValue : v.defaultValue;
    };
}

// Whether the running build registers this setting at all. inspect() ALWAYS
// returns an object - the ext host's `if (d) return {...}` sits on a
// Configuration.inspect() that unconditionally constructs one - so its presence
// proves nothing. Only a registered setting carries a defaultValue.
function isDeclared(config, key) {
    const v = config.inspect(key);
    return !!v && v.defaultValue !== undefined;
}

// The keys in a group that do not already hold the target value.
function pendingSettings(group, read) {
    if (!group || !group.settings) return [];
    return Object.keys(group.settings)
        .filter((key) => read(key) !== group.settings[key]);
}

function isApplied(group, read) {
    return pendingSettings(group, read).length === 0;
}

// Groups with at least one setting still to write. Order follows GROUPS.
function pendingGroups(read) {
    return GROUPS.filter((group) => !isApplied(group, read));
}

// Whether the tooltip offer has served its purpose. Gated on the group's FIRST
// setting - the master switch - not on all of them: the rest include
// provider-agnostic keys a user may legitimately turn back on, and requiring
// every one would resurrect the offer permanently. An absent core group reads
// as applied, so a registry edit can never strand the offer on screen.
function isCoreApplied(read) {
    const core = coreGroup();
    if (!core) return true;
    const master = Object.keys(core.settings)[0];
    return read(master) === core.settings[master];
}

module.exports = {
    globalScopeReader,
    isDeclared,
    pendingSettings,
    isApplied,
    pendingGroups,
    isCoreApplied,
};
