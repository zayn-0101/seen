# 拾影 Seen · 视频知识笔记

## 项目目标

把 B 站 / 抖音精选 / YouTube 网页课程长视频自动转化为 Obsidian 知识笔记：

1. 定时检测前台浏览器正在播放的视频；
2. 去重后按学科分类：旧学科更新学习手册，新学科新建学习手册；
3. 抓取视频简介/标签/字幕/弹幕/评论，LLM 生成知识总结；
4. 输出到 Obsidian（视频原子笔记 + 学科学习手册 + 总览）；
5. 可选：检测到本机 mnemon CLI 时把每条总结写入本地记忆库（默认关闭）。

## 目录约定

```
seen/
├── CLAUDE.md                 本文件：项目规则
├── CLAUDE.local.md           本机环境（不入库，见 .gitignore）
├── README.md                 用户手册
├── docs/
│   ├── contracts.md          模块接口契约（所有实现必须遵守）
│   ├── architecture.md       架构与数据流
│   ├── acceptance.md         验收清单与记录
│   ├── brand/                松鼠品牌规范与预览图
├── server/                   本地服务（HTTP API + SSE + 静态页面）
│   ├── index.js              路由、SSE、静态资源、通知
│   └── llm.js                供应商预设与 OpenAI-compatible 适配
├── web/                      前端（原生 HTML/CSS/JS，无构建）
├── scripts/
│   ├── export-icons.mjs          图标导出
│   ├── install-ffmpeg.mjs        下载 ffmpeg 到 ~/.seen/bin
│   ├── install-launchd.mjs       服务开机自启
│   ├── install-whisper-model.mjs 下载 Whisper 模型
│   ├── install-yt-dlp.mjs        下载 yt-dlp 到 ~/.seen/bin
│   ├── make-release.sh           构建内嵌运行时的 app 并打 dmg
│   ├── maintain-vault.mjs        按 state 重建索引、概念页、主题页、手册与总览
│   ├── migrate-vault.mjs         笔记目录迁移（含备份与路径重写）
│   ├── retag-notes.mjs           重打历史笔记的标签
│   ├── strip-cover.mjs           清掉旧笔记里的封面
│   └── uninstall-launchd.mjs
├── seen.command              双击启动服务
├── menubar/                  菜单栏应用（Swift，只调本地服务 HTTP）
└── core/                     视频引擎（包名 seen-core）
    ├── lib/                  index(编排) / source+douyin+bilibili+youtube(平台)
    │                         transcript+session+ytdlp+download(字幕与下载)
    │                         analyze(总结) / render+obsidian+index-note+review(输出)
    │                         config+state+foreground*+notify+mnemon / whisper(本地转写)
    └── test/
```

## 开发规则

- 源码只在工作区修改；**绝不直接改**已安装的依赖副本（node_modules）。
- 零 npm 依赖：只用 Node 内置模块 + 注入的 `ctx`。外部工具按需探测，缺失时 yt-dlp / ffmpeg 自动下载，Whisper 模型与 whisper-cli 由面板引导安装。
- 纯 ESM JavaScript，不引入 TypeScript 构建。
- 所有新增/修改模块必须可被 `node:test` 直接 import。
- 改完必须运行：`cd core && node --test`。
- 菜单栏应用改动后运行：`cd menubar && ./build.sh`。
- 松鼠系列以 `menubar/icon/squirrel/` 母版为准，用 `node scripts/export-icons.mjs` 统一生成应用、菜单栏和网页资源；完整交付包见 `docs/brand/`。
- 图标构建使用新的临时工作目录，保留既有构建备份，不自动删除文件。
- 日志不得记录完整弹幕/评论全文、Cookie、密钥。
- 不硬编码 vault 路径；默认自动检测，允许配置覆盖。
- 不写死绝对路径：可执行文件按「环境变量 → PATH → 常见安装位置」探测；文档和配置里的路径用 `~` 或相对仓库根。
- 不覆盖用户手写内容：学习手册/总览只更新 `<!-- AUTO:START -->` 与 `<!-- AUTO:END -->` 之间。
- vault 读写全部走 `core/lib/obsidian.js` 的异步导出（内部依次过权限守卫、串行队列、10 秒超时熔断）；不要在别处对 vault 直接用 `node:fs` 同步 API——TCC 未授权时同步 `open` 会永久挂起，把整个事件循环（含 HTTP 服务）堵死。

