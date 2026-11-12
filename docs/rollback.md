# 回滚 DSH 插件依赖

安装脚本会先把以下文件备份到 `docs/backup/<timestamp>/`：

- `~/.dsh/profiles/desktop/package.json`
- `~/.dsh/profiles/desktop/pnpm-lock.yaml`

## 回滚步骤

1. 退出 DSH Desktop。
2. 恢复备份（把 <timestamp> 换成实际目录）：

   ```bash
   cp docs/backup/<timestamp>/package.json ~/.dsh/profiles/desktop/package.json
   cp docs/backup/<timestamp>/pnpm-lock.yaml ~/.dsh/profiles/desktop/pnpm-lock.yaml
   pnpm --dir ~/.dsh/profiles/desktop install
   ```

3. 重新打开 DSH Desktop。

## 原始依赖

`seen-core` 的原 release 地址：

```
https://github.com/linner1224/dsh-video-coursemap/releases/download/v2.0.0/dsh-video-coursemap-2.0.0.tgz
```

Obsidian 笔记不会被自动删除；如需清理请手动处理 `<vault>/课程知识地图`。

## 当前状态：DSH 插件已禁用

用户已选择只保留独立服务，`seen-core` 已从 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 移除。修改前的备份在 `docs/backup/disable-dsh-plugin-20261112-134141/`。

重新启用：把 `seen-core` 加回 bundles 数组，重启 DSH Desktop。独立服务不受影响。
