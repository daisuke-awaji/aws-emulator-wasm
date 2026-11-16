#!/usr/bin/env bash
# Sparse-checkout the pinned upstream commit and trim its workspace to the crates we need.
# usage: scripts/fetch-upstream.sh [dest] [seed-crate-dir...]
set -euo pipefail
UPSTREAM_REPO=https://github.com/aws/aws-emulator.git
UPSTREAM_COMMIT=${UPSTREAM_COMMIT:-813af480bf7f16d5418b64e4f5644a74a7da11c5}
HERE=$(cd "$(dirname "$0")" && pwd)
DEST=${1:-$HERE/../.upstream}
shift || true
if [ "$#" -eq 0 ]; then
  set -- services/service-com-amazonaws-dynamodb-dynamodb-20120810 services/service-com-amazonaws-sqs-amazonsqs
fi

if [ ! -d "$DEST/.git" ]; then
  git clone --filter=blob:none --no-checkout "$UPSTREAM_REPO" "$DEST"
fi
cd "$DEST"
git sparse-checkout init --no-cone
git sparse-checkout set '/Cargo.toml' '/Cargo.lock' '/LICENSE' '/vendor/' '/services/*/Cargo.toml'
git checkout -q "$UPSTREAM_COMMIT"
git checkout -q -- .
CLOSURE=$(python3 "$HERE/closure.py" "$@")
# shellcheck disable=SC2046
git sparse-checkout add $(printf '/%s/\n' $CLOSURE)
rm -rf wasm-host && cp -r "$HERE/../crates/wasm-host" wasm-host
python3 "$HERE/trim_workspace.py" . $CLOSURE wasm-host
if [ "${SKIP_WASM_PATCH:-0}" != 1 ]; then python3 "$HERE/patch_wasm.py" .; fi
echo "$CLOSURE" > .closure
echo "upstream ready at $DEST ($UPSTREAM_COMMIT)"
