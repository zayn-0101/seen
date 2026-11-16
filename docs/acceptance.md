# 验收清单

> 实施记录（2026-11-12）。完成后逐项勾选。

## 自动化

- [x] `cd core && node --test`：38 tests / 38 pass / 0 fail
- [x] 所有 lib 文件 `node --check` 通过
- [x] 实际自动检测：2026-11-12 08:57 检测到 Chrome 中的 B 站视频，08:58 生成笔记

## 本地集成测试（mock LLM + 真实 B 站接口）

- [x] `course_map_scan({ url: "https://www.bilibili.com/video/BV..." })` 生成视频笔记
- [x] 生成学科学习手册 + 课程总览
- [x] 同 bvid 第二次扫描返回 `skipped: true`，不重复生成
- [x] 先按标题扫描、再按 URL 扫描，第二次正确按 bvid 去重
- [x] 视频笔记 frontmatter 含 title/subject/source/bvid/url/author/created/updated/tags
- [x] 学习手册含 `<!-- AUTO:START -->` 与「我的补充」区
- [x] mnemon 临时数据目录写入 + `mnemon recall` 可召回
- [x] AI 字幕抓取：通过 yt-dlp + Chrome Cookie 获取 `ai-zh`，该视频字幕 18,954 字
- [x] 登录态评论：抓取 50 条，`view.stat.reply` 显示全站 12,518 条
- [x] 章节：从 `player/v2` 的 `view_points` 提取 6 个章节
- [x] 长字幕分块压缩：18,954 字字幕经过分块摘要后再生成最终总结
- [x] AI 字幕缓存：同一 bvid 第二次抓取命中 `~/.seen/cache/transcripts`，返回 18,954 字

## 抖音精选

- [x] 识别 `https://www.douyin.com/jingxuan?modal_id=...` 与 `/video/<id>` 链接
- [x] 无头 Chrome 读取 SSR `RENDER_DATA`：标题、作者、标签、播放地址、评论/弹幕总数
- [x] ffmpeg 抽取音频，本地 whisper.cpp `ggml-small` 转写（48 分钟视频约 14,099 字）
- [x] 真实抖音长视频生成笔记：`source: douyin`、`videoId`、`contentSource: whisper`
- [x] 抖音视频笔记包含核心知识点、来源统计、Obsidian 链接
- [x] 字幕/转写缓存命中，第二次扫描不重复下载/转写
- [x] 「诊断」包含 douyin-chrome / douyin-ffmpeg / douyin-whisper 检查，全部通过
- [ ] 抖音评论/弹幕正文尚未抓取，仅显示总数（下一步）
- [ ] 抖音标题/音频路径在不同视频上的稳定性待更多样本验证

## YouTube（2026-11-14）

- [x] `extractYoutubeId` 覆盖 watch / youtu.be / shorts / embed / live / 裸 ID
- [x] `detectSource` 识别 YouTube URL 与「 - YouTube」标题，B站 / 抖音判定不变
- [x] yt-dlp `-J` 取元数据：标题、频道、时长、简介、12 个章节、字幕轨道清单
- [x] 人工字幕：`--sub-langs zh` 精确单条下载 SRT，19 分钟视频 6.5 秒拿到 5,417 字
- [x] 自动字幕：实测 HTTP 429（tv / web_embedded / web_safari 三种 client 均失败），按预期降级
- [x] 音频兜底：`-f bestaudio` + tv client 下载成功，ffmpeg 转 16kHz 单声道，whisper 转写 9 分钟视频 6,178 字（44.5 秒）
- [x] 端到端：`POST /api/scan` 32.6 秒生成 `source: youtube` 笔记，学科自动归到「深度学习」，含 12 个带 `&t=秒s` 的章节链接
- [x] 索引表「来源」列显示 YouTube；笔记含「YouTube 不提供弹幕」提示与 YouTube 来源统计
- [x] 「诊断」新增 yt-dlp / YouTube 网络检查（改用 yt-dlp 真实探测，规避 Node fetch 在本机 TLS 中间人代理下的证书链失败）
- [x] `cd core && node --test`：69 tests / 69 pass
- [x] yt-dlp 自动安装：`node scripts/install-yt-dlp.mjs --force` 下载官方二进制到 `~/.seen/bin/yt-dlp`（37.4MB，2026.10.26），`--version` 校验通过
- [x] 已安装的系统版本优先：机器上有 brew 版时 `findYtDlp` 返回 `/opt/homebrew/bin/yt-dlp`，不会被自动下载的副本覆盖
- [x] 自动安装接入后重跑真实抓取：9.7 秒拿到 5,417 字字幕，行为不变
- [x] `cd core && node --test`：74 tests / 74 pass
- [ ] 会员 / 年龄限制 / 直播视频的失败提示待真实样本验证
- [ ] YouTube 评论未接入（需要 OAuth，暂不做）

