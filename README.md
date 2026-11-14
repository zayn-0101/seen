# 拾影 Seen

> 把看过的长视频，变成可回顾的知识笔记。

Seen 在本机跑一个轻量服务，自动发现你在浏览器里看的 **B 站 / 抖音精选 / YouTube** 长视频，抓字幕或转写音频，交给大模型整理成结构化笔记，直接写进你的 Obsidian 知识库。

笔记留在你自己电脑上，模型可以用你自己的，不需要登录任何账号，也不会上传视频内容。

<p align="center">
  <img src="docs/seen-concept-light.png" alt="拾影 Seen 工作台" />
</p>

<sub>概念示意图，内容为虚构示例；实际界面以当前版本为准。</sub>

---

## 特性

| 能力 | 说明 |
|---|---|
| **自动检测** | 每 15 秒观察前台浏览器，识别 B 站、抖音精选、YouTube 正在播放的视频 |
| **内容抓取** | B 站取 AI 字幕或 UP 主字幕；YouTube 取人工字幕，没有则下载音频本地转写；抖音下载音频本地转写 |
| **智能总结** | 一句话摘要、核心知识点、讨论焦点、Mermaid 思维导图，全中文输出 |
| **学科组织** | 自动判断学科，维护学科学习手册与全局课程总览 |
| **时间戳跳转** | 笔记的章节和知识点带时间链接，点击跳回视频对应位置 |
| **知识索引** | 每次生成笔记后重建索引表，按时间、学科检索全部内容 |
| **每周回顾** | 自动汇总本周新增，生成一篇回顾 |
| **阶段通知** | 开始整理 / 本地转写（附预计耗时）/ 笔记生成 / 处理失败，四个节点各一条 macOS 通知 |
| **模型自由** | 24 个内置供应商预设，支持任意 OpenAI 兼容接口 |

## 环境要求

