#!/usr/bin/env bash
#
#  Project:      Claudemeter
#  File:         scripts/e2e.sh
#  Purpose:      Run an e2e entry point on the host display or under a private X server
#  Language:     Bash
#
#  License:      MIT
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
#
#  CLAUDEMETER_E2E_DISPLAY picks the display: host shows the window on the desktop, xvfb keeps
#  it off it. Unset means xvfb when it is installed, else host. show always uses the host.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

entry="${1:?usage: e2e.sh <run|assets|show> [args...]}"
shift

mode="${CLAUDEMETER_E2E_DISPLAY:-}"
hasHost=false
[[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] && hasHost=true
hasXvfb=false
command -v xvfb-run > /dev/null 2>&1 && hasXvfb=true

if [[ -z "$mode" ]]; then
  if [[ "$hasXvfb" == true ]]; then mode=xvfb; else mode=host; fi
fi
[[ "$entry" == "show" ]] && mode=host

run=(node "tests/e2e/${entry}.js" "$@")

case "$mode" in
  host)
    if [[ "$hasHost" == false ]]; then
      echo "RESULT: undetermined" >&2
      echo "e2e: display host asked for and no DISPLAY or WAYLAND_DISPLAY is set" >&2
      exit 2
    fi
    echo "display: host ${DISPLAY:-${WAYLAND_DISPLAY}}" >&2
    ;;
  xvfb)
    if [[ "$hasXvfb" == false ]]; then
      echo "RESULT: undetermined" >&2
      echo "e2e: display xvfb asked for and xvfb-run is not installed" >&2
      exit 2
    fi
    echo "display: xvfb-run" >&2
    # Electron draws on Wayland whenever WAYLAND_DISPLAY is set, so it is dropped to keep the window on Xvfb.
    run=(env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 xvfb-run -a -s '-screen 0 1920x1080x24' "${run[@]}")
    ;;
  *)
    echo "e2e: CLAUDEMETER_E2E_DISPLAY must be host or xvfb, got '$mode'" >&2
    exit 2
    ;;
esac

exec "${run[@]}"
