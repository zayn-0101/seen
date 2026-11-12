#!/bin/bash
# 从选定的松鼠母版导出菜单栏、应用和网页图标；母版未变化时跳过。
set -euo pipefail
cd "$(dirname "$0")/../.."

SRC_DIR="menubar/icon/squirrel"
HASH_FILE="menubar/build/.icon-source-hash"

mkdir -p menubar/build

hash="$(cat "$SRC_DIR"/*.svg | shasum -a 256 | awk '{print $1}')"

if [ "${FORCE_ICONS:-0}" != "1" ] \
   && [ -f "$HASH_FILE" ] \
   && [ "$(cat "$HASH_FILE")" = "$hash" ] \
   && [ -f menubar/Resources/AppIcon.icns ] \
   && [ -f menubar/Resources/StatusIcon@2x.png ] \
   && [ -f web/icons/favicon.ico ]; then
  echo "图标母版未变化，跳过导出（FORCE_ICONS=1 强制重导）"
  exit 0
fi

node scripts/export-icons.mjs
echo "$hash" > "$HASH_FILE"