## 自动安装（2026-11-14）

- [x] yt-dlp：缺失时从 GitHub releases 下载到 `~/.seen/bin/yt-dlp`（37.4MB），`--version` 校验通过
- [x] ffmpeg：缺失时下载 ffmpeg-static 静态二进制到 `~/.seen/bin/ffmpeg`（45.5MB，arm64），`ffmpeg -version` 输出 6.0
- [x] Whisper 模型下载链路：HF_ENDPOINT → huggingface → hf-mirror 三源实测可用（base 模型 141MB 从 huggingface 直连成功）；后来改为面板选项下载，见下条
- [x] 系统里已装的优先：brew 的 `/opt/homebrew/bin/yt-dlp`、`/opt/homebrew/bin/ffmpeg` 仍被选中，自动下载的副本不覆盖
- [x] whisper-cli 官方无预编译包：诊断面板提供「安装」按钮，服务端代为执行 `brew install whisper.cpp`，进度走 SSE；接口实测返回 202，已装时直接跳过
- [x] Web 诊断从 toast 改为可交互面板：逐项显示 ✓/✕ 与详情，缺 whisper-cli 时出现安装按钮
- [x] 缺转写模型时不再静默下载：面板按推荐力度列出 turbo / small / medium / base，每项带体积与说明，点了才下载（`GET /api/whisper-models`、`POST /api/install/whisper-model`）
- [x] 默认推荐模型改为 large-v3-turbo（1.6GB），`findWhisperModel` 按 turbo → medium → small → base 优先级选已装的最准模型
- [x] 实测 turbo：同一段 9 分钟英文视频，small 44.5 秒 / 6,178 字 → turbo 84.6 秒 / 6,926 字（多 12%，含 `*music*` 段落标记）
- [x] 国内下载通道：GitHub 直连失败自动换镜像（`ghproxy.net` / `gh-proxy.com`，可用 `SEEN_GH_MIRROR` 覆盖，实测两个镜像均可取到 release 文件）；模型走 HF_ENDPOINT → huggingface → hf-mirror
- [x] yt-dlp 下载后 SHA256 校验：实测安装文件 hash 为 `0f922c15…`，与官方 `SHA2-256SUMS` 中 `yt-dlp_macos` 一致；镜像来源校验不通即中止
- [x] 直播聊天回放（`live_chat`）不再被当字幕轨道：真实视频 X3aq_g78tWg 只带 live_chat，修复后直接降级音频
- [x] 分阶段通知：开始整理 / 本地转写（含预计耗时）/ 笔记已生成 / 处理失败四个节点，中间步骤不弹
- [x] 转写进度实测：80 秒音频依次上报 45% → 93% → 99%，面板显示百分比；45 分钟视频预估 15 分钟
- [x] `cd core && node --test`：93 tests / 93 pass

## 独立服务与前端

