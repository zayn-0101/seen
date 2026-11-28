# 验收清单

> 实施记录（2026-11-12 起按时间追加）。以下为历史验收记录，当前状态以文末最新版本为准；早期测试数字不再更新。

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

- [x] 识别 `https://www.douyin.com/jingxuan?modal_id=...` 链接（2026-11-17 起普通 `/video/<id>` 不再处理）
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
- [x] YouTube 评论一期按成本取舍不做：公开评论可用 Data API key 或 yt-dlp --write-comments，但会带限流、超时与输出膨胀，不是技术必须；抖音评论正文同理一期不做（B 站评论保持现状）

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

- [x] 新增 `core/lib/note-check.js`：纯函数、不碰文件系统，解析 markdown 后检查版式区块与顺序、四层标签（学科首个、无脏值、主题 2–6 字上限 4、类型枚举、概念 2–8 字上限 6 且与「核心概念」同名并带 `^concept-` 块引用）、章节时间轴（递增、不超时长、B 站/YouTube 带 `t=`、抖音不带）、双链目标、总结与切段结构
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

## 2026-11-16 批次 3：字幕存档、重整理与搜索来源

背景：重做笔记时不该重新下载/转写；字幕缓存 7 天也太短。字幕原文本身值得留一份，但不应混进索引。

- [x] 字幕存档：有字幕或转写的视频生成笔记时，同时写 `<noteRoot>/资料/字幕/<笔记名>.md`（frontmatter `type: transcript`、`format: 1`、`notePath`；正文「## 带时间戳字幕」「## 纯文本」），不参与视频/概念/标签索引
- [x] 重整理：面板「用存档字幕重新整理」→ `POST /api/resummarize` → `engine.resummarizeNote({ notePath })` 读存档后按 `refresh: true` 重跑；无存档时提示先重刷一次。存档模式只读本地字幕，不重新抓取平台内容、不下载音频、不转写。
- [x] 缓存 30 天：`transcriptCacheDays` 默认从 7 改 30
- [x] 搜索标注来源：`searchVault` 返回 `kind`（视频笔记/字幕/学科手册/概念页/主题综述/周回顾/索引）与 `match`（title/content），面板列出「[kind · 命中文件名/命中正文] 路径」
- [x] 临时实例 E2E（B 站 BV1qqEj6oEEk）：字幕存档生成、frontmatter 与两段正文齐全；历史接口返回 transcriptPath

## 2026-11-16 批次 4：概念页、主题综述、手册与总览升级

背景：概念索引只有一行链接，手册和总览也缺少「怎么学、还缺什么」的视角；重建逻辑散在服务里。

- [x] 概念页：同一概念出现 ≥2 篇时建 `概念/<概念名>.md`（概念释义 / 出现笔记 / 相关概念），只维护 AUTO 区
- [x] 主题综述：同一主题标签出现 ≥3 篇时建 `主题/<主题名>.md`（主题概览 / 视频笔记 / 相关概念）；相关概念只链接真实存在的概念页，避免断链
- [x] 学科手册升级：新增学习路径（按时间顺序）、术语表（跨视频汇总，≤30）、常见对比（≤12）、待解问题（≤12）
- [x] 总览升级：新增最近更新（5 篇）与知识库概况（视频数/学科数/概念数/本周新增）
- [x] 全量重建：新增 core/lib/rebuild.js 的 rebuildKnowledgePages（索引 → 概念页 → 主题页 → 手册 → 总览）与 scripts/maintain-vault.mjs（`--dry-run` 只统计）；engine 暴露 rebuildKnowledgePages，服务每次保存后调用
- [x] 质量可见：`GET /api/quality` 汇总 {total, scored, low}，知识库对 quality ≤2 的笔记出提示，历史卡片显示「质量 N/5」
- [x] 临时实例 E2E（复制真实 vault）：重扫 B 站视频生成 format 4 笔记 + 字幕存档；全量重建生成 6 份手册、3 个主题页、总览与三篇索引；概念页 0（真实历史概念都只出现 1 次，符合 ≥2 门槛）；`GET /api/quality` 返回 {total:12, scored:1, low:[]}
- [x] 测试 219 项全绿（新增 topic-pages 5 项、rebuild 2 项），`npm run check` 通过

## 2026-11-16 批次 5：复习卡片与间隔重复

背景：笔记生成后缺少「什么时候该回看」的机制。把知识点变成可复习的问答，并按间隔重复安排到期日。

- [x] 新增 core/lib/review-schedule.js：REVIEW_RATINGS（again/hard/easy）、LADDER 1/3/7/16/35；initialReview 当天到期；nextReview 实现 again 明天重来并清零、hard 间隔 ×1.5、easy 逐级拉长；collectReviews 返回到期队列与 {total,reviewed,due,averageQuality,subjects} 统计
- [x] 视频笔记新增「## 复习卡片」：一句话问答 + 每个核心知识点的标题与首条要点，格式为 `问题::答案`（兼容 Obsidian Spaced Repetition），最多 5 条；frontmatter 增加 `review` 进度
- [x] 面板「今日复习」卡片：列到期笔记（学科/质量/到期日），三键「忘了 / 模糊 / 记住了」→ `POST /api/reviews`；`GET /api/reviews` 返回队列与统计
- [x] 复习进度双写：state 的 video.review + 笔记 frontmatter 的 review（updateNoteReview 只改这一行，找不到文件返回错误）；重刷笔记时按 bvid/videoId/title 找回旧进度，不重置
- [x] 周回顾升级：新增「## 复习情况」（已复习/待复习、本周优先）与「## 学习统计」（平均质量分、内容类型分布）；只列本周新增笔记的到期项，避免把上周内容带进来
- [x] note-check 的 SECTION_ORDER 在「相关笔记」后加「复习卡片」，旧笔记没有该区块不报错
- [x] 临时实例 E2E（复制真实 vault/state，SEEN_PORT=4817）：GET /api/reviews 返回 12 篇到期（旧笔记无 review 字段，均视为今天到期）；POST /api/reviews 对 GTA6 笔记评 easy 后返回 due 2026-11-17、interval 1、ease 2.6、reps 1，剩余到期 11 篇；该笔记 frontmatter 已写入 review 行
- [x] 测试 227 项全绿（新增 review-schedule 6 项、format 复习卡片 1 项、周回顾 1 项），`npm run check` 通过


## 2026-11-16 批次 6：问笔记库与标签合并

背景：笔记库已经能搜到东西，但用户还需要自己读；标签虽由 LLM 收敛，历史里仍会留下同义写法（如「个人知识管理」和「个人知识库」）。这一批把「检索」升级为「问答」，并给标签一个可操作的合并入口。

- [x] 新增 core/lib/ask.js：buildAskPrompt（只根据笔记回答、每个结论带 `[[路径|标题]]` 引用）、extractCitations（按路径/标题映射回笔记并按出现顺序去重）、answerQuestion（callLlm 生成回答）
- [x] engine.askLibrary：searchVault 取前 8 条，只读视频笔记/概念页/主题综述，最多读 5 篇正文；无命中时返回说明而不是报错；面板「问笔记库」走 POST /api/ask
- [x] tags.js 新增 mergeTagInVideos；obsidian.js 新增 readVaultText / updateNoteTags；engine.renameTag 逐篇改 frontmatter、同步 state 的 video.tags 与 tagVocabulary，最后重建索引；类型/概念/学科标签拒绝合并；面板「标签」浏览 + 合并
- [x] 服务新增 GET /api/tags（buildTagIndex → name/type/count）、POST /api/tags/merge、POST /api/ask
- [x] 临时实例 E2E（复制真实 vault/state，SEEN_PORT=4818）：GET /api/tags 返回 98 个标签；POST /api/ask「Obsidian 的双链和反链有什么区别？」返回 200，答案带 2 条引用并映射回笔记路径；POST /api/tags/merge 把「效率工具」合并到「笔记工具」，changed=4，4 篇笔记 frontmatter 与标签索引同步更新
- [x] 浏览器实测（Playwright）：知识库「标签」展开 23 个主题标签并可选择合并目标；「问笔记库」回答按 Markdown 渲染成标题/列表/加粗，`[[路径|标题]]` 双链变成可点击的 Obsidian 链接，页面无脚本报错
- [x] 测试 233 项全绿（新增 ask 5 项、mergeTagInVideos 1 项），`npm run check` 通过

## 2026-11-16 真实笔记库全量重刷与 0.4.0

背景：批次 1–6 完成后，按用户要求把 12 篇历史笔记一次性重刷到 format 4，并清理旧版留下的重复文件。

