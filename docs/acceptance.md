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