- [x] `node server/index.js` 启动，默认 `http://127.0.0.1:4780`
- [x] `GET /api/status` 返回状态、前台、历史、LLM 健康
- [x] `POST /api/config` 可启动/暂停轮询、修改轮询间隔（测试 20 秒）
- [x] `GET /api/events` SSE 初始 snapshot 与实时事件正常
- [x] `POST /api/scan` 通过独立服务 + 真实 Magpie LLM + 真实 B 站视频生成笔记（约 3 分钟，含 18,954 字 AI 字幕分块总结）
- [x] 前端页面在 Chrome 加载，无 console 错误；启动/暂停按钮可切换
- [x] 前端页面布局、固定高度滚动、历史总结回显正常
- [x] 界面截图：[docs/ui-preview.jpg](ui-preview.jpg)
- [x] 处理阶段显示实时计时（`已处理 00:45` 样式）
- [x] favicon 已补齐，页面无 404 console 错误
- [x] 实例锁：同时启动两个 Seen 时，后启动的为 `readOnly: true`，不会抢占轮询
- [ ] `scripts/install-launchd.mjs` 未实际安装（避免修改系统登录项，待用户确认）


## Obsidian

- [x] `obsidian-cli list --vault "Obsidian Vault" "课程知识地图"` 能看到学科目录与笔记
- [x] 视频笔记 frontmatter 正确
- [x] 学科学习手册链接到视频笔记
- [x] 课程总览列出学科与视频数
- [ ] Mermaid mindmap 正常渲染（需在 Obsidian 中肉眼确认）

## 行为

- [ ] 重复停留同一视频 2 分钟：无新增笔记、无 LLM 调用
- [ ] 同学科第二个视频：学习手册视频数 +1
- [ ] 新学科视频：新学科目录与学习手册生成
- [x] 前台非浏览器：无动作（未触发处理）
- [x] mnemon：`mnemon recall "视频课程"` 能查到记录
- [ ] 无 mnemon CLI 时笔记仍生成（降级）— 代码路径已实现，待实际拔除 CLI 验证

## 2026-11-13 新增功能验收

- [x] 模型设置：供应商分组（国内/国际/本地/自定义），选预设只填 API Key，自动拉取模型列表，测试连接，保存后立即生效
- [x] Magpie 自动探测：本机有 Magpie 时零配置可用，面板显示来源 magpie
- [x] mnemon 开关：检测到 CLI 自动开、缺失时禁用；默认关闭策略下笔记仍生成
- [x] 知识索引：每次生成笔记后重建 索引.md，AUTO 区外内容不被覆盖
- [x] 每周回顾：手动触发/启动补生成，重复触发返回 skipped，空周不生成
- [x] 完成通知：生成笔记后发 macOS 通知，5 秒去重
- [x] 章节与知识点时间戳：B站笔记带 t= 链接，点击跳回视频
- [x] 设置入口：菜单栏「设置」、模型徽章、#settings 直达三条路径都能打开同一弹窗
- [x] 诊断：全部正常只显示「一切正常」，异常时只列失败项

## 2026-11-15 加工、版式与关联改造验收