- [x] 重刷前备份：`视频笔记/_备份/重刷-2026-11-16T06-31-06-981Z`（含笔记、手册、索引、总览与回顾）
- [x] `POST /api/reprocess` 重刷 12 篇：14:31:39 开始，14:48:29「重刷历史完成：12/12，失败 0」；全部笔记为 `format: 4`
- [x] 重刷后自检：笔记 12 篇（当前格式 12 / 旧格式 0）错误 0 警告 1（YouTube 长视频缓存里没有带时间轴的字幕，缺少章节；重新抓取时 yt-dlp 网络失败，保留原缓存）；索引 201 条双链 / 手册 6 篇 / 状态 12 条 / 路径缺失 0
- [x] 清理旧文件：把旧版同名笔记 `英语播客：我为什么不回美国.md` 与 11 个 `.md.bak-*` 写入操作备份移到 `_备份/重刷-2026-11-16T06-31-06-981Z/旧文件/`，没有删除用户数据
- [x] 字幕存档 11 篇（GTA6 为 metadata-only，无字幕）；`GET /api/quality` 12 篇全部有评分，`GET /api/reviews` 12 篇到期，`GET /api/tags` 93 个标签
- [x] `package.json` 升到 0.4.0，`./scripts/make-release.sh` 产出 `dist/Seen-v0.4.0.dmg`（85M，universal）；安装到 `~/Applications/Seen.app` 后 `/api/status` 返回 200、vault ok、12 篇历史
- [x] 测试 233 项全绿，`npm run check` 通过；修复 `processTitle` 失败分支变量作用域，避免真实错误被 `rawTitle is not defined` 覆盖

## 2026-11-16 平台内容提取改进（B站音频兜底、多P、YouTube 原声、抖音重试）

- [x] B 站无字幕音频兜底：`fetchTranscript` 在字幕为空且未关闭转写时，用 yt-dlp `-f bestaudio` 下载音频、ffmpeg 转 16kHz 单声道、Whisper 转写；失败只返回空并记录 detail，不阻断仅元数据笔记。真实视频 `BV11RWR64EYy`（915 秒、无字幕）直测 230 秒拿到 4,608 字 / 8,024 字带时间轴文本，source=whisper
- [x] B 站多 P 隔离：`fetchContent` 返回 page/part，P2 起标题自动拼「- Pn 分P名」；`seenKey` 用 `bvid:<BV>:p<n>` 去重（前台检测也按 URL 的 p 参数算键），字幕缓存按 `<bvid>__<cid>.json`，state 记录 page/cid。多 P 样本「新概念英语 第一册」的 P2（369 秒）直测 99 秒完成转写；临时库扫描 P2/P3 各生成独立笔记
- [x] 多 P 状态覆盖 bug：`processTitle` 的 `existed` 匹配只比 bvid，P3 会覆盖 P2 的 history 记录；已加 page 比较（`(Number(v.page) || 1) === videoPage`），重扫 P2 后 state 恢复 P2+P3 两条
- [x] YouTube 字幕语言：`parseYoutubeJson` 保留 `language`，`pickYoutubeSubtitle` 先原声语言（自动字幕先找 `<lang>-orig`），人工字幕仍优先自动；单元测试覆盖 ja 原声优先于 en/zh 机翻
- [x] YouTube / 抖音缓存升到 version 2、默认 30 天；YouTube 旧缓存缺 `timedTranscript` 会重建，元数据/字幕刷新失败时可沿用旧转写
- [x] 抖音页面解析加 UA、中文 locale、反自动化参数；首次失败等 800ms 重试一次（第二次 virtual-time-budget 35 秒），验证页 / 作品不存在 / 无可解析数据分别给 captcha / missing / empty 提示；历史抖音链接 E2E 成功生成 format 4 笔记（contentSource whisper、quality 4）
- [x] 临时库 E2E（SEEN_PORT=4821、/tmp/seen-p0-vault、/tmp/seen-p0-state）：B站 GTA6、B站多P P2/P3、抖音各一篇笔记均生成，frontmatter 均为 `format: 4`；自检 4 篇（当前 4 / 旧 0）错误 0 警告 0，索引 73 条双链 / 手册 2 篇 / 状态 4 条 / 路径缺失 0
- [x] 新增 9 项单元测试（transcriptCacheName、buildBilibiliAudioArgs、seenKey 多P、YouTube language/原声优先、Douyin classify/buildChromeArgs、缓存 30 天、buildBiliDisplayTitle），`cd core && node --test` 242 项全绿，`npm run check` 通过
- [x] 一期不抓 YouTube / 抖音评论正文（按成本取舍，非技术必须）；B 站评论保持现状；未改动真实笔记库


## 2026-11-16 服务启动健壮性：Magpie 未就绪不再导致服务退出

背景：重启电脑后菜单栏应用先于 Magpie 网关启动，`resolveLlmConfig` 返回空 model，`resolveConfig` 校验 `model` 必须为 null 或非空字符串时抛错，服务进程直接退出，页面打不开。

- [x] server/index.js 新增 `resolveStartupLlm`：启动时探测不到模型会重试 4 次（每次间隔 1.5 秒），给 Magpie 留出启动时间
- [x] 重试后仍没有模型时，`provider`/`model` 以 null 传给 `resolveConfig`，服务先启动；控制台打印「未检测到可用模型，服务先启动；请在面板「模型」里配置后再使用整理功能」，面板可正常打开并配置模型
- [x] 验证：用 `SEEN_LLM_BASE_URL=http://127.0.0.1:9/v1` 起临时服务（不可达的模型地址），服务正常监听、`GET /api/status` 返回 200、provider/model 均为 null；正常环境启动仍探测到 magpie / auto/deepseek-v4.1-flash
- [x] `cd core && node --test` 242 项全绿，`npm run check` 通过
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.1.dmg`（85M，universal）；bundle 内 `server/index.js` 含 `resolveStartupLlm`。安装待用户确认（重装会重置「文稿文件夹」授权）

## 2026-11-16 45 分钟 YouTube 笔记补章节

背景：0.5.0 重刷时《黄仁勋困在网中央｜中美AI的鬼故事讲不下去了》因 yt-dlp 临时断连沿用旧缓存（无 timedTranscript），是唯一一条自检警告。

- [x] 网络恢复后 `POST /api/scan { url, force: true }` 重抓：YouTube 无字幕 → 下载音频 + Whisper 转写，21:04–21:15 完成（约 11 分钟），生成 `format: 4`、`contentSource: "whisper"`、`contentType: "opinion"`、`quality: 5`
- [x] 笔记补上 `## 章节` 5 段（00:00 / 03:09 / 14:34 / 25:56 / 38:10，均带 `t=` 链接）
- [x] 真实库自检：12 篇（当前格式 12 / 旧格式 0）错误 0 警告 0；索引 217 条双链 / 手册 6 篇 / 状态 12 条 / 路径缺失 0

## 2026-11-16 固定代码签名（TCC 授权跨版本保留）

背景：每次重打包 ad-hoc 签名的 cdhash 都会变，macOS TCC 把新包当成新应用，导致「文稿文件夹」权限反复失效。

- [x] 在登录钥匙串创建自签名证书 `Seen Local Signing`（证书类型「代码签名」，2026-11-16 至 2027-11-16）
- [x] `menubar/build.sh` 优先用 `Seen Local Signing` 签名（可用 `SEEN_SIGN_IDENTITY` 覆盖），证书缺失或签名失败时回退 ad-hoc 并打印警告
- [x] 签名验证：`codesign -d -r- menubar/dist/Seen.app` → `designated => identifier "com.zayn0101.seen" and certificate leaf = H"61dd4d0d29a732f49419f2f79df3f0e67713fd7a"`；`codesign --verify --deep --strict` 通过
- [x] 构建验证：`cd menubar && ./build.sh` 输出「已用固定证书签名：Seen Local Signing」
- [x] `package.json` 升到 0.5.2；README/CLAUDE 说明固定签名、首次授权与证书缺失回退
- [x] 安装验证：`dist/Seen-v0.5.2.dmg`（86M）内 app 版本 0.5.2、Authority=Seen Local Signing、DR 为 `identifier "com.zayn0101.seen" and certificate leaf = H"61dd4d0d29a732f49419f2f79df3f0e67713fd7a"`；`codesign --verify --deep --strict` 通过
- [x] 安装到 `~/Applications/Seen.app` 并重启：`GET /api/status` 返回 200，`vault.ok=true`（「文稿文件夹」权限保留），历史笔记 12 篇正常载入

## 2026-11-17 抖音只识别精选

