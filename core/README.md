# Seen Core · 视频知识引擎

拾影（Seen）的应用核心：检测前台浏览器视频 → 学科分类 → 抓取字幕/弹幕/评论 → LLM 总结 → 渲染 Obsidian Markdown。

纯 ESM、零 npm 依赖，可单独 import 和测试；外部可执行文件（yt-dlp、ffmpeg、whisper-cli）按需探测，yt-dlp 缺失时会自动下载。

## 作为库使用

由 `server/` 构造 `ctx`（提供 `llm`、`logger`、`tools` 等）后调用：

```js
import { apply } from '../core/lib/index.js'

const controller = apply(ctx, { autoStart: false, exposeController: true })
```

`apply` 返回控制器：

```
start() / stop() / setPollInterval(ms) / scan({ url, force })
getStatus() / getSnapshot() / getHistory() / getConfig() / getEvents()
onEvent(fn) / isReadOnly() / isStarted()
```

事件类型：`foreground / stable / detected / fetching / progress / content / classified / transcript / summarizing / summarized / saved / skipped / error / status`。

## 模块

| 目录 | 职责 |
|---|---|
| `lib/index.js` | 编排：轮询、去重、分类、总结、写入 |
| `lib/source.js` `douyin.js` `bilibili.js` `youtube.js` | 平台识别与内容抓取 |
| `lib/transcript.js` | 字幕获取、SRT 解析、时间轴 |
| `lib/analyze.js` | 提示词与 LLM 输出解析 |
| `lib/render.js` | Markdown 渲染（笔记、手册、总览） |
| `lib/obsidian.js` | vault 写入与 AUTO 区块更新 |
| `lib/session.js` `ytdlp.js` | B 站登录态、yt-dlp 定位与自动安装 |
| `lib/whisper.js` | 音频工具与本地转写：ffmpeg 缺失自动下载、模型按推荐选项下载，调 whisper.cpp 转写 |
| `lib/download.js` | 下载候选地址：官方优先，GitHub release 追加镜像兜底 |
| `lib/foreground*.js` | 前台窗口检测（macOS / Windows） |
| `lib/state.js` | 状态持久化与去重记录 |
| `lib/mnemon.js` | 可选的本地记忆库写入 |
| `lib/index-note.js` `review.js` `notify.js` | 索引、每周回顾、系统通知 |
| `lib/config.js` | 配置解析与默认值 |

## 开发

```bash
node --test
```

接口契约见 [../docs/contracts.md](../docs/contracts.md)，架构见 [../docs/architecture.md](../docs/architecture.md)。