- [x] 笔记版式：callout 分区（内容来源 / 一句话总结 / 想回答 / 答案）、视频信息表 + 封面、关键数字表、章节、核心知识点标所属章节、核心概念带 `^concept-xxx`、相关笔记双链带理由、我的补充保护区、抓取统计折叠在 `<details>` 里（真实笔记 290 行全项命中）
- [x] 无章节视频自动切章节：B 站 12 分钟视频切 4 段带 `t=` 链接；YouTube 5:52 无原生章节视频切 4 段带 `t=` 链接；抖音 29.5 分钟视频切 5 段（无时间链接，抖音链接不支持 `t=`）
- [x] 短于 4 分钟不切章节：抖音 3:58 视频实测无「章节」块，符合设计
- [x] 本地转写产出时间戳：whisper `-osrt` 生成 srt，`parseSrtTimed` 还原「[mm:ss] 一句」；`say` 合成音频实测 2.6 秒转完、srt 格式正确
- [x] 概念归一与跨笔记双链：conceptKey 去标点归一 + 别名命中，按「共享概念×2 + 共享关键词」打分取前 5
- [x] 概念索引页与面板概念浏览：`GET /api/concepts` 返回 3 个概念（双向链接 4 / 知识管理 3 / 卡片笔记 1），面板点概念列出跨学科笔记
- [x] 学科手册核心概念门槛：只收出现在 ≥2 篇笔记里的概念，单篇概念不再刷屏
- [x] 知识库按学科分组展示；全文搜索 `GET /api/search` 命中文件名权重 3、正文权重 1
- [x] 两种目录布局与迁移脚本：`flat`（默认）/`structured`，`scripts/migrate-vault.mjs` 默认预演、`--apply` 先备份再移动，并重写笔记里的手册双链与 state.json 里的 notePath（路径不同步会让索引、概念索引、相关笔记全指到旧位置）；假库实测 2 个文件迁移、1 处链接、1 条状态路径全部正确
- [x] 服务自检十二项全绿（平台 / 前台 / vault / state / mnemon / yt-dlp / 抖音 Chrome / ffmpeg / whisper-cli / 模型 / B 站 / YouTube）
- [x] 阶段 5 真实 vault 迁移（用户授权后执行）：17 个文件迁移（12 篇笔记进 `视频笔记/<学科>/`，5 个手册进 `手册/<学科>.md`），备份写入 `_备份/迁移-2026-11-15T00-22-48`，重写笔记内链接 12 个、同步 state 里的 notePath 11 条；面板切到 structured 后索引 11 条链接全部指向新路径；原学科空目录已清理，历史 `.bak` 移入 `_备份/历史副本`

## 2026-11-15 目录结构改为定稿方案

上一节记录的是中间态（根仍叫「课程知识地图」、子目录叫「视频笔记」），按定稿方案再改一次：

- [x] 根目录改名 `课程知识地图` → `视频笔记`；子目录 `视频笔记/` → `笔记/`；手册统一进 `手册/<学科>.md`；`每周回顾/` → `回顾/`
- [x] 根下文件改名：`课程总览.md` → `总览.md`，`索引.md` → `视频索引.md`（避免和 `概念索引.md` 混淆）
- [x] 默认布局改为 structured（`noteRoot: '视频笔记'`、`noteLayout: 'structured'`），`normalizeNoteLayout` 只有显式写 `flat` 才走平铺
- [x] `migrate-vault.mjs` 适配旧结构：识别旧根、旧 `视频笔记/` 内容、扁平学科目录、旧手册名、`每周回顾`；链接替换表同时覆盖双链与路径引用
- [x] 真实 vault 迁移：14 个文件、备份在 `视频笔记/_备份/迁移-2026-11-15T01-06-33`、重写 21 处链接、同步 state 里 11 条 notePath；迁移后结构为 `视频笔记/{总览.md, 视频索引.md, 概念索引.md, 笔记/<学科>/, 手册/, 回顾/, _备份/}`
- [x] 测试 148 项全绿，`npm run check` 通过

## 2026-11-15 标签体系重构

- [x] 四层结构：学科（裸标签）→ 主题（裸标签 2~6 字，上限 4）→ `类型/<8 选 0~2>` → `概念/xxx`；不再拼「视频课程」、平台名、与学科重复的值（平台看 frontmatter 的 `source`）
- [x] 主题由 LLM 在总结那次调用里一并给出（零额外 API 调用），本地只做清洗、去泛化、同篇包含合并（长度差 ≤2 留更长者）、按 conceptKey 去重
- [x] 词表约束：`state.tagVocabulary` 记录主题词出现次数，`buildTagVocabulary` 取前 40 注入提示词，措辞为「能准确概括才复用，不相关不要硬套」
- [x] 真实 vault 12 篇全量 dry-run（0 失败）：`视频课程`/`B站`/`抖音精选`/UP 主名/`全网最全` 等脏值全部消失；Obsidian 三篇收敛到同一组主题（知识管理 · 笔记工具 · 个人知识库 · 效率软件 · 类型/教程）；播客类出现 `类型/播客`，观点类出现 `类型/观点`
- [x] 概念名约束：2~8 字、带括号直接丢弃、单篇上限 6（`概念/仓库（Vault）` 这类值不再出现）
- [x] `标签索引.md` 与视频索引、概念索引一起在每次生成笔记后重建，按学科/主题/类型/概念四类分区列出各自挂载的笔记
- [x] 回填脚本 `node scripts/retag-notes.mjs`：默认预演，预演时同样累加词表（保证预演结果即 apply 结果）；`--apply` 先备份到 `_备份/重打标签-<时间>/` 再写回并重建三篇索引
- [x] 测试 168 项全绿，`npm run check` 通过