背景：普通抖音视频此前也会进入候选，可能先解析/转写后才判定非课程；产品口径改为只处理抖音精选。

- [x] `isDouyinJingxuanUrl` 只接受 douyin.com / iesdouyin.com 及其子域的 `/jingxuan[/...]`；`/video/<id>`（即使带 `modal_id`）、用户页、搜索页、首页均为 false
- [x] `observeOnce` 对普通抖音视频记录 skip 日志并跳过，不进入 pending；`processTitle` 对非精选链接返回 `code: douyin-not-jingxuan`
- [x] `detectSource` 仍识别抖音平台（用于历史重刷与手动入口），无法识别来源时不再默认当 B 站
- [x] `POST /api/scan` 对 `douyin-not-jingxuan` / `unsupported-source` 返回 400 并带 error；前端普通抖音前台显示「抖音普通视频（不处理）」
- [x] `cd core && node --test`：243 tests / 243 pass（含 URL 真值表）

## 2026-11-17 笔记 + 资料新编排（0.5.3）

背景：用户反馈 vault 顶层目录太多、找不到笔记入口。确定「笔记只放视频笔记，手册/概念/主题/字幕/回顾统一收进资料」；所有写入备份移出 vault 到 `~/.seen/backups`。

- [x] `core/lib/paths.js` 增加 `AUX_DIR='资料'`、`auxRelPath`、`weeklyReviewRelPath`；structured 布局改为 `笔记/<学科>/` + `资料/{手册,概念,主题,字幕,回顾}/`，flat 布局的学科目录与手册保持不变，辅助资料仍在 `资料/`
- [x] `core/lib/obsidian.js` 的 `writeVideoNote` 接受 `backupDir`，重写备份写到 `~/.seen/backups`；`writeWeeklyReview` 走 `weeklyReviewRelPath`
- [x] `core/lib/legacy-refs.js` 把旧 `视频笔记/{手册,回顾,字幕,概念,主题}/…` 与裸 `[[手册/…]]` 引用统一改写到 `视频笔记/资料/…`；`vault-search.js` 识别 `资料/{字幕,手册,概念,主题,回顾}`
- [x] `scripts/migrate-vault.mjs` 支持旧根改名、旧 `视频笔记/<学科>/`、扁平学科目录、根级辅助目录和旧 `每周回顾/`；旧 `_备份/` 整体移到 `~/.seen/backups/旧备份-<时间>/`，旧 `.md.bak-*` 移到 `~/.seen/backups/旧笔记文件-<时间>/`
- [x] 真实 vault 迁移（2026-11-17 18:46–18:47）：25 个辅助文件迁移；27 个旧 `.bak` 与 9 个旧备份快照移出 vault；重写笔记内链接 16 个；迁移后为 `视频笔记/{总览.md,视频索引.md,概念索引.md,标签索引.md,笔记/<6 学科>/,资料/{手册 6,回顾 1,字幕 13,概念 1,主题 4}}`，根下无 `_备份`、无 `.bak`
- [x] 迁移脚本首次执行在 `_备份/历史副本` 的某个 `.bak` 上报 `ENOENT`（该目录已被整体移走）；修复为 `.bak` 扫描跳过 `_备份/` 后重跑成功。再次 dry-run 输出「已经是当前结构，无需迁移」
- [x] `npm run self-check`：笔记 13 篇（当前格式 13 / 旧格式 0）错误 0 警告 0；索引 235 条双链 / 手册 6 篇；状态 13 条 / 路径缺失 0。自检脚本的学科手册识别同步改为 `资料/手册/<学科>.md`（flat 布局按学科路径）
- [x] `node scripts/maintain-vault.mjs`：视频 13 篇、学科 6 个、概念页 1 个、主题页 2 个
- [x] `cd core && node --test`：244 tests / 244 pass；`npm run check` 通过
- [x] `package.json` 升到 0.5.3；`cd menubar && ./build.sh --bundle --arch=universal` 产出 universal app（232M），固定证书 `Seen Local Signing` 签名验证通过；安装到 `~/Applications/Seen.app`（旧 0.5.2 保留备份），启动后 `GET /api/status` 返回 200、vault ok、历史 13 篇，搜索返回新 `笔记/…` 与 `资料/…` 路径

## 2026-11-17 审计修复（codex/project-audit-20261117 → main）

背景：基于 `main` 的 `916b977` 做只读审计，修复有把握的问题，其余列入 `docs/audit-2026-11-17.md` 待审查。

- [x] 实例锁原子化：`core/lib/index.js` 先把 owner 写入唯一临时目录，再用 `renameSync` 原子替换/创建 `instance.lock` 目录；清理陈旧锁前核对目录 inode/dev，只删除自己的 owner 文件再 `rmdir`，非空目录不删，避免误删其他进程刚创建的新锁；同 PID 重复启动按占用处理。拿不到锁进入只读，`getStatus()`/`getConfig()` 带 `readOnlyReason`，状态消息说明原因；新增并发创建、空锁、陈旧 PID、同进程重复获取、inode 竞态与 8 进程跨进程抢锁测试
- [x] 存档重整理离线化：`resummarizeNote` 读 `资料/字幕` 存档后传 `archiveOnly:true` + `prefetchedContent`，不重新抓平台、不下载音频、不转写
- [x] 状态辅助路径归一化：`paths.js` 的 `normalizeAuxRelPath` / `normalizeStateAuxPaths` 在启动时修正旧字幕路径；`scripts/migrate-vault.mjs --state-only` 可单独修状态；`self-check.mjs` 报告字幕路径缺失/遗留
- [x] 保存失败可见：`save()` 返回布尔值，状态保存失败时笔记仍返回但带 `warnings` / `stateSaved:false`；手册、总览、字幕存档失败也收集警告
- [x] 无身份笔记覆盖防护：`writeVideoNote` 的 `trustedLegacy` 只在目标视频身份明确时信任同路径旧笔记；`previousNotePath` 只来自身份匹配的历史记录，避免重刷另一条无身份视频覆盖同名手写笔记；新增回归测试
- [x] 供应链校验：ffmpeg-static 固定 `b6.1.1` 并内置各平台 SHA256；yt-dlp `SHA2-256SUMS` 只从官方取得，任何来源取不到校验值或校验不符都中止；yt-dlp 下载 asset 按平台和 CPU 架构选择（linux arm64 / win32 arm64 / ia32），官方没有可直接安装二进制的平台明确报错；`menubar/build.sh` 用 `SHASUMS256.txt` 校验 Node 运行时
- [x] 搜索可见性：`searchVaultDetailed` 返回 `{results,scanned,skipped,truncated}`；中文用 `Intl.Segmenter('zh')` 分词；`/api/search` 和面板显示截断/跳过提示
- [x] 学科上限：达到 12 个学科且无相似学科归入「未分类」；`resolveSubjectName` 支持 `maxSubjects`
- [x] 本机 API 防护：所有 API 请求始终校验 Host / Origin / Sec-Fetch-Site，POST 还要求 JSON Content-Type；服务只允许绑定本机回环地址，非回环 `SEEN_HOST` 直接拒绝启动；删除 `GET /api/llm/models`，只保留 POST
- [x] `cd core && node --test`：283 tests / 283 pass / 0 fail；`npm run check` 通过
- [x] 未迁移或改写真实笔记与历史字幕，未执行安装或发布

## 2026-11-18 四项待审查事项修复

背景：对 `docs/audit-2026-11-17.md` 的四项待审查事项做只读复核，确认问题后按 v3.4 计划分阶段修复；每个阶段由三个只读子代理对抗审查，意见统一后再进入下一阶段。

