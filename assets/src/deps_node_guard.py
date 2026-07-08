#!/usr/bin/env python3
# Project:   Claudemeter
# File:      assets/src/deps_node_guard.py
# Purpose:   /deps guard - keep the CI Node version pinned to whatever the VS
#            Code extension host runs for the OLDEST VS Code we support
#            (`engines.vscode` floor), NOT the newest Node available. A VS Code
#            extension runs inside Electron's bundled Node; if CI builds/tests
#            on a newer Node than the floor's host, a newer-Node-only feature
#            can slip in and break users on the minimum supported VS Code.
#            Run this every /deps pass for THIS project (see CLAUDE.md).
# Language:  Python 3 (stdlib only - no deps, no network)
#
# Usage:
#   uv run assets/src/deps_node_guard.py         # check, exit 1 on drift
#   uv run assets/src/deps_node_guard.py --expected   # just print the target
#
# It derives the target Node major from `engines.vscode` in package.json via
# the VS Code -> extension-host-Node table below, then checks that the CI
# workflows, `engines.node`, and the Renovate cap all agree. Nothing here is
# hardcoded to "22" or "24" - lift `engines.vscode` and the target moves with
# it. When VS Code ships a new Node line, add ONE row to VSCODE_NODE.
#
# License:   MIT
# Copyright: (c) 2026 HYPERI PTY LIMITED

import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# VS Code version -> extension-host Node MAJOR, keyed by the FIRST VS Code
# version that shipped that Node line (Electron bump). Extend as VS Code
# advances - source: https://github.com/ewanharris/vscode-versions
#   1.110 (Electron 39) -> Node 22   |   1.125 (Electron 42) -> Node 24
VSCODE_NODE = [
    ((1, 85), 18),
    ((1, 98), 20),
    ((1, 110), 22),
    ((1, 125), 24),
]


def fail(msg):
    print(f"deps_node_guard: {msg}", file=sys.stderr)
    sys.exit(2)


def read_json(rel):
    path = os.path.join(ROOT, rel)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        fail(f"cannot read {rel}: {e}")


def parse_floor(engines_vscode):
    # "^1.110.0" / ">=1.110.0" / "1.110.x" -> (1, 110)
    m = re.search(r"(\d+)\.(\d+)", engines_vscode or "")
    if not m:
        fail(f"cannot parse engines.vscode: {engines_vscode!r}")
    return (int(m.group(1)), int(m.group(2)))


def expected_node(floor):
    # Highest table entry whose VS Code version is <= the supported floor.
    node = None
    for ver, major in sorted(VSCODE_NODE):
        if ver <= floor:
            node = major
    if node is None:
        fail(f"no Node mapping for VS Code floor {floor} - extend VSCODE_NODE")
    return node


def workflow_node_versions():
    # Every `node-version: NN` in the CI workflows, as ints.
    wf_dir = os.path.join(ROOT, ".github", "workflows")
    found = []
    if not os.path.isdir(wf_dir):
        return found
    for name in sorted(os.listdir(wf_dir)):
        if not name.endswith((".yml", ".yaml")):
            continue
        with open(os.path.join(wf_dir, name), encoding="utf-8") as f:
            for line in f:
                m = re.search(r"node-version:\s*['\"]?(\d+)", line)
                if m:
                    found.append((name, int(m.group(1))))
    return found


def renovate_cap():
    # The `allowedVersions` for the node cap rule, if present -> upper bound int.
    cfg = read_json("renovate.json") or {}
    for rule in cfg.get("packageRules", []):
        ds = rule.get("matchDatasources", [])
        names = rule.get("matchPackageNames", [])
        if "node" in names or "node-version" in ds:
            m = re.search(r"<\s*(\d+)", rule.get("allowedVersions", ""))
            if m:
                return int(m.group(1))
    return None


def main():
    pkg = read_json("package.json") or {}
    engines = pkg.get("engines", {})
    floor = parse_floor(engines.get("vscode"))
    target = expected_node(floor)

    print(f"engines.vscode floor {floor[0]}.{floor[1]} -> extension host Node {target}")

    if "--expected" in sys.argv:
        print(target)
        return 0

    problems = []

    # 1. CI workflow node-version must equal the target major.
    for name, ver in workflow_node_versions():
        if ver != target:
            problems.append(
                f".github/workflows/{name}: node-version {ver} != target {target}"
            )

    # 2. engines.node baseline major must equal the target.
    node_eng = engines.get("node", "")
    m = re.search(r"(\d+)", node_eng)
    if m and int(m.group(1)) != target:
        problems.append(f"engines.node {node_eng!r} major != target {target}")

    # 3. Renovate cap should block anything newer than the target.
    cap = renovate_cap()
    if cap is None:
        problems.append(
            "renovate.json has no Node cap rule (expected allowedVersions '<N')"
        )
    elif cap != target + 1:
        problems.append(f"renovate.json Node cap '<{cap}' should be '<{target + 1}'")

    if problems:
        print("\nDRIFT - CI Node target is out of sync:")
        for p in problems:
            print(f"  - {p}")
        print(
            f"\nHold any Node bump above {target} until engines.vscode is raised to a "
            f"version whose host runs the newer Node (see VSCODE_NODE / CLAUDE.md)."
        )
        return 1

    print(f"OK - CI Node, engines.node, and Renovate cap all agree on Node {target}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
