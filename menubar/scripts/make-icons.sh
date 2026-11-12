#!/bin/bash
# 生成菜单栏模板图标（SF Symbols）与应用 .icns。
set -euo pipefail
cd "$(dirname "$0")/.."

ICON_SET="build/icon.iconset"
APP_SRC="${APP_SRC:-icon/app-a.svg}"
STATUS_SYMBOL="${STATUS_SYMBOL:-book.pages}"

mkdir -p Resources build

swift scripts/make-status-symbol.swift "$STATUS_SYMBOL"

rm -rf "$ICON_SET"
mkdir -p "$ICON_SET"

for s in 16 32 128 256 512; do
  rsvg-convert -w "$s" -h "$s" "$APP_SRC" -o "$ICON_SET/icon_${s}x${s}.png"
  d=$((s * 2))
  rsvg-convert -w "$d" -h "$d" "$APP_SRC" -o "$ICON_SET/icon_${s}x${s}@2x.png"
done

iconutil -c icns "$ICON_SET" -o Resources/AppIcon.icns
echo "图标已生成：StatusIcon 18/36px（$STATUS_SYMBOL），AppIcon.icns（来源 $APP_SRC）"
