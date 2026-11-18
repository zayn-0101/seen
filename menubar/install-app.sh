#!/bin/bash
# 安装 Seen.app：同目录 staging + 失败回滚，避免 cp -R 覆盖中途失败导致没有应用。
#
#   ./install-app.sh <source.app> [target.app]
#
# 默认安装到 ~/Applications/Seen.app。旧版本会先移到
# ~/.seen/install-backups（可用 SEEN_INSTALL_BACKUP_DIR 覆盖），
# 新版本成功落位后才算完成；失败时把旧版本移回原位置。
set -euo pipefail

SOURCE="${1:-}"
TARGET="${2:-$HOME/Applications/Seen.app}"
BACKUP_DIR="${SEEN_INSTALL_BACKUP_DIR:-$HOME/.seen/install-backups}"

fail() {
  echo "安装失败：$*" >&2
  exit 1
}

[ -n "$SOURCE" ] || fail "缺少 source app 路径"
[ -d "$SOURCE" ] || fail "source app 不存在：$SOURCE"
[ -x "$SOURCE/Contents/MacOS/Seen" ] || fail "source app 缺少可执行文件：$SOURCE/Contents/MacOS/Seen"

TARGET_DIR="$(dirname "$TARGET")"
TARGET_NAME="$(basename "$TARGET")"
mkdir -p "$TARGET_DIR" "$BACKUP_DIR"
[ -d "$TARGET_DIR" ] || fail "无法创建安装目录：$TARGET_DIR"
[ -d "$BACKUP_DIR" ] || fail "无法创建备份目录：$BACKUP_DIR"

# 备份目录必须和目标在同一文件系统，否则 mv 会退化成复制+删除，回滚不再原子。
TARGET_DEV="$(stat -f '%d' "$TARGET_DIR")" || fail "无法读取安装目录所在磁盘"
BACKUP_DEV="$(stat -f '%d' "$BACKUP_DIR")" || fail "无法读取备份目录所在磁盘"
[ "$TARGET_DEV" = "$BACKUP_DEV" ] || fail "备份目录与安装目录不在同一磁盘：$BACKUP_DIR"

STAGING="$(mktemp -d "$TARGET_DIR/.seen-install.XXXXXX")" || fail "无法创建临时目录"
BACKUP=""
ROLLBACK_ARMED=0
FINISHED=0

# 安装中断时把旧版本放回原位；成功后才解除。SIGKILL/断电无法捕获，旧版本仍在备份目录。
rollback() {
  if [ "$FINISHED" = 1 ]; then
    return 0
  fi
  FINISHED=1
  trap - EXIT INT TERM HUP
  if [ "$ROLLBACK_ARMED" = 1 ] && [ ! -e "$TARGET" ] && [ -n "$BACKUP" ] && [ -e "$BACKUP" ]; then
    if mv "$BACKUP" "$TARGET"; then
      echo "安装中断，已恢复旧版本：$TARGET" >&2
    else
      echo "警告：回滚失败，旧版本保存在 $BACKUP" >&2
    fi
  fi
  rm -rf "$STAGING"
}

on_signal() {
  rollback
  exit "$1"
}
trap rollback EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap 'on_signal 129' HUP

cp -R "$SOURCE" "$STAGING/$TARGET_NAME" || fail "复制新版本失败，旧版本未改动"
[ -x "$STAGING/$TARGET_NAME/Contents/MacOS/Seen" ] || fail "复制后的应用不完整，旧版本未改动"

if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP="$BACKUP_DIR/$TARGET_NAME.$STAMP"
  SUFFIX=1
  while [ -e "$BACKUP" ] || [ -L "$BACKUP" ]; do
    BACKUP="$BACKUP_DIR/$TARGET_NAME.$STAMP-$SUFFIX"
    SUFFIX=$((SUFFIX + 1))
  done
  # 先武装回滚，再移动目标；信号落在两次 mv 之间也能把旧版本放回去。
  ROLLBACK_ARMED=1
  mv "$TARGET" "$BACKUP" || fail "无法备份旧版本，安装已中止"
fi

if ! mv "$STAGING/$TARGET_NAME" "$TARGET"; then
  fail "无法把新版本移动到 $TARGET"
fi

# 新版本已经落位，提交这次安装；之后的信号不再回滚。
FINISHED=1
ROLLBACK_ARMED=0
trap - EXIT INT TERM HUP
rm -rf "$STAGING"
echo "已安装：$TARGET"
if [ -n "$BACKUP" ]; then
  echo "旧版本备份：$BACKUP"
fi
