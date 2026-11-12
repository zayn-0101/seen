#!/bin/bash
cd "$(dirname "$0")" || exit 1
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="~/.local/share/fnm/node-versions/v24.15.0/installation/bin/node"
fi
exec "$NODE_BIN" server/index.js