- [x] 阶段 1a 路径隔离：新增 `core/lib/vault-path.js`，对最深已存在祖先做 realpath、对最终项做 lstat；写操作拒绝符号链接，读允许 vault 内部链接；`obsidian.js`、`vault-search.js` 的 vault I/O 全部接入；`readTranscriptNote` 支持按 owner 读取 `(字幕-hash)` 副本；`readFrontmatterBvid` 改安全签名
- [x] 阶段 1b 队列超时：`withVaultTimeout` 移到队列外层，队列 tail 等底层任务真正 settle；新增 `drainVaultQueue`，`reprobeVault` 先排空，超时保持只读并返回 `vault-queue-stuck`
- [x] 阶段 2 批量写入：`defaultState` 增加 `pendingVideos` / `pendingReviews`；`processTitle` 写笔记前先落盘 pending，失败即中止；启动按 bvid/page、videoId/source 或 notePath 跨学科恢复，同一身份只保留一条并合并旧记录，歧义保留 pending；`ready` 与 `reprobeVault()` 共用恢复任务，首次权限不足后重新探测成功会补跑；`recordReview` pending 先行并在末次保存失败时恢复；`renameTag` 返回 `partial / changed / remaining / retryable`，`/api/tags/merge` 与 `/api/reviews` 对 partial 返回 200，面板显示警告
- [x] 阶段 3 字幕审计：新增只读 `core/lib/transcript-audit.js` 与 `scripts/audit-transcripts.mjs`（JSON v1），扫描新旧字幕目录，旧路径和无主存档只告警，owner 不匹配/重复/不可读为错误；`self-check` 分级接入；`resummarizeNote` 在新路径缺失时回退旧目录并按 owner 校验
- [x] 阶段 4 构建与安装：`scripts/prune-build-backups.mjs` 默认 dry-run，`--apply --keep N` 才删，拒绝符号链接、目录外路径和非法 keep；`npm run prune:build` 提供入口；`menubar/build.sh` 支持 `SEEN_BUILD_DIR` / `SEEN_DIST_DIR`；`menubar/install-app.sh` 同目录 staging、旧版本备份、普通失败或 INT/TERM/HUP 回滚（SIGKILL/断电不保证）、跨磁盘拒绝；`--install` 改走该脚本；安装备份用 `scripts/prune-install-backups.mjs`（`npm run prune:install`，默认 dry-run，`--apply --keep N` 才删，只处理 `Seen.app.*`，拒绝符号链接和目录外路径）
- [x] `cd core && node --test`：326 tests / 326 pass / 0 fail；`npm run check` 106 个文件通过；`bash -n menubar/build.sh menubar/install-app.sh scripts/make-release.sh` 通过；临时目录实跑 `menubar/build.sh` 成功且真实构建目录未变化
- [x] `node scripts/audit-transcripts.mjs`：真实库 12 条状态、12 份存档，错误 0、警告 12（全部旧字幕路径）；`npm run self-check` 仍因既有内容级 `theme-empty` 退出 1
- [x] 复审追加：`reconcilePendingState` 从笔记回填 summary/question/answer/tags/concepts/quality/review 并重建索引；`normalizeNoteRoot` 统一 `./视频笔记` 等写法，恢复扫描同时支持 structured 与 flat，扫描不完整时保留 pending；`transcript-audit` 交叉核对 state.transcriptPath 与存档 owner（`state-transcript-owner-mismatch`），路径非法或指向字幕目录外报 `state-transcript-invalid` / `state-transcript-outside-archive`，直接读取字幕目录并把外指符号链接报 `archive-dir-unreadable`；`readVaultText` 区分 `vault-unavailable` 与 `not-found`；无 owner 读存档必须 `allowUnowned:true`；`recordReview` 在写入抛错时保留 pending
- [x] 复审追加（audit2-core）：崩溃恢复按身份跨学科合并同一笔记的旧状态记录，优先使用新路径，删除重复并把记录迁到新学科；`ready` 与 `reprobeVault()` 共用恢复任务，首次 `vaultAccess` 超时、重新探测成功后补跑待处理视频；新增 `core/test/reconcile-pending.test.js` 3 项覆盖同路径旧记录、标题/学科变化和 reprobe 补跑
- [x] `cd core && node --test`：348 tests / 348 pass / 0 fail；`npm run check` 109 个文件通过；`git diff --check` 无输出
- [x] 真实库只读验证：`npm run self-check` 13 篇、错误 1（既有 `theme-empty`）、警告 13（12 条旧字幕路径 + 1 条 `chapters-missing`），退出 1；`node scripts/audit-transcripts.mjs` 13 条状态、12 份存档、错误 0、警告 12（全部旧字幕路径）
- [x] 未删除真实构建备份、未安装新 app、未迁移或改写真实笔记

## 2026-11-18 B站字幕/转写与通知修复

背景：40 分钟 B站视频无 UP 主字幕，旧实现仅 46 秒就生成 metadata-only 笔记（简介 0 字、字幕 0 字、quality 1），且用户没有收到任何处理节点通知。

- [x] B站播放器接口改为优先 /x/player/wbi/v2：AI 字幕 URL 必须包含当前 aid + cid，避免部分登录态下 /x/player/v2 返回最近观看视频的字幕地址；字幕 URL 统一补全协议并只接受 https；优先级 ai-zh → zh-Hans/zh-CN/zh → ai-en/en
- [x] B站字幕抓取带 Cookie，失败后 yt-dlp 自动无 Cookie 重试；仍无字幕则下载 bestaudio + ffmpeg + Whisper 本地转写。每一步失败写入 transcript 的 detail/attempts，日志不再静默
- [x] processTitle 记录 bili cookie=ok/none 与 transcript source/detail/length/attempts；transcript 事件带 detail，面板可看出当前来源
- [x] 总结可靠性：LLM 单次超时从 120 秒提高到 300 秒（server/llm.js 同步）；校验要求 summary 非空且不等于标题、keyPoints 至少一项非空；两轮都失败时用字幕 digest 的句子构造 summary 与「内容要点」，不再退化成标题
- [x] 重复笔记防护：writeVideoNote 在 previousNotePath 存在且笔记身份与目标完全一致时沿用旧路径，标题变化不再生成第二篇笔记，也不覆盖身份不明的手写文件
- [x] 通知：菜单栏应用新增 SeenLog，Notifier/EventStream 记录权限状态、SSE 连接、收到 notification 事件、通知投递成功/失败；应用运行时由 UNUserNotificationCenter 投递，独立服务仍用 osascript 兜底
- [x] 临时库端到端：4 万字级 B站音频转写经 POST /api/resummarize 重新总结，5 分 08 秒完成，quality 从 3 升到 5，contentSource=archive、contentType=opinion，含完整 summary/question/answer/关键数字/论证结构/10 个知识点/6 个概念
- [x] 真实库复跑：同一篇 14,437 字字幕存档重新总结，15:44–15:51 完成，笔记 15,990 bytes、quality 5、warnings 空、stateSaved true；未产生第三篇重复笔记
- [x] cd core && node --test：354 tests / 354 pass / 0 fail；npm run check 109 个文件通过
- [x] 删除旧 metadata 孤立笔记后复检：npm run self-check 13 篇（当前格式 13 / 旧格式 0），错误 0、警告 0；索引 239 条双链 / 手册 6 篇，状态 13 条 / 笔记缺失 0 / 字幕缺失 0
- [x] 0.5.3 universal app 重新构建、固定证书签名并安装到 ~/Applications/Seen.app；启动日志显示通知权限 authorized、SSE HTTP 200
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.3.dmg`（85M，universal）：挂载校验 app 版本 0.5.3、固定证书签名通过、lipo 为 x86_64 + arm64，bundle 内含 `player/wbi/v2`、`LLM_TIMEOUT_MS = 300000`、`通知：` 日志与 `previousNotePath` 复用逻辑

## 2026-11-18 重整理来源语义修复

背景：用存档字幕重整理后，frontmatter 的 `contentSource` 变成 `archive`，评分与来源提示只认这个字段，导致短人工字幕笔记重整理掉分、来源统计显示「音频转写 0 字」、正文没有来源说明。

- [x] 重整理仍写 `contentSource: "archive"`，同时新增 frontmatter `transcriptOrigin` 保存原始字幕来源（旧笔记没有 `transcriptOrigin` 时从原 `contentSource` 回退；已经是 `archive` 且未记录原始来源的只能标为「更早的字幕存档」）
- [x] 质量分与来源统计标签改用 `transcriptOrigin`；短人工字幕重整理后不会再因为 `archive` 掉 1 分
- [x] 正文新增「内容来源：本地字幕存档（重整理，原文来自 UP 主字幕 / B站 AI 字幕 / YouTube 字幕 / 本地 Whisper 转写）」；抖音、YouTube、B站的来源统计都显示存档字数，不再是 0 字
- [x] 新增回归：`renderVideoNote` 的 archive + up-subtitle 场景（quality 5、frontmatter `transcriptOrigin`、来源提示）；`resummarizeNote` 从旧笔记回填原始来源并保留 5 分
- [x] `cd core && node --test`：356 tests / 356 pass / 0 fail；`npm run check` 109 个文件通过
- [x] README / CLAUDE.md / docs/contracts.md / docs/architecture.md 同步 `transcriptOrigin` 与 archive 评分说明

## 2026-11-18 v0.5.4 发布

- [x] `cd core && node --test`：356 tests / 356 pass / 0 fail；`npm run check` 109 个文件通过；`npm run self-check` 14 篇（当前格式 14 / 旧格式 0），错误 0、警告 0
- [x] 0.5.4 universal app 构建、固定证书签名并安装到 `~/Applications/Seen.app`；启动后 `GET /api/status` 返回 ok、只读关闭、vault ok，菜单栏日志显示通知权限 authorized、SSE HTTP 200
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.4.dmg`（85M，universal）：挂载校验 app 版本 0.5.4、固定证书签名通过、lipo 为 x86_64 + arm64，bundle 内含 `transcriptOrigin`
- [x] DMG SHA256：`3aefe14a64d5c4d90772c57c67f555f44cf5bbc8f4c7efa3ef88fbe947965f3d`（`dist/Seen-v0.5.4.dmg.sha256`）

