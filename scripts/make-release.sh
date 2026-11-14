#!/bin/bash
# 生成可分发的安装镜像：dist/Seen-v<version>.dmg
#
# 内含已打包的 Seen.app（内嵌 Node 运行时与服务代码）+ Applications 软链，
# 用户打开 dmg 把 app 拖进「应用程序」即可。
#
#   ./scripts/make-release.sh                 默认通用二进制（arm64 + x64）
#   ./scripts/make-release.sh --arch=arm64    只出 Apple Silicon 版
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="$(pwd)"
VERSION="$(node -p "require('./package.json').version")"
APP="menubar/dist/Seen.app"
STAGE="build/release"
ARCH_MODE="universal"
for arg in "$@"; do
  case "$arg" in
    --arch=arm64) ARCH_MODE="arm64" ;;
    --arch=x64) ARCH_MODE="x64" ;;
    --arch=universal) ARCH_MODE="universal" ;;
  esac
done
if [ "$ARCH_MODE" = "universal" ]; then
  DMG="dist/Seen-v$VERSION.dmg"
else
  DMG="dist/Seen-v$VERSION-$ARCH_MODE.dmg"
fi

echo "== 构建打包版（${ARCH_MODE}）=="
(cd menubar && ./build.sh --bundle --arch="$ARCH_MODE")

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
