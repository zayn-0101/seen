#!/bin/bash
# 双击启动 Seen 独立服务（http://127.0.0.1:4780）
cd "$(dirname "$0")" || exit 1

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$candidate" ]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo "找不到 Node.js（需要 20 或更高版本）。请先安装：brew install node，或用 fnm / nvm 安装。" >&2
  read -r -p "按回车退出" _
  exit 1
fi

exec "$NODE_BIN" server/index.js