## 2026-11-18 通知排版与串行队列

背景：抖音精选的通知标题是标签页口号「抖音精选电脑版 - 抖音旗下优质视频平台」，平台还单独占一行；另外第一条视频转写期间打开第二条，轮询在等 `processTitle`，第二条不会被观察。

- [x] 通知标题固定为视频标题，副标题为「拾影 · 平台 · 阶段」，平台不再单独占一行；四个节点（开始整理 / 本地转写中 / 笔记已生成 / 处理失败）统一由 `server/notification.js` 的 builder 生成
- [x] 抖音的「开始整理」等 `fetchDouyinContent` 抛出 metadata 事件（缓存命中也发）后再通知，使用页面解析出的真实标题；转写与转写进度事件带 title/author，B站与 YouTube 同步补齐
- [x] 失败与 vault-blocked 事件带 title/source，处理失败通知也能显示视频名而不是「新视频」
- [x] 前台轮询与处理解耦：`core/lib/process-queue.js` 串行队列（同 key 去重、最多 8 条、单条失败不阻断后续、`clear()` 返回清空数量）
- [x] `observeOnce` 只入队不 await `processTitle`；第一条转写时第二条进入队列，前一条结束后自动处理；`stop()` 清空等待队列
- [x] 新增 `core/test/process-queue.test.js`（串行顺序、运行中/等待中去重、失败继续、clear、上限、whenIdle）与 `core/test/notification.test.js`（平台标签、副标题、四个 builder、标题去站点后缀/话题标签）
- [x] 临时服务端到端：用真实抖音缓存重新总结，`server.log` 记录「通知：<视频标题> | 作者：<作者>」与「通知：<视频标题> | 已归入「语言学」」；笔记写入临时库，未碰真实 vault
- [x] `cd core && node --test`：369 tests / 369 pass / 0 fail；`npm run check` 113 个文件通过
- [x] README / CLAUDE.md / docs/architecture.md / docs/contracts.md 同步通知文案与串行队列


## 2026-11-18 v0.5.5 发布

- [x] `cd core && node --test`：369 tests / 369 pass / 0 fail；`npm run check` 113 个文件通过
- [x] 0.5.5 universal app 构建、固定证书签名并安装到 `~/Applications/Seen.app`；`GET /api/status` 返回 ok、只读关闭、vault ok，菜单栏日志显示通知权限 authorized、SSE HTTP 200
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.5.dmg`（85M，universal）：挂载校验 app 版本 0.5.5、固定证书签名通过、lipo 为 x86_64 + arm64，bundle 内含 `cleanNotificationTitle` 与 `processQueue`
- [x] DMG SHA256：`88f4d0e80ae01fc82b375f1f83cd5faa1b64d009e762b33abb7f79c150e12feb`（`dist/Seen-v0.5.5.dmg.sha256`）
- [x] 安装备份清理：`npm run prune:install -- --apply --keep 1` 删除两份较旧备份 `Seen.app.20261118-183830`、`Seen.app.20261118-193741`，共释放约 467 MB；保留最新的 0.5.4 安装备份用于回滚


## 2026-11-18 手动检查更新

背景：此前只有启动时被动检查，面板顶部横幅关闭后没有任何入口；用户按提示去找「检查更新」却找不到。

- [x] 服务端新增 `GET /api/update`，支持 `?force=1` 绕过 24 小时缓存；返回当前版本、最新版本、是否有更新、发布页、检查时间与是否禁用
- [x] 侧栏「设置」下新增「更新」按钮（带未读圆点），点击调用 `/api/update?force=1`，按钮显示「检查中」并禁用，结果用 toast 提示；发现新版本时强制重新打开被关闭的顶部提示条
- [x] 临时服务验证：`SEEN_DISABLE_UPDATE_CHECK=1` 时返回 disabled 且 toast 明确提示；正常模式返回 current/latest 0.5.5（当时最新）并提示「已是最新版本」
- [x] 新增 `core/test/server-integration.test.js` 的更新接口测试
- [x] `cd core && node --test`：370 tests / 370 pass / 0 fail；`npm run check` 113 个文件通过
- [x] README / CLAUDE.md 同步手动检查入口


## 2026-11-18 输入框占位居中

背景：添加视频的输入框用 `rows="2"` 的 textarea 撑两行，单行占位文字落在第一行顶部，看起来偏上。

- [x] `#manualUrl` 改为 `rows="1"`，CSS 高度固定为一行（`height: 21px`，与 `line-height: 1.5` × 14px 一致），由外层 flex 垂直居中
- [x] 粘贴多行内容时按 `scrollHeight` 自动增高，最高 96px；清空后回到一行
- [x] Playwright 实测：外框高 50px，输入框高 21px，上下各 14.5px；三行内容增高到 63px
- [x] `cd core && node --test`：370 tests / 370 pass / 0 fail；`npm run check` 113 个文件通过

## 2026-11-25 Codex 分支审查与合并前复验

背景：审查 `codex/project-audit-20261118` 相对 `main` 的三个提交，确认后再合并。

- [x] 复核队列、状态备份/恢复、维护实例锁、迁移/重打标签、菜单栏自检、网页批量与重复笔记交互
- [x] 修复迁移脚本在旧辅助目录为符号链接时越界移动外部文件的问题；迁移前拒绝符号链接并新增回归测试
- [x] 修复用户重命名概念/主题页后被误判退出收录的问题；按 frontmatter 标题识别受管页面，并新增回归测试
- [x] 批量粘贴限制为最多 20 个链接，避免单请求长时间占用
- [x] `cd core && node --test`：391 tests / 391 pass / 0 fail；`npm run check`：117 个文件通过
- [x] `npm run self-check`：14 篇笔记、错误 0、警告 0

## 2026-11-25 v0.5.6 发布

