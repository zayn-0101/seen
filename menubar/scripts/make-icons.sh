#!/bin/bash
# 从选定的松鼠母版统一导出菜单栏、应用和网页图标。
set -euo pipefail
cd "$(dirname "$0")/../.."
node scripts/export-icons.mjs
