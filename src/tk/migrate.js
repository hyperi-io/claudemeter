// Project:   Claudemeter
// File:      src/tk/migrate.js
// Purpose:   One-shot migration of legacy %-based threshold settings
//            (claudemeter.thresholds.tokens.warning / .error) into the
//            new profile-driven token-runway model.
//
//            Runs once per activation (idempotent - guard checks "is
//            new key already set?"). Convert percent -> runway tokens
//            using the user's current detected context window:
//                tokensAtThreshold = window * (percent / 100)
//                runway = window - tokensAtThreshold - compactReserve
//
//            Write target: <currentProfile>.thresholds.<newField> inside
//                          claudemeter.thresholds.tokens.profiles, merged
//                          into the existing object and written whole.
//            Scope: ConfigurationTarget.Global only. Workspace-scoped
//            legacy values are noted in the log and skipped.
//
//            Failed delete of the legacy key after a successful new-key
//            write is logged but not fatal - the next activation's
//            guard ("is new key already set?") prevents re-migration.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

const LEGACY_PERCENT_KEYS = Object.freeze({
    'thresholds.tokens.warning': 'warningRunwayTokens',
    'thresholds.tokens.error':   'errorRunwayTokens',
});

const PROFILES_KEY = 'thresholds.tokens.profiles';

/**
 * Run legacy-settings migration. Idempotent.
 *
 * @param {object} vscode - the vscode API (real or mock)
 * @param {number} contextWindow - user's current detected context window in tokens
 * @param {object} profile - resolved profile (carries .name and .thresholds.compactReserveTokens)
 * @param {{appendLine: (s: string) => void}} logger - output channel
 * @param {string} configNamespace - usually 'claudemeter'
 * @returns {Promise<{migrated: string[], skipped: string[]}>}
 */
async function migrateLegacySettings(vscode, contextWindow, profile, logger, configNamespace = 'claudemeter') {
    const result = { migrated: [], skipped: [] };

    if (!profile || !profile.thresholds || !contextWindow) {
        logger?.appendLine?.(`[claudemeter] migrate: skipping — no profile/window (profile=${profile?.name}, window=${contextWindow})`);
        return result;
    }

    const config = vscode.workspace.getConfiguration(configNamespace);
    const compactReserve = profile.thresholds.compactReserveTokens;

    // The profile map is one registered setting, and VS Code refuses a write
    // to a dotted path inside it, so it is read, merged and written whole.
    // A copy, because the object VS Code hands back may be frozen.
    const profiles = JSON.parse(JSON.stringify(config.inspect(PROFILES_KEY)?.globalValue ?? {}));

    for (const [legacyKey, newField] of Object.entries(LEGACY_PERCENT_KEYS)) {
        const legacyInspect = config.inspect(legacyKey);
        if (!legacyInspect) {
            continue;  // schema doesn't declare this key (shouldn't happen, but defensive)
        }

        const userValue = legacyInspect.globalValue;
        if (userValue === undefined) {
            continue;  // not user-set at global scope -> nothing to do
        }

        // Workspace-scoped legacy values: note + skip
        if (legacyInspect.workspaceValue !== undefined) {
            logger?.appendLine?.(`[claudemeter] migrate: ${legacyKey} also set at workspace scope — only migrating global value, workspace value preserved untouched`);
        }

        // Idempotency check: is the new field already set?
        const newKey = `${PROFILES_KEY}.${profile.name}.thresholds.${newField}`;
        if (profiles[profile.name]?.thresholds?.[newField] !== undefined) {
            logger?.appendLine?.(`[claudemeter] migrate: ${legacyKey} skipped — ${newKey} already set (no overwrite)`);
            result.skipped.push(legacyKey);
            continue;
        }

        // Convert percent -> runway tokens
        const tokensAtThreshold = Math.round(contextWindow * (userValue / 100));
        const runway = contextWindow - tokensAtThreshold - compactReserve;
        if (runway <= 0) {
            logger?.appendLine?.(`[claudemeter] migrate: ${legacyKey}=${userValue}% would produce runway<=0 on ${contextWindow}-token window — skipped`);
            result.skipped.push(legacyKey);
            continue;
        }

        // Write new value first
        const entry = profiles[profile.name] ?? {};
        const merged = {
            ...profiles,
            [profile.name]: { ...entry, thresholds: { ...entry.thresholds, [newField]: runway } },
        };
        try {
            await config.update(PROFILES_KEY, merged, vscode.ConfigurationTarget.Global);
            Object.assign(profiles, merged);
        } catch (err) {
            logger?.appendLine?.(`[claudemeter] migrate: failed to write ${newKey}: ${err.message} — skipping legacy delete to allow retry next activation`);
            result.skipped.push(legacyKey);
            continue;
        }

        // Delete legacy key (best effort - failure is logged but not fatal)
        try {
            await config.update(legacyKey, undefined, vscode.ConfigurationTarget.Global);
        } catch (err) {
            logger?.appendLine?.(`[claudemeter] migrate: ${legacyKey} migrated to ${newKey} but legacy delete failed: ${err.message}`);
        }

        logger?.appendLine?.(`[claudemeter] migrated ${legacyKey}=${userValue}% → ${newKey}=${runway} (window=${contextWindow}, profile=${profile.name})`);
        result.migrated.push(legacyKey);
    }

    return result;
}

module.exports = { migrateLegacySettings };