- [x] `cd core && node --test`：391 tests / 391 pass / 0 fail；`npm run check`：117 个文件通过；`npm run self-check`：14 篇笔记、错误 0、警告 0
- [x] 0.5.6 universal app 构建、固定证书签名并安装到 `~/Applications/Seen.app`
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.6.dmg`（86M，universal）：挂载校验版本 0.5.6、签名通过、lipo 为 x86_64 + arm64
- [x] DMG SHA256：`521cdf0c5c309bde68038b273857985b2c6d641a9ae1f66223f61a27314a7304`
- [x] GitHub Release 已发布并设为 latest：https://github.com/zayn-0101/seen/releases/tag/v0.5.6

## 2026-11-26 视频笔记 v5 模板

背景：format 4 的模板存在标题重复、属性过多、颜色无层级、概念与术语重复、复习卡片凑数、折叠在 Live Preview 失效等问题。用户在示例笔记上逐项确认后，按 `docs/note-template-v5-plan.md` 分阶段实施，旧 format 4 笔记不自动改写。本节记录 2026-11-26 当时的实施状态；附录在 2026-11-27 改为独立编号并默认展开，见文末两节。

- [x] Phase 1 数据与标题：新增 `core/lib/text.js`（`spaceCjk` / `cleanDisplayTitle`），生成时保留 `originalTitle`、用清洗后的 `displayTitle` 作为文件名与笔记标题；`created` 与 `updated` 分开；新增 `noteTags`（学科 + 主题，写进笔记）与 `allTags`（含类型/概念，供索引与筛选）
- [x] Phase 2 渲染：新增 `renderVideoNoteV5`，可见中文属性 + 文末 `seen-meta`、正文无 H1、`[!abstract] 摘要`（概述/核心问题/核心结论）、动态编号的 `01 速览`～`07 我的补充`、概念与术语合并为两列表格、复习卡片改为 `[!summary]-` 多行卡（问题 / `?` / 答案）、附录统一为可折叠 callout
- [x] Phase 4 校验：`NOTE_FORMAT` 保持 4 供旧版使用，新增 `NOTE_FORMAT_V5 = 5`；`parseNoteMarkdown` 支持中文属性、`seen-meta`、编号 H2/H3、概念表；`checkNoteShape` 对 v5 使用独立区块顺序并跳过 `flashcards`/`review` 控制标签
- [x] 示例 `docs/examples/note-format-v5-sample.md` 通过 v5 解析与结构检查：format 5、7 个主区块、概念表 8 项、结构错误 0
- [x] `core/test/render.test.js` 8 项、`core/test/note-check.test.js` 18 项通过；新增 `core/test/text.test.js` 覆盖标题清洗与中英文空格
- [x] 修复 `checkIndexLinks` 不识别表格中 `\\|` 转义竖线、把路径末尾反斜杠当成目录的问题；新增回归测试
- [x] `cd core && node --test`：403 tests / 402 pass / 1 skipped / 0 fail
- [x] `npm run check`：语法检查通过 121 个文件
- [x] `npm run self-check`：真实库 22 篇，错误 0、警告 3（既有 `chapters-missing`）；索引 395 条双链、状态 22 条
- [x] 文档同步：README、docs/contracts.md、docs/architecture.md、CLAUDE.md、`docs/note-template-v5-plan.md` 已更新为 format 5 口径
- [x] 可选样式 `docs/examples/seen-note.css` 入库，README 说明复制到 vault 后启用；没有 CSS 时正文仍可读
- [ ] 真实 B 站/抖音/YouTube 端到端生成 v5 笔记（需要真实抓取与模型调用）
- [ ] 旧 format 4 笔记迁移脚本（默认预演、`--apply` 才写、写前备份）
- [x] 发布时间已接入：新增 `core/lib/dates.js` 统一归一为 `YYYY-MM-DD`；B 站取 `pubdate`、YouTube 取 `upload_date`/`release_date`/`timestamp`、抖音取 `createTime`；`renderVideoNoteV5` 写入「发布时间」属性与 `seen-meta.publishedAt`；旧缓存缺该字段时保持为空
- [x] 新增 `core/test/dates.test.js` 覆盖 Unix 秒/毫秒、`YYYYMMDD`、ISO 与非法日期；YouTube 与 v5 渲染测试补充 `publishedAt` 断言
- [x] 未改写真实笔记库、未安装应用、未 commit/push

## 2026-11-26 v5 真实 B 站端到端

背景：用真实 B 站视频、真实模型和临时 vault 跑一遍 format 5 生成链路，不写用户正式笔记库、不改 state，验证模板在真实字幕和模型输出下的表现。

- [x] 临时 vault 生成《我们熟悉的那个 3A 游戏时代，可能真的结束了。》：format 5、中文属性、摘要三段、01–06 动态编号、5 张真问答复习卡、附录 callout、我的补充最后、seen-meta 完整
- [x] 发布时间取真实 pubdate 为 2026-11-17；复习卡 callout 与多行卡格式可被 Spaced Repetition 识别
- [x] 结构校验：parseNoteMarkdown + checkNoteShape 返回 0 findings；概念表 11 项，无 3A / DEI 指标之类的重复行
- [x] 端到端暴露并修复：复习卡只有 1 张（提示词新增 3~5 组 reviewCards）、原话全为 00:00（time=0 不再显示假链接）、概念/术语重复（按别名和包含关系去重）、文件名结尾多句号（标题去尾句读）、可质疑之处照抄观众评论（提示词要求针对论证本身）
- [x] 新增 normalizeReviewCards 并兼容旧「问题::答案」；normalizeQuotes 丢弃零时间；cleanDisplayTitle 保留问号/感叹号、只去句读
- [x] cd core && node --test：405 tests / 0 fail（Swift 环境不可用时跳过 1 项菜单栏进程测试）；npm run check：121 个文件通过
- [x] 未写真实笔记库、未迁移旧 format 4、未 commit/push

## 2026-11-26 v5 真实抖音端到端

背景：用真实抖音精选视频（蒙曼《山河表里潼关路》，4:25）在临时 vault 跑 format 5，不写正式库、不改 state。抖音依赖无头 Chrome、ffmpeg、whisper 和本地模型，重点验证平台标题、发布时间与本地转写。

- [x] 生成 `视频笔记/笔记/历史/山河表里潼关路.md`：format 5、中文属性、摘要三段、`01 速览`（6 个带时间关键数字 + 章节）、`02 核心知识点`、`03 常见误解`、`04 核心概念与术语`、`05 复习卡片`（4 张真问答）、`06 我的补充`、附录 callout
- [x] 发布时间取真实 `createTime` 为 `2026-11-05`；字幕为本地 Whisper 转写，抓取统计 1,014 字
- [x] `parseNoteMarkdown` + `checkNoteShape` 返回 0 findings；标题与 displayTitle 均为 `山河表里潼关路`
- [x] 端到端暴露并修复：抖音抓取标题带长简介、分类标题又覆盖一次，导致文件名变成「山河表里潼关路 潼关为关中锁钥……」。新增 `pickOriginalTitle`，优先使用抓取/输入的真实标题，分类标题只兜底，并拦截「原题 + 大段补充」的覆盖；分类提示词禁止补副标题/总结
- [x] `cd core && node --test`：406 tests / 406 pass / 0 fail；`npm run check`：121 个文件通过
- [x] 未写真实笔记库、未迁移旧 format 4、未 commit/push

## 2026-11-26 v5 真实 YouTube 端到端

背景：用真实 YouTube 缓存（TEDx `8S0FDjFBj8o`，5:56，人工字幕）和仅元数据视频（`z4AbijUCoKU`，无字幕）在临时 vault 跑 format 5，验证英文字幕、发布时间和无字幕边界。

- [x] 完整字幕视频生成 `视频笔记/笔记/演讲/How to sound smart in your TEDx Talk.md`：format 5、发布时间 2015-01-15、YouTube 字幕、12 条概念、0 findings；章节、关键数字、操作步骤、核心知识点、复习卡片均带 `t=` 时间链接
- [x] 仅元数据视频只保留 `[!warning] 内容依据有限`、摘要、`01 速览`、`延伸思考`、抓取统计和 `02 我的补充`；不再输出核心知识点、复习卡片、关键数字和概念表
- [x] 修复仅元数据时模型从简介编知识点/复习卡的问题；`<Untitled Chapter 1>` 占位章节在 YouTube 解析和渲染两处都过滤；没有真实评论时讨论区标签从「YouTube 评论」改为「延伸思考」
- [x] 英文长标题截断不再只留第一句：按标点截断过短时退回最近空格，`Give Me 15 Minutes. I'll Teach You 80% of Obsidian` 生成 `Give Me 15 Minutes. I'll Teach You 80%`
- [x] `cd core && node --test`：407 tests / 407 pass / 0 fail；`npm run check`：121 个文件通过；`npm run self-check`：22 篇 0 错误（3 条既有章节警告）
- [x] 未写真实笔记库、未迁移旧 format 4、未 commit/push

## 2026-11-26 v5 正式库迁移

背景：用户确认直接迁移，把正式库 22 篇 format 4 笔记升级为 format 5。迁移前用 `osascript` 退出 Seen，确认实例锁释放；迁移后重启 Seen。原文件与 state 备份在 `~/.seen/backups/v5-2026-11-26T16-23-02`。

- [x] 正式库迁移：22 篇笔记、13 篇改名、40 个文件引用改写；state 的 notePath、transcriptPath、title、originalTitle、displayTitle、noteTags、duration 同步
- [x] 生成 v5 版式：中文属性、文末 seen-meta、无正文 H1、摘要三段、动态编号、概念表、多行复习卡、可折叠附录、我的补充最后
- [x] 修复迁移中暴露的 5 个问题：改名后旧文件未移除（13 组重复）、索引写到 vault 根、字幕存档 owner 未更新、先加空格导致双链无法匹配、self-check 只认可见 type 且把资料页算作笔记
- [x] 正式库校验：`/tmp/verify-migrated-real2-54.mjs` 返回 files 82、videos 22、missing 0、structural 0、linkErrors 0、numbering 0
- [x] 迁移后 `cd core && node --test`：407 tests / 407 pass / 0 fail；`npm run check`：122 个文件通过；`npm run self-check`：22 篇（当前格式 22 / 旧格式 0）错误 0 警告 0
- [x] 用迁移前备份重建临时副本复验：22 篇、22 份字幕、vault 根无 .md、索引旧链接 0，self-check 通过
- [x] Seen 已重启：PID 91739 / 服务 91742，`/api/status` 返回权限正常、轮询运行中、8 个学科
- [x] 未 commit/push

已知小问题：旧笔记迁移后每篇只有 1 张真问答卡（旧的 `H3标题::首条要点` 假卡已过滤）；抓取统计数字没有千分位；少数旧文保留繁体字。
## 2026-11-27 旧笔记补真复习卡

背景：22 篇旧 format 4 笔记迁移到 format 5 后，每篇只剩 1 张真问答卡（旧的 `H3 标题::首条要点` 假卡已过滤）。用户选择批量补卡，不重新下载视频，只基于现有笔记正文生成。

- [x] 新增 `scripts/refill-review-cards.mjs`：默认预演，`--apply` 才写；支持 `--limit` / `--only` / `--cache` / `--refresh`；只替换 `## 0X 复习卡片` 的 `[!summary]-` callout，保留四个附录 callout 和 `## 07 我的补充`
- [x] `core/lib/obsidian.js` 增加 `writeVaultText`，通过 vault 队列原子覆盖写；`core/test/obsidian.test.js` 增加创建、覆盖、读回与空路径测试
- [x] 提示词要求 3~5 组真问答，问题以问号结尾，答案不超过 60 个汉字；过滤「笔记/视频/作者/主播/文中/片中」这类指代材料的元问题
- [x] 卡片正文统一走 `spaceCjk`，与笔记正文的中英文、数字空格保持一致
- [x] 生成结果：22 篇，每篇 4~5 张；问题均为完整问句，答案分别为独立行
- [x] 写前备份：`~/.seen/backups/review-cards-20261127-084019/manifest.json`（首次生成备份在 `review-cards-20261127-083854`）
- [x] 校验：22 篇 format 5、`checkNoteShape` findings 0、每篇 4~5 张卡、`我的补充` 仍是最后一节、四个附录 callout 仍在
- [x] `cd core && node --test`：408 tests / 408 pass / 0 fail；`npm run check`：123 个文件通过；`npm run self-check`：22 篇（当前格式 22 / 旧格式 0）错误 0 警告 0
- [x] 本次补卡改动已本地提交，未 push

