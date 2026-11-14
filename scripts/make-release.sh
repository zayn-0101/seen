#!/bin/bash
# 生成可分发的安装镜像：dist/Seen-v<version>.dmg
#
# 内含已打包的 Seen.app（内置 Node 运行时与服务代码）+ Applications 软链，
# 用户打开 dmg 把 app 拖进「应用程序」即可。
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="$(pwd)"
VERSION="$(node -p "require('./package.json').version")"
APP="menubar/dist/Seen.app"
STAGE="build/release"
DMG="dist/Seen-v$VERSION.dmg"

echo "== 构建打包版 =="
(cd menubar && ./build.sh --bundle)

echo "== 准备镜像内容 =="
mkdir -p "$STAGE" dist
rm -rf "$STAGE/Seen.app" "$STAGE/Applications"
cp -R "$APP" "$STAGE/Seen.app"
ln -s /Applications "$STAGE/Applications"

echo "== 生成 dmg =="
rm -f "$DMG"
hdiutil create -volname "Seen $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null

echo
echo "完成：${REPO}/${DMG}（$(du -h "${DMG}" | cut -f1)）"
echo "未签名应用首次打开需右键 → 打开，或执行："
echo "  xattr -dr com.apple.quarantine /Applications/Seen.app"