## 2026-11-15 历史笔记回填与洁癖收尾

- [x] 真实 vault 12 篇全部回填（备份 `视频笔记/_备份/重打标签-2026-11-15T04-13-38`），脏值清空，每篇 3~5 个主题 + 0~2 个类型
- [x] 发现并补上概念缺口：早期 10 篇的 state 里没有 `concepts` 字段，回填会把 `概念/xxx` 标签一起丢掉；脚本改为「旧标签的 `概念/` 兜底 → 让模型从正文抽 3~6 个概念」（`normalizeConcepts` 过滤泛化词和带括号的值），并把结果写回 `video.concepts`
- [x] 回填结果：12 篇全部有概念，概念索引从 6 个增至 66 个，标签索引 98 个标签且学科/主题/类型/概念四类分区齐全
- [x] 顺手修掉过期表述：`rememberVideo` 改用笔记的四层标签写入记忆库（不再拼「视频课程」）、记忆库内容标题前缀改为【视频笔记】、contracts 的抖音依赖改 `ggml-<model>.bin`、core/README 模块表补 tags/concept/paths/vault-search、空状态文案与 paths/review 注释去掉「课程」「每周回顾」的旧说法
- [x] 测试 168 项全绿，`npm run check` 通过

## 2026-11-15 笔记库权限健壮性（0.3.2）

背景：0.3.1 换包装后菜单栏 app 拉起的服务在 4780 端口 listen 但不 accept，sample 显示主线程 1553/1553 个采样卡在 libsystem_kernel __open（uv_run → uv_fs_open），根因是 vault 在「文稿」文件夹、TCC 未授权时同步 open 永久挂起，把整个事件循环堵死。

- [x] 权限探测放在子进程：probeVaultAccess 用 process.execPath 跑探针脚本做 readdirSync，主进程只读结果，返回 ok / missing / denied / timeout；子进程 8 秒不返回才 SIGKILL（首次访问时 tccd 要现拉授权状态，2.5 秒会误报 timeout；启动探到 timeout 时 4 秒后自动复查一次）
- [x] 熔断守卫：未授权时所有 vault 读写立即抛 VaultBlockedError，保存流程 emit vault-blocked 并返回「笔记没有写入」，不再挂死、也不记入 state.failures
- [x] 全部 vault IO 异步化：obsidian.js 改 node:fs/promises，每个写操作过 runVaultTask（守卫 → 串行队列 → 10 秒超时熔断）；vault-search.js 同步改 async
- [x] 面板提示条 + 一键恢复：顶部红条说明原因和授权路径，点「重新检测」走 POST /api/vault/probe，授权后无需重启；SSE 的 vault / vault-blocked 事件同步更新
- [x] 缺权限时不阻塞其他功能：/api/search 返回 { results: [], blocked: true, hint }，索引与周回顾跳过，/api/status 与 /api/check 照常返回（实测 missing vault 下 status 立即 200、check 11.5 秒完成）
- [x] 队列内不得再调 runVaultTask（会死锁），内部实现全部用裸 fs 版本；测试覆盖守卫状态机、超时熔断、串行队列
- [x] 真实链路 E2E（临时 vault）：B 站 129 秒生成笔记，总览/视频索引/概念索引/标签索引四篇索引与学科手册全部写成功，标签三层结构正常
- [x] 测试 174 项全绿，npm run check 通过