## 验证命令

```bash
cd core && node --test          # 引擎测试
cd menubar && ./build.sh        # 编译菜单栏应用 → menubar/dist/Seen.app
npm run check                   # 语法检查
npm run self-check              # 体检笔记库（结构/标签/双链/状态），只读
npm run self-check:llm          # 再用缓存回放跑分段与总结的模型回归
./scripts/make-release.sh       # 构建内嵌 Node 运行时的 app 并打 dmg → dist/
node server/index.js            # 独立服务，默认 http://127.0.0.1:4780
```

## 重要事实

- 模型配置在网页「模型」弹窗（23 个内置供应商预设 + 自定义），优先级：设置 → 环境变量 → 自动探测 Magpie；apiKey 存 `~/.seen/llm.json`（600）。
- 服务启动时 Magpie 可能还没就绪：模型解析会重试几次；仍没有模型就先用 null 启动（面板提示「模型未配置」），不能让空字符串让 resolveConfig 抛错退出。
- macOS 通知分四个节点（开始整理 / 本地转写含预计耗时 / 笔记已生成 / 处理失败），中间步骤只在面板显示；`SEEN_DISABLE_NOTIFY=1` 可关。
- 每次生成笔记后重建「视频索引.md」「概念索引.md」「标签索引.md」（都是 AUTO 区块）；每周回顾由 review.js 生成、obsidian.js 写入 `回顾/`，已存在不覆盖。
- 视频笔记版式（format 4，不抓封面、不画思维导图）：内容来源标注 → `[!abstract]` 一句话总结 → `[!question]` 想回答 → `[!success]` 答案 → 视频信息表 → 关键数字 → 章节 → 类型模板（按 `contentType`：教程=前置条件+操作步骤，课程=再加练习，观点=论证结构+可质疑之处，科普=机制与证据+常见误解，评测=对比表，访谈=人物观点表，纪录=事件时间线）→ 核心知识点（主题和每条要点都可带 `t=` 时间链接）→ 核心概念（带 `^concept-xxx` 块引用）→ 原话摘录（≤3 条、每条 ≤80 字、带时间）→ 术语表（3~8 个）→ 提到的资源（≤6 个）→ 相关笔记双链 → 讨论焦点 → 我的补充 → 折叠的抓取统计。frontmatter 记 `contentType` 与 `quality`（1 = 仅元数据，2~5 按完整度和信息密度由 scoreNoteQuality 打分）。关键数字只收能支撑结论或可直接行动的量化信息，normalizeNumbers 会过滤时长、体积、播放/点赞数、弹幕评论条数这类视频自身元数据；仅元数据（没有字幕）的视频不写关键数字、核心概念、模板、原话、术语与资源。重写笔记时 mergeManualSection 保留「我的补充」。
- 内容类型与结构化字段由 note-content.js 负责：CONTENT_TYPES 8 类（tutorial/opinion/science/review/interview/documentary/course/other），normalizeTemplate 按类型只保留对应字段并卡 TEMPLATE_LIMITS（steps 8、quotes 3、terms 8、resources 6 等），normalizeQuotes 只接受数组且每条 ≤80 字，normalizeTerms 名称 2~12 字（超长直接丢，不截断），scoreNoteQuality 算 1~5 分（仅元数据固定 1）。
- 发布前润色（editorPass）默认关闭，开启后 summarize 末尾调 editSummary 多跑一次模型只顺摘要/问答的表达、不新增事实，失败保留原文；面板「重刷历史」走 POST /api/reprocess → engine.refreshHistory，processTitle 的 refresh:true 会覆盖笔记但内容与字幕抓取仍 force=false，复用缓存不重转写。
- 间隔复习由 review-schedule.js 负责：每篇笔记带「## 复习卡片」（`问题::答案`，最多 5 条）与 frontmatter `review` 进度；nextReview 的 easy 走 1/3/7/16/35 天阶梯、hard 间隔 ×1.5、again 明天重来并清零 reps；`GET /api/reviews` 列到期，`POST /api/reviews` 传 notePath/rating 写回 state 与笔记 frontmatter；重刷笔记时 processTitle 会按 bvid/videoId/title 找回旧进度，不重置。周回顾含「复习情况」与「学习统计」两段。
- 学科归类由 subject.js 的 alignSubject 归并：精确 → 包含且长度差≤2 → 共享≥2 连续汉字 → 已有 12 个学科时封顶取最接近。LLM 提示词要求输出 2~4 字宽泛领域名。
- 推理型模型（如 magpie 的 deepseek）会把 maxTokens 全花在思考上、正文返回空串。callLlm 在拿到空正文时自动翻倍预算重试一次；分段这类短输出场景也别把预算压到 800 以下。
- 无章节视频（B 站没设分 P 章节、抖音、YouTube 无原生章节）由 analyze.segmentTranscript 按时间轴采样让模型切 3~5 段；模型若回解释文字而不是 JSON，会再要一次；模型抄错几秒的起始时间会就近吸附到候选点（±8 秒），偏太远视为编造丢弃。B 站内容必须带 duration 才会触发（≥4 分钟）。
- 跨笔记关联由 concept.js 负责：conceptKey 去标点空白归一概念名，findRelatedVideos 按「共享概念×2 + 共享关键词」打分取前 5，buildConceptIndex 供概念索引页与 `GET /api/concepts`（面板概念浏览）使用。学科手册的「本学科核心概念」只收出现在 ≥2 篇笔记里的概念。
- 标签由 tags.js 负责：mergeTags 固定顺序 学科 → 主题（裸标签）→ `类型/<枚举>` → `概念/xxx`；主题由 LLM 在总结那次调用里一并给出（2~6 字，去泛化词，同篇包含合并保留更长者，上限 4），类型从 8 个固定枚举（教程/科普/访谈/评测/观点/纪录/播客/课程）里选 0~2 个；概念名限 2~8 字、带括号直接丢弃、上限 6。不再拼「视频课程」/平台名/学科进 tags（平台看 source 字段）。主题词表存在 state.tagVocabulary，buildTagVocabulary 取前 40 个注入提示词（只要求「能准确概括才复用，不相关不要硬套」），rememberTags 只累加裸主题词、超 500 按次数淘汰。历史笔记回填用 `node scripts/retag-notes.mjs`（默认预演，`--apply` 才写并先备份）；状态里没有概念的早期笔记，脚本会先看旧标签的 `概念/`，再让模型从正文抽一批并写回 `video.concepts`，否则概念索引会缺这些篇。
- 问笔记库由 ask.js 负责：`searchVault` 取前 8 条（只读视频笔记/概念页/主题综述），最多读 5 篇正文交给 `answerQuestion`；回答要求 `[[路径|标题]]` 引用，`extractCitations` 映射回笔记。面板「问笔记库」走 `POST /api/ask`。主题标签合并走 `POST /api/tags/merge` → `engine.renameTag`（`mergeTagInVideos` 替换、逐篇 `updateNoteTags`、同步 `tagVocabulary` 后重建索引），类型/概念标签不允许合并。
- 笔记结构（paths.js）：根目录默认「视频笔记」，`structured`（默认）= `视频笔记/笔记/<学科>/<标题>.md` + `手册/<学科>.md` + `回顾/<周>.md`，根下放 `总览.md`、`视频索引.md`、`概念索引.md`、`标签索引.md`；`flat` = `视频笔记/<学科>/<标题>.md`（手册与笔记同学科目录）。布局可在面板工作台「目录」里切换（写 `~/.seen/ui.json` 的 `noteLayout`，`SEEN_NOTE_LAYOUT` 可覆盖），引擎的 `setNoteLayout` 只改运行中的配置、不搬文件；迁移用 `node scripts/migrate-vault.mjs`（默认预演，`--apply` 才动并先备份到 `_备份/`）；迁移会同时改写笔记里的手册双链和 state.json 里的 notePath（索引、概念索引、相关笔记都从 state 的路径生成，不同步会全指到旧位置）。旧路径引用（含没有前导斜杠的 `[[视频笔记/学科/…]]`、行首写法）统一由 `core/lib/legacy-refs.js` 的 `rewriteLegacyRefs` 重写，迁移脚本和事后修补共用同一套规则。
- 字幕存档与重整理：有字幕或转写的视频，生成笔记时会把原文另存到 `<noteRoot>/字幕/<笔记名>.md`（frontmatter `type: transcript`、`format: 1`，不参与索引/概念/标签）；`transcript-note.js` 的 `renderTranscriptNote` / `parseTranscriptNote` 负责读写。面板「用存档字幕重新整理」走 `POST /api/resummarize` → `engine.resummarizeNote({notePath})`，读存档后按 `refresh: true` 重跑 `processTitle`，不再下载或转写。字幕缓存 `transcriptCacheDays` 默认 30 天。
- 概念页与主题页：`topic-pages.js` 的 `collectConceptPages` 只给出现 ≥2 篇笔记的概念建页，`collectTopicPages` 只给出现 ≥3 篇的主题标签建页，路径分别是 `<noteRoot>/概念/<名字>.md`、`<noteRoot>/主题/<名字>.md`；主题页的「相关概念」只链接真实存在的概念页。全量重建由 `rebuild.js` 的 `rebuildKnowledgePages` 完成（索引 → 概念页 → 主题页 → 手册 → 总览），`engine.rebuildKnowledgePages` 暴露给服务，`scripts/maintain-vault.mjs` 可直接按 state 重建（`--dry-run` 只统计）。`GET /api/quality` 汇总 history 的 quality：`{total, scored, low}`，面板知识库对 quality ≤2 的笔记出提示。
- 笔记自检（离线）：core/lib/note-check.js 是纯函数、不碰文件系统，解析 markdown 后断版式区块与顺序、四层标签、章节时间轴、概念块引用；scripts/self-check.mjs 负责读库与汇总。frontmatter 的 `format: 4` 标记当前版式（低于 4 的旧笔记只按旧规则告警），没有该字段的旧笔记结构缺失降级为警告（否则历史笔记永远红）；当前格式还会反查封面、思维导图、「所属章节」是否回潮。旧笔记清理（去封面）用 core/lib/note-clean.js 的 `stripCover` 与 `scripts/strip-cover.mjs`（默认预演，`--apply` 才写并先备份）。`npm run self-check` 只读体检（笔记 + 四篇索引 + 手册 AUTO 区块 + state 的 notePath/标签/学科一致性）；`npm run self-check:llm` 用 `~/.seen/cache/` 的缓存回放分段与总结，不联网、不写笔记，每个用例跑 3 次（`--runs`），通过率低于 2/3 或出现空结果判失败。
- 启动时查 GitHub Releases 最新 tag 比对版本（每天最多一次，只带 User-Agent；`SEEN_DISABLE_UPDATE_CHECK=1` 可关），落后时面板顶部显示提示条。
- 处理失败会记入 state.failures（含 title/url/source/bvid/videoId），面板「失败记录」可一键重试；`/api/retry` 先用保存的链接重跑，成功后清空记录。
- B 站与 YouTube 的原生章节和知识点带 `t=` 时间链接；抖音没有原生章节，只有 AI 切出来的逻辑段。本地转写（whisper `-osrt`）会产出带时间戳的 `timedTranscript`，所以抖音/YouTube 的长视频同样能切段。
- 菜单栏应用是独立 Swift 客户端，只通过 HTTP 调服务；登录自启优先 SMAppService，不可用时回退 LaunchAgent。
- 远程仓库：`https://github.com/zayn-0101/seen`（公开，默认分支 `main`）。改动完成后记得提交并推送。
- 应用是独立桌面程序，`core/` 是本机引擎，不做网络服务依赖。
- 发版步骤：改 `package.json` 的 version → `./scripts/make-release.sh` 出 `dist/Seen-v<版本>.dmg` → 打 tag `v<版本>` 并推送。安装包内嵌服务代码，所以用户升级必须重装 dmg；仓库代码改了不重新打包，菜单栏 app 里跑的还是旧代码。
- 分发形态：`menubar/build.sh --bundle` 编译通用二进制（arm64 + x86_64，lipo 合并）并把两份 Node 运行时与服务代码塞进 app（约 233MB），`scripts/make-release.sh` 打成 dmg（约 85MB）；启动时按 CPU 架构选 `runtime/node-arm64` 或 `node-x64`，开发版回退系统 node。可用 `--arch=arm64|x64` 单独出包。构建时优先用钥匙串里的 `Seen Local Signing` 自签名证书（可用 `SEEN_SIGN_IDENTITY` 覆盖），证书缺失才回退 ad-hoc；分发出去仍非 Apple 开发者签名，首次打开需右键或去 quarantine。
- 上游参考：`linner1224/dsh-video-coursemap` 2.0.0（MIT）；保留其 B 站抓取思路，已独立演进为 macOS / Obsidian 方向。
- 笔记库权限（macOS TCC）：服务启动时用子进程探针（`core/lib/vault-access.js` 的 `probeVaultAccess`）判断 `ok / missing / denied / timeout`，结果进 `status.vault`；未授权时所有 vault 读写立即抛 `VaultBlockedError`（不再挂死），面板顶部红条提示并带「重新检测」（`POST /api/vault/probe`，不用重启），`/api/search` 返回 `blocked:true`，索引与周回顾跳过，失败不记入 state.failures。obsidian.js 的每个写操作都过 `runVaultTask`（守卫 → 串行队列 → 10 秒超时熔断）。构建脚本优先用 `Seen Local Signing` 固定证书签名（DR = identifier + certificate leaf），同证书重装不会改变 designated requirement，系统「文稿文件夹」授权可保留；证书丢失或回退 ad-hoc 时仍需用户重新授权。第一次安装仍要在「系统设置 → 隐私与安全性 → 文件与文件夹」给 Seen 打开「文稿文件夹」。
- macOS 前台窗口读取依赖 AppleScript，需要「系统设置 → 隐私与安全性 → 自动化」授权；macOS 27 已移除独立的「辅助功能」分类，诊断要按实际调用能力判断，不能查 UI elements enabled 标志。
- B 站取 UP 主/AI 字幕；没有字幕时用 yt-dlp 下载 bestaudio、ffmpeg 转 16kHz 单声道 wav、本地 Whisper 转写，失败仍出仅元数据笔记。多 P 视频的去重键是 `bvid:<BV>:p<n>`（P1 仍是 `bvid:<BV>`），字幕缓存按 `<bvid>__<cid>.json`，P2 起的笔记标题带「- Pn 分P名」，状态里记录 page/cid，避免分P互相覆盖。
- 抖音精选依赖无头 Chrome（解析 SSR `RENDER_DATA`，带 UA/中文 locale/反自动化参数，首次失败等 800ms 重试一次，验证页与作品不存在分别给明确提示）、ffmpeg、whisper-cli 和本地模型；不保存抖音 Cookie；只取评论/弹幕总数，不抓正文。只处理 `/jingxuan` 精选页；普通 `/video/<id>` 在自动检测与手动粘贴时都拒绝，历史重刷（refresh）例外。
- YouTube 走本机 yt-dlp：`-J` 取元数据；字幕按「人工优先自动」且先原声语言（`parseYoutubeJson` 的 `language`，自动字幕先找 `<lang>-orig`），再按中英日韩兜底；都没有则下载音频本地转写（下载音频必须加 `--extractor-args "youtube:player_client=tv,web_embedded"`，默认 client 常 403）；不读取浏览器 Cookie，不用 YouTube Data API。
- YouTube 自动字幕接口限制严格（实测多为 429），实际常落到本地转写；结果缓存 `~/.seen/cache/youtube/<id>.json`（`youtubeCacheDays`，默认 30 天，缓存带 version 2，缺 `timedTranscript` 的旧缓存会重建并沿用旧转写）。抖音缓存同样 30 天（`douyinCacheDays`）。
- 外部工具统一策略：「配置 → PATH → `~/.seen/bin` → 常见路径」，系统已装的优先、不会被覆盖：
  - yt-dlp：GitHub releases 官方二进制（37MB），fetch 失败回退 curl；官方失败按 `SEEN_GH_MIRROR`（默认 ghproxy.net / gh-proxy.com）镜像重试；下载后用官方 `SHA2-256SUMS` 校验，镜像来源校验不通即中止；
  - ffmpeg：ffmpeg-static 静态二进制（45MB），同样官方 → 镜像；
  - Whisper 模型：不静默下载，面板按推荐列出 turbo / small / medium / base，源按 HF_ENDPOINT → huggingface → hf-mirror；
  - whisper-cli：无免安装包，面板按钮代跑 `brew install whisper.cpp`。