已知小问题：部分卡片偏数字型事实；两篇只有 4 张卡（生成时被元问题过滤）；没有把 `reviewCards` 写回 state，刷新或重整理如果不走模型，无法从 state 恢复这些卡。

## 2026-11-27 v0.5.7 发布

- [x] `package.json` 从 0.5.6 升到 0.5.7，提交 `a1ac63e chore: 升版本到 0.5.7`
- [x] `cd core && node --test`：408 项通过，0 失败；`npm run check`：123 个文件通过；`npm run self-check`：22 篇笔记，错误 0，警告 0
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.7.dmg`（85M，universal）：版本 0.5.7、固定证书签名通过、内嵌代码含 `renderVideoNoteV5`
- [x] SHA256：`d7d0a6c6de1206c28527f37edd4fc3be6959a23fc8e4d5af15d4c665fea222a3`
- [x] 安装到 `/Applications/Seen.app`，旧版本备份在 `~/.seen/install-backups/Seen.app.20261127-095817`；安装后进程 PID 55884、服务 PID 55901，vault 权限正常
- [x] `git push origin main` 与 tag `v0.5.7` 已推送；GitHub Release 已发布并设为 latest：https://github.com/zayn-0101/seen/releases/tag/v0.5.7
- [x] 本机 `/Applications/Seen.app` 已是 0.5.7，新视频自动整理使用 format 5

## 2026-11-27 附录独立成节

背景：用户发现 `## 06 复习卡片` 下还包含原话摘录、提到的资源、观众讨论、抓取统计四个 callout，而且全部默认折叠。原因是四个 callout 与 `## 07 我的补充` 之间没有新的二级标题，Obsidian 按标题层级把它们归到 06 下。

- [x] `renderVideoNoteV5` 在第一个附录 callout 前输出不编号的 `## 附录`，`我的补充` 仍是最后一个编号区块
- [x] `scripts/migrate-note-format-v5.mjs` 同步输出 `## 附录`，迁移后的旧笔记不再把附录挂在复习卡片下
- [x] `SECTION_ORDER_V5` 在 `复习卡片` 与 `我的补充` 之间加入 `附录`，v5 自检按新区块顺序校验
- [x] `core/test/render.test.js` 与 `core/test/note-check.test.js` 补断言：`## 附录` 位于复习卡片之后、第一个附录 callout 之前；聚焦测试 27/27 通过
- [x] `docs/examples/note-format-v5-sample.md` 加入 `## 附录`
- [x] 正式库 22 篇笔记全部补 `## 附录`，原文备份在 `~/.seen/backups/appendix-heading-2026-11-27T03-36-18-524Z`
- [x] `cd core && node --test`：408 tests / 408 pass / 0 fail；`npm run check`：123 个文件通过；`npm run self-check`：22 篇（当前格式 22 / 旧格式 0）错误 0 警告 0
- [x] 0.5.8 已构建、安装、push 并发布，见下一节

已知取舍（v0.5.8 当时；v0.5.9 已改为参与编号并默认展开，完整结构下为 `07 附录`）：`## 附录` 不参与 01~07 编号，避免附录变成第八个主区块；四个 callout 仍默认折叠，需要展开时点标题。

## 2026-11-27 v0.5.8 发布

背景：附录独立成节完成后，按用户已授权的完整流程升版本、构建、安装、推送并发布。

- [x] `package.json` 升到 0.5.8，与附录修复一起提交 `24fbe70 fix: 附录独立成节`
- [x] 发布前验证：`cd core && node --test` 408 tests / 408 pass / 0 fail；`npm run check` 123 个文件通过；`npm run self-check` 22 篇错误 0 警告 0
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.8.dmg`（85M，universal）：版本 0.5.8、固定证书签名通过、内嵌代码含附录渲染逻辑
- [x] DMG SHA256：`e3a1cafe7b0877f1414b6e7ecb5ad7fadce233facfe4dcfcda6be350febd0d36`
- [x] 安装到 `/Applications/Seen.app`，旧版本备份在 `~/.seen/install-backups/Seen.app.20261127-114218`；安装后进程 PID 87801、服务 PID 87817，vault 权限正常、轮询运行中
- [x] `git push origin main`（`4d27475..24fbe70`）与 tag `v0.5.8` 已推送
- [x] GitHub Release 已发布并设为 latest：https://github.com/zayn-0101/seen/releases/tag/v0.5.8 ，资产 `Seen-v0.5.8.dmg` 89,261,194 bytes
- [x] 本机 `/Applications/Seen.app` 已是 0.5.8，新视频自动整理使用带 `## 附录` 的 format 5

## 2026-11-27 附录重编号与展开

背景：用户认为 `06 复习卡片 → 附录 → 07 我的补充` 的结构很怪，附录是正文内容，不需要默认折叠。推荐方案是附录参与编号（完整结构下为 `07 附录`），我的补充顺延为最后一节（完整结构下为 `08`），四个附录 callout 全部展开；用户确认「按你推荐的来」。

- [x] `renderVideoNoteV5` 把附录加入动态编号（完整结构下为 `07 附录`，无相关笔记时为 `06`，再少一个区块时为 `05`）；`我的补充` 顺延为最后一节，仍是最后一块
- [x] 原话摘录、提到的资源、观众讨论/延伸思考、抓取统计四个附录 callout 去掉折叠标记 `-`，默认展开；复习卡片的 `[!summary]-` 仍保持折叠
- [x] 抓取统计只保留字幕、弹幕、评论；YouTube 去掉「章节」统计行，B 站/抖音仍为三行；迁移后又清掉 3 篇 YouTube 笔记里残留的 `> - 章节：N 个`，清理后备份在 `~/.seen/backups/stats-v059-20261127-122605/video-notes.tgz`
- [x] `scripts/migrate-note-format-v5.mjs` 同步把附录改为编号区块、我的补充放在最后并顺延，附录 callout 默认展开，`parseStats` 不再接受「章节」
- [x] `core/test/render.test.js` 更新编号、展开 callout 和顺序断言；聚焦测试 27/27 通过
- [x] 正式库 22 篇笔记按实际区块重编，附录不再无编号：3 篇完整结构为 `07 附录` / `08 我的补充`，13 篇为 `06 附录` / `07 我的补充`，6 篇为 `05 附录` / `06 我的补充`；四个附录 callout 展开；原文备份在 `~/.seen/backups/appendix-v059-20261127-120407/video-notes.tgz`
- [x] `docs/examples/note-format-v5-sample.md` 与 Obsidian 预览副本同步为 07/08 和展开 callout
- [x] README、CLAUDE.md、docs/contracts.md、docs/architecture.md、docs/note-template-v5-plan.md 已改为「附录参与动态编号、默认展开，我的补充最后顺延」
- [x] `cd core && node --test`：408 tests / 408 pass / 0 fail；`npm run check`：123 个文件通过；`npm run self-check`：22 篇（当前格式 22 / 旧格式 0）错误 0 警告 0

