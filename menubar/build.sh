#!/bin/bash
# 编译并打包 Seen 菜单栏应用：dist/Seen.app
#
#   ./build.sh                    轻量构建（当前架构，用系统 Node，日常开发）
#   ./build.sh --bundle           分发构建（内嵌 Node 运行时，默认通用二进制）
#   ./build.sh --bundle --arch=arm64|x64|universal
#                                 指定目标架构（默认 universal）
#   ./build.sh --install          构建后安装到 ~/Applications
set -euo pipefail
cd "$(dirname "$0")"

REPO="$(cd .. && pwd)"
BUILD_DIR="build"
APP="dist/Seen.app"
NODE_VERSION="24.15.0"

BUNDLE=0
INSTALL=0
ARCH_MODE="universal"
for arg in "$@"; do
  case "$arg" in
    --bundle) BUNDLE=1 ;;
    --install) INSTALL=1 ;;
    --arch=arm64) ARCH_MODE="arm64" ;;
    --arch=x64) ARCH_MODE="x64" ;;
    --arch=universal) ARCH_MODE="universal" ;;
  esac
done

mkdir -p "$BUILD_DIR" dist

bash scripts/make-icons.sh

compile_arch() {
  local target_arch="$1"
  local out="$2"
  swiftc -target "${target_arch}-apple-macosx13.0" -Onone Sources/*.swift -o "$out" -framework AppKit -framework SwiftUI -framework ServiceManagement 2>/dev/null
}

if [ "$BUNDLE" = "1" ] && [ "$ARCH_MODE" = "universal" ]; then
  echo "编译 Swift 源码（arm64 + x86_64）…"
  compile_arch arm64 "$BUILD_DIR/Seen-arm64"
  compile_arch x86_64 "$BUILD_DIR/Seen-x64"
  lipo -create "$BUILD_DIR/Seen-arm64" "$BUILD_DIR/Seen-x64" -output "$BUILD_DIR/Seen"
elif [ "$ARCH_MODE" = "x64" ]; then
  echo "编译 Swift 源码（x86_64）…"
  compile_arch x86_64 "$BUILD_DIR/Seen"
elif [ "$ARCH_MODE" = "arm64" ]; then
  echo "编译 Swift 源码（arm64）…"
  compile_arch arm64 "$BUILD_DIR/Seen"
else
  echo "编译 Swift 源码（当前架构）…"
  swiftc -Onone Sources/*.swift -o "$BUILD_DIR/Seen" -framework AppKit -framework SwiftUI -framework ServiceManagement
fi

if [ -d "$APP" ]; then
  PREVIOUS_APP_DIR="$(mktemp -d "$BUILD_DIR/previous-app.XXXXXX")"
  mv "$APP" "$PREVIOUS_APP_DIR/Seen.app"
fi
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BUILD_DIR/Seen" "$APP/Contents/MacOS/Seen"

VERSION="$(cd "$REPO" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
sed -e "s|__REPO_PATH__|$REPO|g" -e "s|__VERSION__|$VERSION|g" Resources/Info.plist > "$APP/Contents/Info.plist"

cp Resources/StatusIcon@1x.png Resources/StatusIcon@2x.png "$APP/Contents/Resources/"
cp Resources/BrandIcon.png Resources/BrandIcon@2x.png "$APP/Contents/Resources/"
if [ -f Resources/AppIcon.icns ]; then cp Resources/AppIcon.icns "$APP/Contents/Resources/"; fi

fetch_node() {
  local node_arch="$1"
  local dest="$BUILD_DIR/node-runtime/node-$node_arch"
  if [ -x "$dest" ]; then return 0; fi
  mkdir -p "$BUILD_DIR/node-runtime"
  local tarball="node-v${NODE_VERSION}-darwin-${node_arch}.tar.gz"
  local dirname="node-v${NODE_VERSION}-darwin-${node_arch}"
  echo "  下载 https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}" -o "$BUILD_DIR/$tarball"
  tar -xzf "$BUILD_DIR/$tarball" -C "$BUILD_DIR"
  cp "$BUILD_DIR/$dirname/bin/node" "$dest"
  chmod 755 "$dest"
  rm -rf "$BUILD_DIR/$dirname" "$BUILD_DIR/$tarball"
  return 0
}

if [ "$BUNDLE" = "1" ]; then
  echo "准备 Node 运行时（v${NODE_VERSION}，${ARCH_MODE}）…"
  mkdir -p "$APP/Contents/Resources/runtime"
  case "$ARCH_MODE" in
    arm64)
      fetch_node arm64
      cp "$BUILD_DIR/node-runtime/node-arm64" "$APP/Contents/Resources/runtime/node-arm64"
      ;;
    x64)
      fetch_node x64
      cp "$BUILD_DIR/node-runtime/node-x64" "$APP/Contents/Resources/runtime/node-x64"
      ;;
    *)
      fetch_node arm64
      fetch_node x64
      cp "$BUILD_DIR/node-runtime/node-arm64" "$APP/Contents/Resources/runtime/node-arm64"
      cp "$BUILD_DIR/node-runtime/node-x64" "$APP/Contents/Resources/runtime/node-x64"
      ;;
  esac
  chmod 755 "$APP/Contents/Resources/runtime/"*

  echo "复制服务代码 …"
  APP_RES="$APP/Contents/Resources/app"
  mkdir -p "$APP_RES"
  cp -R "$REPO/server" "$REPO/core" "$REPO/web" "$APP_RES/"
  cp "$REPO/package.json" "$APP_RES/"
  rm -rf "$APP_RES/core/test"
  echo "  运行时 + 代码：$(du -sh "$APP/Contents/Resources" | cut -f1)"
fi

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "构建完成：${REPO}/menubar/${APP}（版本 ${VERSION}，${ARCH_MODE}$([ "$BUNDLE" = "1" ] && echo "，含运行时" || echo "，不含运行时")）"

if [ "$INSTALL" = "1" ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Seen.app"
  cp -R "$APP" "$HOME/Applications/Seen.app"
  echo "已安装：$HOME/Applications/Seen.app"
fi