## 2026-11-15 离线自检（note-check + 缓存回放）

背景：模型偶发不稳定（分段回解释文字、正文空串）此前只能靠人工看笔记发现。现在把「笔记该长什么样」变成可执行断言，并用本机缓存离线回放模型用例。

- [x] 新增 `core/lib/note-check.js`：纯函数、不碰文件系统，解析 markdown 后检查版式区块与顺序、三层标签（学科首个、无脏值、主题 2–6 字上限 4、类型枚举、概念 2–8 字上限 6 且与「核心概念」同名并带 `^concept-` 块引用）、章节时间轴（递增、不超时长、B 站/YouTube 带 `t=`、抖音不带）、双链目标、总结与切段结构
- [x] frontmatter 新增 `format: 2` 标记版式版本：旧笔记结构缺失与概念漂移降级为警告，当前格式才算错误（否则历史笔记永远红）
- [x] 新增 `scripts/self-check.mjs`（`npm run self-check`）：只读体检笔记库 + 四篇索引 + 手册 AUTO 区块 + state 的 notePath/标签/学科一致性；真实 vault 实测 12 篇（当前格式 0 / 旧格式 12）、210 条索引双链、6 篇手册、12 条状态，错误 0、警告 22（20 条旧格式缺区块 + 1 条旧笔记概念数超限 + 1 条旧笔记概念与标签不同步）
- [x] `npm run self-check:llm`：用 `~/.seen/cache/` 的分段与总结缓存离线回放，不联网、不写笔记；每个用例跑 3 次，通过率低于 2/3 或出现空结果判失败
- [x] 回放实测（magpie / auto/deepseek-v4.1-flash）：YouTube 分段 3/3（段数 4,5,4，平均 17.7s）、抖音分段 3/3（4,5,5，平均 51.9s）、YouTube 总结 3/3（知识点 9,12,11，平均 122.0s）、抖音总结 3/3（7,5,6，平均 29.4s），合计 12 次 0 失败
- [x] 断言按提示词校正过：keyPoints 上限从 8 改为 20（提示词允许 3~20），question/answer 允许同时为空（纯知识罗列的视频），只查「只填一边」
- [x] 测试 190 项全绿（新增 note-check 15 项、format 1 项），`npm run check` 通过

## 2026-11-16 批次 1：去封面、去思维导图与 format 3

背景：封面图和思维导图占了版式却几乎不产出信息——封面就是视频缩略图，思维导图是把概念再画一遍。视频本身的内容才值得占位置。同时关键数字里混入了「视频总时长 12:19」「弹幕 150 条」这类视频自身参数。