已知取舍：复习卡片仍默认折叠，因为卡片是先自测再展开的内容；附录是资料，默认展开。

## 2026-11-27 v0.5.9 发布

背景：附录重编号与展开完成后，按用户「按你推荐的来」和既有完整发布流程升版本、构建、安装、推送并发布。

- [x] `package.json` 升到 0.5.9，与代码、迁移脚本、测试、示例和文档一起提交 `8c7b25f fix: 附录改为 07 并默认展开`
- [x] 发布前验证：`cd core && node --test` 408/408；`npm run check` 123 个文件通过；`npm run self-check` 22 篇（当前格式 22 / 旧格式 0）错误 0 警告 0
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.9.dmg`（85M，universal，版本 0.5.9，固定证书签名）
- [x] DMG SHA256：`147d2ef8c69c7718737f5ef1bdfe7f4ea0d7eb6d014cb76441f0dec3bee42772`
- [x] 安装到 `/Applications/Seen.app`，旧版本备份在 `~/.seen/install-backups/Seen.app.20261127-121237`；安装后进程 PID 99884、服务 PID 99913，`/api/status` 返回 ok、vault 正常、8 个学科
- [x] `git push origin main`（`76ee91d..8c7b25f`）与 tag `v0.5.9` 已推送，tag 指向 `8c7b25f`
- [x] GitHub Release 已发布并设为 latest：https://github.com/zayn-0101/seen/releases/tag/v0.5.9 ，资产 `Seen-v0.5.9.dmg` 89,261,206 bytes
- [x] 本机 `/Applications/Seen.app` 已是 0.5.9，后续生成的 format 5 笔记使用动态编号的附录（完整结构下 07）、最后一节我的补充和默认展开的附录 callout

## 2026-11-27 学科手册术语表修复

背景：学科手册的术语表读取 state 里 `video.terms` 的 `brief` 字段，但 state 实际存的是 `definition`，导致术语只有名称、没有解释。

- [x] `core/lib/render.js` 的术语表改为优先读取 `definition`，旧数据没有 `definition` 时回退 `brief`
- [x] `core/test/render.test.js` 增加回归测试，覆盖 `definition` 和 `brief` 回退
- [x] `cd core && node --test`：409 tests / 409 pass / 0 fail；`npm run check`：123 个文件通过；`npm run self-check`：22 篇（当前格式 22 / 旧格式 0）错误 0 警告 0

## 2026-11-27 v0.5.10 发布

背景：术语表修复只在仓库代码里，已安装的 0.5.9 仍用旧渲染器，8 篇学科手册的 119 个术语仍只有名称。按用户确认，升版本、构建、安装、重启重建知识库并发布。

- [x] `package.json` 升到 0.5.10，提交 `f5905b4 chore: release v0.5.10`
- [x] 发布前验证：`cd core && node --test` 409/409；`npm run check` 123 个文件通过；`npm run self-check` 22 篇（当前格式 22 / 旧格式 0）错误 0 警告 0
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.10.dmg`（85M，universal，版本 0.5.10，固定证书签名 `Seen Local Signing`）
- [x] DMG SHA256：`b311d39fc3a80b3d616492e2fb44b27a9743ac0691e013c8e816e273259b8d23`
- [x] 安装到 `/Applications/Seen.app`，旧版本备份在 `~/.seen/install-backups/Seen.app.20261127-175826`；安装后进程 PID 6762、服务 PID 6784，`/api/status` 返回 ok、vault 正常、8 个学科
- [x] 重启后启动重建完成：8 篇学科手册共 119 个术语全部补齐解释，`no_explanation=0`；抽样「人工智能」手册首条为 `- **Harness** — 原意「马具」，指把模型与工具连接起来、让模型听懂指令的工作环境。`
- [x] `git push origin main`（`82cc71e..f5905b4`）与 tag `v0.5.10` 已推送，tag 指向 `f5905b4`
- [x] GitHub Release 已发布并设为 latest：https://github.com/zayn-0101/seen/releases/tag/v0.5.10 ，资产 `Seen-v0.5.10.dmg` 89,218,847 bytes

## 2026-11-28 长视频总结密度调整

背景：3A 笔记按旧逻辑重生成后，核心知识点从 12 个主题 / 48 条要点降到 6 个主题 / 14 条要点（核心区 695 字），结构合规但内容明显变薄。原因是 `summarize` 在字幕超过 8,000 字时先压成 8~20 条短句，论证分支被丢掉。用户选择先调提示词密度、只重跑 3A，确认后再批量。

- [x] `core/lib/analyze.js`：长视频（字幕 >8,000 字）总结要求 8~15 个主题、每主题 2~5 条要点，覆盖全片论证、案例和转折；分块阈值从 8,000 字调到 15,000 字，分块 7,000 字、每块 8~16 条并保留 `[mm:ss]`，合并后 20~40 条
- [x] `core/test/analyze.test.js` 新增长/短视频提示词密度断言
- [x] 3A 最终样张：11,096 字、14 个核心主题、61 条要点、79 个时间链接；核心区 6,984 字，旧笔记为 5,936 字 / 核心 2,678 字
- [x] 为恢复时间链接，从缓存重建 4 篇 B 站笔记的带时间戳字幕：DSH 21,730 字、GTA 千亿豪赌 9,395 字、鹤岗 7,614 字、Obsidian 入门 11,035 字
- [x] 批量重生成剩余 21 篇，0 失败；正文 109,997 → 128,752 字（+17%），核心知识点 41,827 → 54,703 字（+31%），时间链接 221 → 463；13 篇变长、8 篇变短
- [x] 2 篇 YouTube 笔记（第二大脑、Give Me 15 Minutes）因缓存无时间轴，重生成后补回旧章节块（9 条 / 8 条）
- [x] 连同 3A，22 篇正文约 139,848 字，核心知识点约 61,687 字
- [x] 22 篇复习进度、笔记创建日期与「我的补充」正文全部保留；22 篇仍为 format 5，旧标记 0
- [x] 备份：`~/.seen/backups/3a-timed-20261128-002648`（3A 笔记与字幕）、`~/.seen/backups/batch-regen-20261128-011110`（全库笔记与 state）
- [x] `cd core && node --test`：410 tests / 410 pass / 0 fail；`npm run check`：123 个文件通过；`npm run self-check`：22 篇（当前格式 22 / 旧格式 0）错误 0 警告 0

已知取舍：北京外卖、第二大脑、割裂的 30 帧、中国人不知道「司机」4 篇重生成后正文变短；逐篇读过，主要是旧版过细分支被合并，主要结论和信息点仍在。`buildMaterialBlock` 仍把带时间轴字幕截到 14,000 字，DSH 这类 20k+ 字长视频的尾部可能没有送入模型，留待后续优化。

## 2026-11-28 v0.5.11 发布

背景：密度调整在仓库代码中完成，正式库 22 篇已重生成；按用户「走」执行完整发布流程。

- [x] `package.json` 升到 0.5.11，与 `analyze.js`、测试、README、CLAUDE.md、模板方案提交 `18072be feat: 提高长视频总结信息密度`
- [x] 发布前验证：`cd core && node --test` 410/410；`npm run check` 123 个文件通过；`npm run self-check` 22 篇 0 错误 0 警告
- [x] `./scripts/make-release.sh` 产出 `dist/Seen-v0.5.11.dmg`（85M，universal，版本 0.5.11，固定证书 `Seen Local Signing`）
- [x] DMG SHA256：`2865be0366a15750730cfb4e4a9bbc26afeef2bc4f00cc09da6a441e6655e52d`
- [x] 安装到 `/Applications/Seen.app`，旧版本备份在 `~/.seen/install-backups/Seen.app.20261128-101345`；安装后进程 PID 40667、服务 PID 40670，`/api/status` 返回 ok、polling true、vault 正常、8 个学科
- [x] 已确认安装包内 `analyze.js` 含新密度规则（`8~15 个主题`）
- [x] `git push origin main` 与 tag `v0.5.11` 已推送，tag 指向 `18072be`
- [x] GitHub Release 已发布并设为 latest：https://github.com/zayn-0101/seen/releases/tag/v0.5.11 ，资产 `Seen-v0.5.11.dmg` 89,262,779 bytes
