#!/bin/bash
# 由 icon/*.svg 生成菜单栏模板图标与应用 .icns。
set -euo pipefail
cd "$(dirname "$0")/.."

ICON_SET="build/icon.iconset"
STATUS_SRC="${STATUS_SRC:-icon/status-a.svg}"
APP_SRC="${APP_SRC:-icon/app-a.svg}"

mkdir -p Resources build
rm -rf "$ICON_SET"
mkdir -p "$ICON_SET"

rsvg-convert -w 18 -h 18 "$STATUS_SRC" -o Resources/StatusIcon@1x.png
rsvg-convert -w 36 -h 36 "$STATUS_SRC" -o Resources/StatusIcon@2x.png

for s in 16 32 128 256 512; do
  rsvg-convert -w "$s" -h "$s" "$APP_SRC" -o "$ICON_SET/icon_${s}x${s}.png"
  d=$((s * 2))
  rsvg-convert -w "$d" -h "$d" "$APP_SRC" -o "$ICON_SET/icon_${s}x${s}@2x.png"
done

iconutil -c icns "$ICON_SET" -o Resources/AppIcon.icns
echo "图标已生成：StatusIcon 18/36px，AppIcon.icns（来源 ${STATUS_SRC} / ${APP_SRC}）"
