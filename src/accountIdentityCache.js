// Project:   Claudemeter
// File:      accountIdentityCache.js
// Purpose:   In-memory cache of the current Claude Code identity + web org UUID
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Background:
//
// claudemeter needs two different org IDs:
//
//   1. The CLI identity (accountUuid / email / organizationUuid) from
//      ~/.claude.json — used to decide "has the user switched accounts?"
//   2. The web session's org UUID, resolved via /api/bootstrap — used in
//      the /api/organizations/{uuid}/usage URL path.
//
// These are NOT the same value. The CLI org UUID and the web org UUID can
// differ for the same physical account.
//
// Previously httpFetcher held a _cachedOrgId field that was only cleared on
// clearSession(). When the user switched Claude Code accounts out-of-band
// (e.g. `claude /login` in another terminal), claudemeter kept using the old
// web org UUID and every subsequent fetch returned SESSION_EXPIRED in a
// retry loop.
//
// AccountIdentityCache encapsulates both concerns:
//
//   - It tracks the current CLI identity tuple (accountUuid, email, orgId).
//   - It exposes noteCurrentIdentity(creds) which returns { changed: bool,
//     previous, current } so callers can reset derived state on switch.
//   - It caches the resolved web org UUID but invalidates automatically on
//     identity change.
//
// The class is pure logic — it does no I/O and has no dependency on fetch,
// vscode, or the file system. All inputs are passed in by the caller. This
// makes it trivial to unit-test switch detection and cache invalidation
// without mocking network or disk.

const { getIdentityKey, identityChanged } = require('./credentialsReader');

class AccountIdentityCache {
    constructor() {
        this._currentIdentity = null; // { accountUuid, email, orgId }
        this._resolvedWebOrgId = null; // uuid string or null
        this._accountInfo = null;      // { name, email, orgName, orgType } or null
    }

    // Record the current CLI identity and report whether it represents a
    // switch from the previously-recorded identity.
    //
    // On switch (or first call with a non-null identity), the cached web org
    // UUID and accountInfo are cleared so the next fetch re-resolves them.
    //
    // Returns:
    //   {
    //     changed:  boolean — true if the identity tuple differs from last time
    //     previous: {accountUuid,email,orgId} | null — what we had before
    //     current:  {accountUuid,email,orgId} | null — what we have now
    //   }
    //
    // A null `credentials` argument is treated as "identity unknown" and
    // does NOT count as a change (we don't want a transient read failure
    // to flush the cache).
    noteCurrentIdentity(credentials) {
        const newKey = getIdentityKey(credentials);
        const previous = this._currentIdentity;

        if (!newKey) {
            // Unknown identity: preserve whatever we had, report no change.
            return { changed: false, previous, current: previous };
        }

        const changed = previous !== null && identityChanged(previous, newKey);

        if (changed || previous === null) {
            this._currentIdentity = newKey;
        }

        if (changed) {
            this._resolvedWebOrgId = null;
            this._accountInfo = null;
        }

        return { changed, previous, current: this._currentIdentity };
    }

    // Return the currently-recorded CLI identity tuple, or null.
    getCurrentIdentity() {
        return this._currentIdentity;
    }

    // Return the cached web org UUID, or null if not yet resolved.
    getResolvedWebOrgId() {
        return this._resolvedWebOrgId;
    }

    // Record the web org UUID resolved from /api/bootstrap. Callers should
    // also pass the derived accountInfo so both are invalidated as a unit.
    setResolvedWebOrgId(orgUuid, accountInfo = null) {
        this._resolvedWebOrgId = orgUuid || null;
        this._accountInfo = accountInfo;
    }

    getAccountInfo() {
        return this._accountInfo;
    }

    // Drop all cached state. Used on explicit logout/clearSession.
    clear() {
        this._currentIdentity = null;
        this._resolvedWebOrgId = null;
        this._accountInfo = null;
    }

    // Drop derived state (web org UUID + accountInfo) without forgetting the
    // CLI identity. Used when the upstream API says SESSION_EXPIRED — we
    // want to force a re-resolve against /api/bootstrap but keep the
    // identity baseline so we can still detect switches.
    invalidateResolved() {
        this._resolvedWebOrgId = null;
        this._accountInfo = null;
    }

    // Snapshot used by the dumpState diagnostic command.
    toDiagnostics() {
        return {
            currentIdentity: this._currentIdentity,
            resolvedWebOrgId: this._resolvedWebOrgId,
            accountInfo: this._accountInfo,
        };
    }
}

module.exports = {
    AccountIdentityCache,
};