- macOS 12 或更新（简体中文或英文系统均可）
- [Node.js](https://nodejs.org/) 20 或更新
- [Obsidian](https://obsidian.md/) 和一个 vault
- 一个可用的模型 API Key（或本机运行 Ollama、LM Studio、Magpie 等）

项目本身零 npm 依赖，不需要 `npm install`。下面这些外部工具**按需使用**，已安装的优先用本机的，缺了大部分会自动补上：

| 工具 | 用在哪 | 缺失时 |
|---|---|---|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | YouTube 解析、B 站 AI 字幕 | 自动下载到 `~/.seen/bin` |
| [ffmpeg](https://ffmpeg.org/) | 音频预处理 | 自动下载静态二进制 |
| Whisper 模型 | 无字幕时的本地转写 | 面板里按推荐选一个下载 |
| whisper-cli | 无字幕时的本地转写 | 面板里点按钮代跑 Homebrew |
| Chrome | 抖音页面解析 | 需自行安装 |

## 快速开始

### 1. 获取代码

```bash
git clone https://github.com/zayn-0101/seen.git
cd seen
```

### 2. 启动

```bash
node server/index.js     # 前台运行，日志直接输出
npm start                # 同上
open seen.command        # 在访达里双击
```

服务监听 `127.0.0.1:4780`，浏览器面板会自动打开。

### 3. 配置模型（首次必做）

在面板右上角点模型状态，或直接访问 <http://127.0.0.1:4780/#settings>：

1. 选择供应商（按 国内 / 国际 / 本地 分组）
2. 粘贴 API Key
3. 点「获取模型列表」挑一个
4. 点「测试连接」确认可用
5. 保存

保存后立即生效。如果本机装了 Magpie 网关，启动时会自动识别并使用，可以跳过这一步。

### 4. 验证

面板点「诊断」，全部正常会显示「一切正常」。然后打开一个视频页面，前台保持 30 秒左右，看是否生成笔记。

### 5. 菜单栏应用（可选）

```bash
cd menubar
./build.sh --install     # 编译并安装到 ~/Applications/Seen.app
open ~/Applications/Seen.app
```

菜单栏应用提供轮询状态、启停、打开面板与笔记目录、生成每周回顾、运行诊断、登录自启。服务没在跑时会自动拉起，退出时停掉它启动的服务。

---

## 使用

### 自动检测

服务每 15 秒读取前台窗口（AppleScript + `lsappinfo`）。识别到视频页面后：

1. 连续两次检测到同一视频才处理，避免误触
2. 抓取简介、标签、字幕或音频
3. 调用模型总结
4. 写入 Obsidian
5. 发通知

轮询间隔和稳定次数可以在面板里调整。

### 手动整理

面板顶部输入框粘贴链接 → 点「立即整理」。「强制重生成」会忽略已有笔记重新总结。

### 面板

<http://127.0.0.1:4780> 是主界面：

- **工作台**：视频链接输入、轮询控制、最近总结、实时观察
- **知识库**：已生成的视频笔记卡片
- **设置**：模型配置、轮询间隔、记忆库开关

### 通知

四个节点各一条 macOS 通知：

| 节点 | 内容 |
|---|---|
| 识别到视频 | 「拾影 · 开始整理」+ 平台名 |
| 进入本地转写 | 「拾影 · 本地转写中」+ 预计耗时 |
| 处理完成 | 「拾影 · 笔记已生成」+ 学科和平台 |
| 处理失败 | 「拾影 · 处理失败」+ 具体原因 |

中间的下载、分类、总结只在面板更新进度，不逐条弹通知。收不到的话检查「系统设置 → 通知」里是否允许了 Seen。

---

## 输出

### 目录结构

```
<你的 vault>/
└── 课程知识地图/
    ├── 课程总览.md              # 全部学科与视频数量
    ├── 索引.md                  # 全部视频索引表，自动维护
    ├── 每周回顾/
    │   └── 2026-W46.md         # 每周一篇，已存在不覆盖
    ├── 机器学习/
    │   ├── 机器学习 学习手册.md
    │   ├── 梯度下降详解.md
    │   └── ...
    └── 前端开发/
        └── ...
```

### 视频笔记

每个视频一篇原子笔记：

- frontmatter：标题、学科、来源、链接、时间、内容来源标签
- 一句话摘要
- 核心知识点（带时间戳链接）
- 弹幕 / 评论焦点
- Mermaid 思维导图
- 抓取统计与内容可信度标注

### 学习手册与总览

学科级知识地图，包含 Mermaid mindmap 和该学科全部视频链接。只更新 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间的内容，你在「我的补充」里写的东西不会被覆盖。

### 索引

每次生成笔记后重建 `索引.md`：

| 日期 | 标题 | 学科 | 来源 |
|---|---|---|---|
| 2026-11-13 | 梯度下降为什么有效 | 机器学习 | B站 |
| 2026-11-14 | 线性代数的本质 | 数学 | YouTube |
| 2026-11-14 | 三分钟看懂相对论 | 物理 | 抖音 |

### 每周回顾

包含本周新增数量、学科分布、按天记录（带笔记双链）、关键词、值得重看。触发方式：服务启动时补生成上周、菜单栏点「本周回顾」、或 `POST /api/review`。已存在的文件不覆盖。

---

## 配置

### 模型

配置保存在 `~/.seen/llm.json`（权限 600），也可用环境变量覆盖。

- **国内**：DeepSeek、通义千问、Kimi、智谱 GLM、豆包、文心、混元、星火、MiniMax、阶跃星辰、硅基流动
- **国际**：OpenAI、Gemini、OpenRouter、Grok、Groq、Mistral、Together、Fireworks
- **本地**：Magpie（自动检测）、Ollama、LM Studio、vLLM
- **自定义**：手动填 baseURL 和模型 ID

优先级：保存的设置 → 环境变量 → 自动探测 Magpie → 未配置。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SEEN_PORT` | 4780 | 服务端口 |
| `SEEN_HOST` | 127.0.0.1 | 监听地址 |
| `SEEN_NO_OPEN` | — | 设为 1 不自动打开浏览器 |
| `SEEN_VAULT` | 自动检测 | Obsidian vault 路径 |
| `SEEN_NOTE_ROOT` | 课程知识地图 | vault 下的笔记根目录 |
| `SEEN_STATE_DIR` | ~/.seen/state | 状态与锁文件目录 |
| `SEEN_LLM_BASE_URL` / `SEEN_LLM_API_KEY` / `SEEN_LLM_MODEL` | — | 模型服务配置 |
| `SEEN_DISABLE_NOTIFY` | — | 设为 1 关闭通知 |
| `SEEN_DISABLE_MNEMON` | — | 设为 1 关闭记忆写入 |
| `SEEN_CHROME_BIN` / `SEEN_FFMPEG_BIN` | 自动探测 | 指定可执行文件 |
| `SEEN_GH_MIRROR` | 内置镜像 | GitHub 加速前缀，逗号分隔多个 |
| `HF_ENDPOINT` | — | HuggingFace 镜像地址 |

### 文件位置

| 内容 | 路径 |
|---|---|
| 状态与锁 | `~/.seen/state/` |
| 模型配置 | `~/.seen/llm.json` |
| 面板开关与间隔 | `~/.seen/ui.json` |
| 字幕 / 抖音 / YouTube 缓存 | `~/.seen/cache/` |
| Whisper 模型 | `~/.seen/models/ggml-<model>.bin` |
| 自动下载的工具 | `~/.seen/bin/` |
| 服务日志 | `~/.seen/server.log`、`server.err.log` |
| 菜单栏日志 | `~/.seen/menubar.log` |

### 依赖下载与镜像

依赖下载遵循同一套顺序：**已安装的本机版本 → 配置文件 → PATH → `~/.seen/bin` → 常见安装位置**，自动下载的副本不会覆盖你手动装的。

- **GitHub**（yt-dlp、ffmpeg）：官方地址失败后自动换公共镜像重试，可用 `SEEN_GH_MIRROR` 指定自己的加速地址。
- **HuggingFace**（Whisper 模型）：按 `HF_ENDPOINT` → huggingface.co → hf-mirror.com 依次尝试。
- **安全**：yt-dlp 下载完会用官方 `SHA2-256SUMS` 校验 SHA256；走镜像下载时校验不通过会直接中止。ffmpeg-static 官方不提供校验文件，只能靠官方优先降低风险。

想提前装好：

```bash
node scripts/install-yt-dlp.mjs                       # 下载 yt-dlp
node scripts/install-ffmpeg.mjs                       # 下载 ffmpeg
node scripts/install-whisper-model.mjs                # 下载 Whisper 模型（默认 large-v3-turbo）
node scripts/install-whisper-model.mjs --model small  # 换成轻量模型
```

### 可选集成

**mnemon**：本机装了 mnemon 记忆库时可以把每条总结写进去。设置页自动检测 CLI：检测到则开关默认打开，没检测到则置灰。

**Obsidian CLI**：装了 `obsidian-cli` 并开启 `openInObsidian` 后，生成笔记会自动在 Obsidian 中打开。

---

## 平台支持

| 平台 | 字幕 | 评论 | 时间链接 | 依赖 |
|---|---|---|---|---|
| B 站 | AI 字幕 / UP 主字幕 | 抓取（最多 50 条） | 支持 | yt-dlp |
| YouTube | 人工字幕，无则本地转写 | 不抓取 | 支持 | yt-dlp、ffmpeg、Whisper |
| 抖音精选 | 无字幕，全部本地转写 | 只取总数 | 不支持 | Chrome、ffmpeg、Whisper |

转写耗时参考：large-v3-turbo 模型约 3 倍速，45 分钟视频约 15 分钟。有字幕的视频通常几秒到几十秒完成。

---

## 常见问题

### 看了视频但没有生成笔记

1. 面板点「诊断」，看哪一项失败
2. 确认浏览器地址栏是具体视频页，不是首页、搜索页、直播或番剧
3. 看 `~/.seen/state/poll.log` 最后几行
4. 确认模型服务可用（诊断里的「模型服务」）

### 提示需要「自动化」权限（macOS）

macOS 读取浏览器窗口需要 AppleScript 自动化权限：

1. 打开「系统设置 → 隐私与安全性 → 自动化」
2. 找到 Seen（或启动服务的终端），勾选 System Events 和浏览器

macOS 27 已移除独立的「辅助功能」分类，网上旧教程的路径在新系统里找不到，属于系统改版。

### 菜单栏图标看不见

装了 Bartender、Ice、Hidden Bar 等菜单栏管理工具时，新图标默认可能被收进折叠区。点开折叠箭头找一下，或在工具的设置里把 Seen 设为始终显示。

### 抖音 / YouTube 提示缺少组件

诊断面板会列出缺什么，大部分能直接点按钮解决：

- **ffmpeg、yt-dlp**：自动下载，失败换镜像
- **whisper-cli**：点「安装 whisper-cli」，应用代跑 `brew install whisper.cpp`
- **Whisper 模型**：按推荐选一个下载（推荐 Large v3 Turbo）
- **Chrome**：需要自己装，`brew install --cask google-chrome`

### 在中国大陆访问 YouTube

需要先开代理，系统级代理即可，应用会沿用。诊断里「YouTube 网络」是绿的就没问题。

### 学科判断不对

学科由模型判断。可以手动改笔记 frontmatter 的 `subject` 并移动文件，应用不会自动纠正已生成的笔记。

### 同一个视频生成了两篇

按视频 ID 或归一化标题去重。如果视频换了标题，可能被当成新内容，手动删掉多余那篇即可。

### 端口被占用

```bash
SEEN_PORT=4781 node server/index.js
```

### 如何卸载

```bash
rm -rf ~/Applications/Seen.app    # 菜单栏应用
node scripts/uninstall-launchd.mjs # 如果设了开机自启
rm -rf ~/.seen                      # 运行数据（笔记不受影响）
```

---

## 架构

```
web/         浏览器面板（原生 HTML/CSS/JS）
  ↕ HTTP + SSE
server/      本地服务（API、SSE、静态文件、LLM 适配）
  ↕
core/        视频引擎（检测、抓取、总结、渲染、写入）
  ↓
Obsidian     vault 中的 Markdown
```

- **core**：纯 ESM JavaScript，零 npm 依赖，可单独 import 和测试
- **server**：Node 内置 http，不依赖框架
- **web**：无构建步骤的原生前端
- **menubar**：Swift 6 + AppKit，只通过 HTTP 调服务

详细设计见 [docs/architecture.md](docs/architecture.md)，模块契约见 [docs/contracts.md](docs/contracts.md)。

## 开发

```bash
cd core && node --test          # 运行测试（93 项）
cd menubar && ./build.sh        # 编译菜单栏应用
npm run check                   # 语法检查
```

开发约定见 [CLAUDE.md](CLAUDE.md)。

## 数据与隐私

- 笔记、缓存、配置全部在本机
- 视频内容只在总结时发送给你配置的模型服务
- B 站 Cookie 仅用于抓取字幕和评论，通过 yt-dlp 临时读取，用后立即删除，不写日志、不写配置
- 抖音解析使用独立的临时 Chrome profile，不读取日常浏览器的 Cookie
- YouTube 解析通过本机 yt-dlp 完成，不读取浏览器 Cookie，也不调用 YouTube Data API
- API Key 保存在 `~/.seen/llm.json`（权限 600），接口回显脱敏，日志不记录

## 已知限制

- 只支持 B 站、抖音精选和 YouTube
- 抖音不抓取评论/弹幕正文，YouTube 不抓取评论
- 无字幕视频需要本地转写，耗时明显更长
- AI 字幕与本地转写都可能存在同音错字，笔记不保证 100% 准确
- 只在 macOS 上测试过，Windows 保留了前台检测实现但未维护
- 平台改版或 yt-dlp 接口变化可能导致抓取失效

## 许可

MIT License。本项目最初基于 [linner1224/dsh-video-coursemap](https://github.com/linner1224/dsh-video-coursemap) 2.0.0（MIT）的架构，保留其 B 站抓取思路，已独立演进为 macOS / Obsidian 方向。
