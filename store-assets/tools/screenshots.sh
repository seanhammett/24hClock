#!/bin/bash
#
# screenshots.sh — re-shoot the Chrome Web Store screenshots in store-assets/
# from the live page.
#
# Serves clock-extension/ over HTTP (the page needs a real origin for
# localStorage and the bundled fonts), drives a headless Chrome over the
# DevTools protocol, and runs tools/shoot.js against it, which seeds each
# scene from tools/scenes.json and captures the viewport. Everything it starts
# is torn down on exit.
#
# Usage: store-assets/tools/screenshots.sh [--size 1280x800]
#                                          [--out DIR]
#                                          [--only NAME]   # substring of the filename
#
# The store wants 1280x800 or 640x400, so the default size is not arbitrary.
# Needs only node (>= 22, for the built-in WebSocket), python3, and Chrome.

set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

size=1280x800
out=$repo/store-assets
only=

while [ $# -gt 0 ]; do
  case $1 in
    --size) size=$2; shift 2 ;;
    --out)  out=$2;  shift 2 ;;
    --only) only=$2; shift 2 ;;
    -h|--help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

vw=${size%x*}
vh=${size#*x}

chrome=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
if [ ! -x "$chrome" ]; then
  chrome=$(command -v google-chrome || command -v chromium || true)
fi
[ -x "$chrome" ] || { echo "Chrome not found; set CHROME=/path/to/chrome" >&2; exit 1; }

# A port each for the file server and the DevTools endpoint, stepped past
# anything already listening so a stray earlier run cannot be talked to.
free_port() {
  port=$1
  while lsof -iTCP:"$port" -sTCP:LISTEN -n -P >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo "$port"
}
http_port=$(free_port 8765)
cdp_port=$(free_port 9222)

profile=$(mktemp -d)
server_pid=
chrome_pid=
# Both children are reaped before the profile goes, or Chrome is still writing
# into the directory being removed. The run's own status is what the script
# exits with, whatever the teardown makes of itself.
cleanup() {
  status=$?
  for pid in $server_pid $chrome_pid; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf "$profile" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

python3 -m http.server "$http_port" --directory "$repo/clock-extension" \
  >/dev/null 2>&1 &
server_pid=$!

"$chrome" \
  --headless=new \
  --remote-debugging-port="$cdp_port" \
  --remote-allow-origins='*' \
  --user-data-dir="$profile" \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu \
  --hide-scrollbars \
  --force-color-profile=srgb \
  --window-size="$vw,$vh" \
  about:blank >/dev/null 2>&1 &
chrome_pid=$!

wait_for() {
  for _ in $(seq 1 50); do
    curl -sf "$1" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  echo "timed out waiting for $1" >&2
  return 1
}
wait_for "http://127.0.0.1:$http_port/index.html"
wait_for "http://127.0.0.1:$cdp_port/json/version"

PAGE_URL="http://127.0.0.1:$http_port/index.html" \
OUT_DIR="$out" ONLY="$only" \
CDP_PORT="$cdp_port" VW="$vw" VH="$vh" \
  node "$here/shoot.js"
