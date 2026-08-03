// Project:   Claudemeter
// File:      redact.js
// Purpose:   Strip identity from the state dump users paste into public issues.
// Language:  JavaScript (CommonJS)
//
// SECURITY.md commits the debug log and the Dump State report to carrying no
// account name, no email and no username in paths, and calls a change that adds
// identifying data to either a defect. These helpers hold that line for the
// identity-bearing objects; scrubHome covers the paths.
//
// Identity is reported as PRESENCE plus the non-identifying descriptors that
// still make a report diagnosable - whether an account was found, its plan and
// org type, and whether the org name looks personal or custom.
//
// vscode-free by design.
//
// License:   MIT
// Copyright: (c) 2026 HYPERI PTY LIMITED

// Personal orgs are named "<email>'s Organisation", so the name is identifying
// while its shape is the diagnostic signal.
function describeOrgNameShape(orgName) {
    if (!orgName) return null;
    return /'s Organi[sz]ation$/.test(orgName) ? 'personal-pattern' : 'custom';
}

// Identity fields dropped from any account-shaped object, reported as presence.
const IDENTITY_FIELDS = ['email', 'emailAddress', 'displayName', 'fullName', 'accountUuid',
    'organizationUuid', 'orgId', 'organizationName', 'name', 'orgName'];

function presenceKey(field) {
    return `has${field.charAt(0).toUpperCase()}${field.slice(1)}`;
}

// Replace every identity field with a boolean, keeping everything else. The
// org name additionally contributes its shape, which the tier resolver is
// diagnosed against.
function redactIdentity(source) {
    if (!source || typeof source !== 'object') return null;
    const out = {};
    for (const [key, value] of Object.entries(source)) {
        if (IDENTITY_FIELDS.includes(key)) out[presenceKey(key)] = !!value;
        else out[key] = value;
    }
    const orgName = source.organizationName || source.orgName;
    if (orgName !== undefined) out.organizationNameShape = describeOrgNameShape(orgName);
    return out;
}

module.exports = { redactIdentity, describeOrgNameShape, IDENTITY_FIELDS };