- [x] 视频笔记不再抓封面：删除 bilibili / youtube / douyin 内容对象的 cover 字段（含 B 站 `pic`），渲染层不再写 frontmatter `cover:` 与正文 `![封面]`；手册与总览的 mindmap 保留，视频笔记的 mermaid 思维导图整块删除
- [x] 核心知识点不再标「所属章节」：标题只留 `### 标题 [mm:ss](t=链接)`，章节信息已经在「## 章节」里
- [x] 关键数字精准化：normalizeNumbers 加 META_NUMBER_PATTERN 过滤视频自身参数（时长/体积/分辨率/播放点赞投币收藏/弹幕评论条数/界面分区数），提示词规则同步改为「3~6 个能支撑结论或可直接行动的量化信息，没有合适的给空数组」
- [x] 仅元数据（没有字幕）的视频降级：`contentQuality: "metadata-only"` 时 concepts 与 numbers 一律按空数组处理，笔记不出现「## 关键数字」「## 核心概念」，相关笔记与标签也不再引用编造的概念
- [x] `format: 3`：note-check 的 SECTION_ORDER / REQUIRED_ALWAYS 去掉思维导图，并新增三条回归反查——`legacy-cover`（frontmatter cover 或正文封面图）、`legacy-mindmap`（出现「## 思维导图」）、`legacy-chapter-tag`（出现「所属章节：」），只在当前格式判错，旧笔记不误报
- [x] 旧笔记清理：新增 `core/lib/note-clean.js` 的 stripCover 与 `scripts/strip-cover.mjs`（默认预演，`--apply` 才写并先备份）；真实 vault 预演 23 个 markdown、命中 2 篇，`--apply` 后清理 2 篇（备份 `视频笔记/_备份/去封面-2026-11-15T16-08-05`），全库复查已无 `cover:` 与封面图
- [x] 临时实例 E2E（B 站 BV1qqEj6oEEk，130 秒）：笔记 `format: 3`、无封面/思维导图/所属章节，区块为 视频信息 → 关键数字 → 章节 → 核心知识点 → 核心概念 → 讨论焦点 → 我的补充 → 来源统计；关键数字只剩「1 天左右」「6 级」这类真正有用的量化信息；知识点标题形如 `### 为什么适合 AI 时代 [01:05](…?t=65)`
- [x] 同一实例验元数据版（B 站 BV11RWR64EYy 无字幕）：`contentQuality: "metadata-only"`，笔记里没有「## 关键数字」「## 核心概念」，标签只剩学科 + 3 个主题 + `类型/观点`，没有概念标签
- [x] 测试 195 项全绿（新增 note-clean 3 项、format 3 回归 1 项、元数据降级 1 项），`npm run check` 通过

## 2026-11-16 批次 2：类型模板、要点时间戳、原话/术语/资源与 format 4

背景：不同内容的视频不该套同一张版式。教程需要操作步骤，观点需要论证结构，科普需要机制与证据；同时知识点只有标题带时间不够，具体要点也应能跳回原片。

- [x] 新增 core/lib/note-content.js：8 类 contentType（教程/观点/科普/评测/访谈/播客/纪录/课程/其他），按类型给出模板区块与条数上限；normalizeQuotes 与 normalizeKeyPointPoints 只接受数组，normalizeTerms 按 Unicode 字符数判 2~12 字，超长直接丢弃
- [x] 总结结构升级：SummaryResult 增加 contentType/template/quotes/terms/resources；核心知识点要点从字符串升级为 {text,time}；提示词规则覆盖新字段；contentType 与模板只在有字幕时使用
- [x] 渲染升级：格式 4 按类型渲染 前置条件/操作步骤/课程脉络/练习/论证结构/可质疑之处/机制与证据/常见误解/对比/人物观点/事件时间线；要点与步骤带 t= 时间链接；新增 原话摘录（≤3 条、≤80 字）、术语表（≤8 个）、提到的资源（≤6 个）；frontmatter 增加 contentType 与 quality 1~5
- [x] 编辑润色：config.editorPass（默认关闭，面板「发布前润色」）在总结后多调一次模型，只改表达不新增事实；失败时保留原总结
- [x] 重刷历史：engine.refreshHistory 按 createdAt 倒序用缓存重跑 state 里的视频，跳过去重与失败冷却；POST /api/reprocess 后台执行并广播 refresh-done；工作台「重刷历史」按钮
- [x] note-check 升级为 format 4：SECTION_ORDER 增加模板区块/原话摘录/术语表/提到的资源，parse 返回 contentType/quality，checkSummaryShape 校验 points {text,time}、quotes/terms/resources 上限与术语长度
- [x] 临时实例 E2E（B 站 BV1qqEj6oEEk，约 110 秒）：笔记 `format: 4`、`contentType: "tutorial"`、`quality: 5`，前置条件/操作步骤（8 步均带 t=）/核心知识点（要点带 t=）/原话摘录/术语表/提到的资源全部出现；self-check 该库 1 篇当前格式、错误 0、警告 0
- [x] 测试 208 项全绿（新增 note-content 测试），`npm run check` 通过
