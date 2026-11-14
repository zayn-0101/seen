#!/bin/bash
# 编译并打包 Seen 菜单栏应用：dist/Seen.app
#
#   ./build.sh              轻量构建（用系统 Node，日常开发用）
#   ./build.sh --bundle     分发构建（内嵌 Node 运行时与服务代码，可脱离仓库运行）
#   ./build.sh --install    构建后安装到 ~/Applications
set -euo pipefail
cd "$(dirname "$0")"

REPO="$(cd .. && pwd)"
BUILD_DIR="build"
APP="dist/Seen.app"
NODE_VERSION="24.15.0"

BUNDLE=0
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --bundle) BUNDLE=1 ;;
    --install) INSTALL=1 ;;
  esac
done

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

VERSION="$(cd "$REPO" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
sed -e "s|__REPO_PATH__|$REPO|g" -e "s|__VERSION__|$VERSION|g" \
  Resources/Info.plist > "$APP/Contents/Info.plist"

cp Resources/StatusIcon@1x.png Resources/StatusIcon@2x.png "$APP/Contents/Resources/"
cp Resources/BrandIcon.png Resources/BrandIcon@2x.png "$APP/Contents/Resources/"
if [ -f Resources/AppIcon.icns ]; then cp Resources/AppIcon.icns "$APP/Contents/Resources/"; fi

if [ "$BUNDLE" = "1" ]; then
  echo "准备 Node 运行时（v${NODE_VERSION}）…"
  NODE_CACHE="$BUILD_DIR/node-runtime"
  NODE_BIN="$NODE_CACHE/node"
  if [ ! -x "$NODE_BIN" ]; then
    ARCH="$(uname -m)"
    TARBALL="node-v$NODE_VERSION-darwin-$ARCH.tar.gz"
    URL="https://nodejs.org/dist/v$NODE_VERSION/$TARBALL"
    mkdir -p "$NODE_CACHE"
    echo "  下载 $URL"
    curl -fsSL "$URL" -o "$BUILD_DIR/$TARBALL"
    tar -xzf "$BUILD_DIR/$TARBALL" -C "$BUILD_DIR"
    cp "$BUILD_DIR/node-v$NODE_VERSION-darwin-$ARCH/bin/node" "$NODE_BIN"
    chmod 755 "$NODE_BIN"
    rm -rf "$BUILD_DIR/node-v$NODE_VERSION-darwin-$ARCH" "$BUILD_DIR/$TARBALL"
  fi
  mkdir -p "$APP/Contents/Resources/runtime"
  cp "$NODE_BIN" "$APP/Contents/Resources/runtime/node"
  chmod 755 "$APP/Contents/Resources/runtime/node"

  echo "复制服务代码 …"
  APP_RES="$APP/Contents/Resources/app"
  mkdir -p "$APP_RES"
  cp -R "$REPO/server" "$REPO/core" "$REPO/web" "$APP_RES/"
  cp "$REPO/package.json" "$APP_RES/"
  rm -rf "$APP_RES/core/test"
  echo "  运行时 + 代码：$(du -sh "$APP/Contents/Resources" | cut -f1)"
fi

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "构建完成：${REPO}/menubar/${APP}（版本 ${VERSION}，$([ "$BUNDLE" = "1" ] && echo "含运行时" || echo "不含运行时")）"

if [ "$INSTALL" = "1" ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Seen.app"
  cp -R "$APP" "$HOME/Applications/Seen.app"
  echo "已安装：$HOME/Applications/Seen.app"
fi
