#!/bin/bash
# 编译并打包 Seen 菜单栏应用：dist/Seen.app
set -euo pipefail
cd "$(dirname "$0")"

REPO="$(cd .. && pwd)"
BUILD_DIR="build"
APP="dist/Seen.app"

mkdir -p "$BUILD_DIR" dist

bash scripts/make-icons.sh

echo "编译 Swift 源码 …"
swiftc -Onone Sources/*.swift -o "$BUILD_DIR/Seen" \
  -framework AppKit -framework SwiftUI -framework ServiceManagement

if [ -d "$APP" ]; then
  PREVIOUS_APP_DIR="$(mktemp -d "$BUILD_DIR/previous-app.XXXXXX")"
  mv "$APP" "$PREVIOUS_APP_DIR/Seen.app"
fi
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD_DIR/Seen" "$APP/Contents/MacOS/Seen"
sed "s|__REPO_PATH__|$REPO|g" Resources/Info.plist > "$APP/Contents/Info.plist"
cp Resources/StatusIcon@1x.png Resources/StatusIcon@2x.png "$APP/Contents/Resources/"
cp Resources/BrandIcon.png Resources/BrandIcon@2x.png "$APP/Contents/Resources/"
if [ -f Resources/AppIcon.icns ]; then cp Resources/AppIcon.icns "$APP/Contents/Resources/"; fi

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "构建完成：$REPO/menubar/$APP"

if [ "${1:-}" = "--install" ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Seen.app"
  cp -R "$APP" "$HOME/Applications/Seen.app"
  echo "已安装：$HOME/Applications/Seen.app"
fi
