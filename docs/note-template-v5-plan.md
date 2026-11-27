# 拾影视频笔记 v5 模板优化方案（完整版）

> 状态：Phase 1–5 已完成。真实 B 站、抖音和 YouTube 端到端生成通过；正式库 22 篇旧 format 4 笔记已迁移到 format 5，原文件与状态备份在 `~/.seen/backups/v5-2026-11-26T16-23-02`；22 篇旧笔记已补 3~5 张真复习卡（2026-11-27），备份在 `~/.seen/backups/review-cards-20261127-084019`；408 项测试通过，自检 22 篇 0 错误 0 警告。迁移提交 `88da1f1`、补卡提交 `28bcb0a`、版本提交 `a1ac63e`；v0.5.7 已发布并推送：https://github.com/zayn-0101/seen/releases/tag/v0.5.7 。2026-11-27 附录已独立成 `07 附录` 并默认展开，我的补充顺延为 `08`；渲染器、迁移脚本、校验、示例和 22 篇正式笔记已同步；v0.5.8 已发布：https://github.com/zayn-0101/seen/releases/tag/v0.5.8 。v0.5.9 已发布并推送（提交 `8c7b25f`）：https://github.com/zayn-0101/seen/releases/tag/v0.5.9 ，22 篇正式笔记已同步为 `07 附录` / `08 我的补充`。
> 样例：docs/examples/note-format-v5-sample.md
> 可选样式：docs/examples/seen-note.css

## 一、目标与范围

### 1.1 目标

把视频笔记从“信息区块罗列”改成适合回顾和系统复习的结构：

- 正文只保留阅读和复习需要的内容，元数据进属性面板；
- 同一信息只出现一次，避免概念与术语、视频信息与来源统计、摘要与结论互相重复；
- 标题、层级、颜色和折叠行为在 Obsidian 里清楚、稳定；
- 保留学科归类、标签索引、概念索引、相关笔记、复习卡片、字幕存档与重整理；
- 兼容 Spaced Repetition 插件，同时保证直接阅读文本可读。

### 1.2 范围

本方案覆盖视频笔记主模板，并连带修改与其直接相关的：

- 学科学习手册（去重、术语表修复、概览）
- 总览（学科视频数）
- 概念页、主题页（字段与链接不变，仅跟随新概念数据结构）
- 视频索引、概念索引、标签索引（标签来源与排序）
- 复习卡片与 Spaced Repetition 插件兼容

不包含：抓取、转写、模型供应商、缓存、封面、菜单栏应用等与本模板无关的改动。

## 二、设计原则

1. Obsidian 优先：文件名就是唯一可见标题，正文不写 H1。
2. 元数据只放属性面板；正文只放内容。
3. 一个信息只留一个地方：视频链接、UP 主、BV 号、字幕来源不再出现在抓取统计。
4. 颜色有语义：H2 主区、H3 子区、链接、标签各用固定层级，不用颜色表达“随便强调”。
5. 默认折叠用 callout，不用 details；details 在 Live Preview 里不可交互。
6. 插件兼容优先：复习卡片用 Spaced Repetition 的多行卡格式，问题、?、答案分行。
7. 样式可降级：没有 seen-note.css 时，标题层级、属性、callout 仍能读，只是颜色和两列排版简化。

## 三、最终目标版式

### 3.1 属性面板（frontmatter）

可见属性按顺序：

- 平台
- 类型
- UP 主（YouTube 为频道，抖音为作者）
- 时长
- 发布时间
- 字幕
- 视频链接
- 学科
- 笔记创建
- 笔记更新
- tags
- cssclasses（隐藏，不显示）

规则：

- 中文键名用于显示；代码通过固定映射读写。
- tags 只写学科 + 主题 + 控制标签 flashcards；类型/概念标签不再写进笔记属性。
- cssclasses 只放 seen-note，由 CSS 隐藏；没有 CSS 时也不影响内容。

### 3.2 正文结构

- 摘要 callout：!abstract 摘要
  - 概述：2～3 句背景、矛盾和讨论范围，不提前给最终结论
  - 核心问题：视频试图回答的问题，1～2 句
  - 核心结论：最终判断，1～2 句
- 学科链接行：学科：[[学习手册路径|学科 学习手册]]
- 01 速览
  - 关键数字表：时间、数字、含义（时间可空）
  - 章节（有原生章节或自动分段时）
  - 类型骨架（按内容类型）：教程=前置条件+操作步骤；课程=前置条件+课程脉络+练习；评测=对比表；访谈=人物观点表；纪录=事件时间线；观点/科普不单列骨架
- 02 核心知识点
  - H3 主题；每个主题第一条是一句结论，其余为解释和证据
  - B 站/YouTube 主题和要点带 t= 时间链接
- 03 类型补充
  - 观点：可质疑之处
  - 科普：常见误解
  - 其他类型没有则不出现
- 04 核心概念与术语
  - 两列表：概念/术语、解释
  - 别名放解释或单独列；不再使用正文 ^concept- 块引用时，概念索引改由 state 生成
- 05 相关笔记
  - 双链和理由；理由中概念/关键词去重
- 06 复习卡片
  - [!summary]- 展开 N 张卡片
  - 内部多行卡：问题行、空行、? 行、空行、答案行；每张卡之间空行
  - #flashcards 标签由配置决定是否添加
- 07 附录（默认展开 callout）
  - 原话摘录
  - 提到的资源
  - 观众讨论（仅真实弹幕/评论；无数据则省略）
  - 抓取统计：字幕字数、弹幕抓取/全站、评论抓取/全站
- 08 我的补充
  - 作为最后一节，放一行提示：记录疑问、联想或待查资料
  - 保留 MANUAL:START / MANUAL:END 手写保护区

## 四、内容类型矩阵

| contentType | 01 速览里的结构块 | 03 类型补充 | 备注 |
| --- | --- | --- | --- |
| tutorial 教程 | 前置条件 + 操作步骤 | 无 | 核心知识点写原理、原因、注意事项，不重复步骤 |
| course 课程 | 前置条件 + 课程脉络 + 练习 | 无 | 练习可折叠或短列表 |
| opinion 观点 | 关键数字（有才出） | 可质疑之处 | 不单独出论证结构表，核心知识点按论点组织 |
| science 科普 | 关键数字（有才出） | 常见误解 | 不单独出机制表，核心知识点按机制组织 |
| review 评测 | 关键数字 + 对比表 | 无 | 核心知识点写细节 |
| interview 访谈 | 关键数字 + 人物观点表 | 无 | 核心知识点写细节 |
| documentary 纪录 | 关键数字 + 事件时间线 | 无 | 核心知识点写细节 |
| other 其他 | 关键数字（有才出） | 无 | 仅核心知识点 |

补充规则：

- 没有关键数字、章节、类型骨架时，01 速览整节省略，后续编号自动前移。
- 没有 03 类型补充时整节省略。
- 没有相关笔记时 05 整节省略。
- 所有编号由 render 根据实际存在的 section 动态生成，不能写死。

## 五、平台矩阵

| 平台 | 属性差异 | 抓取统计 | 讨论区 |
| --- | --- | --- | --- |
| B 站 | UP 主；字幕；视频链接；时长；发布时间 | 字幕字数；弹幕抓取/全站；评论抓取/全站 | 有真实弹幕/评论时显示 |
| 抖音精选 | 作者；字幕；视频链接；时长；发布时间 | 字幕字数；评论/弹幕暂未抓取（可省略） | 无真实评论时省略 |
| YouTube | 频道；字幕；视频链接；时长；发布时间 | 字幕字数；章节数；评论未抓取 | 无弹幕/评论时省略 |

通用：

- 视频 ID、BV 号、page、cid 只进 seen-meta 和 state，不在可见属性里重复。
- 多 P B 站视频标题保留 P2 分 P 名，文件名和 state.page 同步。
- 时长、发布时间、字幕来源来自平台元数据；没有就留空，不编造。

## 六、边界与降级规则

1. 仅元数据（没有字幕/转写）
   - 摘要加 [!warning] 内容依据有限
   - 核心知识点 3～8 个，只基于标题和简介
   - 关键数字、核心概念、术语、原话、资源、类型模板全部省略
   - quality 固定 1
2. 没有关键数字 / 没有章节 / 没有相关笔记 / 没有评论
   - 对应整节省略，不输出空表头和“暂无”
3. 老笔记 format 4
   - 不自动改写；自检只告警，不报 error
   - 迁移脚本默认预演，--apply 才写并备份
4. 没有 CSS
   - 属性面板退回单列；标题无色带；callout 仍可折叠；内容不丢失
5. 没有安装 Spaced Repetition
   - flashcards 标签即使存在也只显示为普通标签；正文复习卡片 callout 仍可阅读
6. 标题清洗
   - 去掉平台/浏览器后缀
   - 去掉尾部 #hashtag
   - 去掉开头/结尾的栏目、促销、画质标记：游戏之外、社会观察、全网最全、保姆级、4K 等
   - 保留 P2、第 3 期等分集信息
   - 长标题按标点截到约 30～40 个汉字，完整原文存 originalTitle
   - 原始标题不改写，只做 displayTitle

## 七、数据模型与命名

### 7.1 frontmatter v5

可见字段：

- 平台: string
- 类型: string（中文，例如 观点）
- UP 主 / 作者 / 频道: string（按平台）
- 时长: string（mm:ss 或 hh:mm:ss）
- 发布时间: string（YYYY-MM-DD）
- 字幕: string（例如 B 站 AI 字幕）
- 视频链接: string
- 学科: string
- 笔记创建: YYYY-MM-DD
- 笔记更新: YYYY-MM-DD
- tags: string[]
- cssclasses: string[]（默认 [seen-note]）

### 7.2 seen-meta 隐藏块

只存机器需要、但不适合放在可见属性的字段：

- title（原始标题）
- displayTitle（清洗后的标题）
- source
- url
- author
- contentSource
- contentQuality
- contentType
- quality
- format: 5
- review
- bvid / videoId / page / cid
- concepts（名称 + 别名，用于概念索引）

原则：见属性已经有的值不在 seen-meta 重复；如果为了旧笔记兼容必须重复，代码只以一处为准。

### 7.3 state 与标签

- state.video.tags：完整四层标签，供标签索引、面板筛选用
- state.video.noteTags：写进笔记的显示标签（学科 + 主题 + flashcards）
- state.video.displayTitle / originalTitle：标题显示与原文
- state.video.concepts：概念数据，概念索引继续使用
- updated 时间：render 接收 updatedAt，不能用 createdAt 冒充

## 八、代码改造清单

### 8.1 core/lib/render.js

- renderVideoNote：v5 frontmatter、无 H1、摘要 callout、动态编号、类型矩阵、概念表、复习卡 callout、附录 callout、我的补充、抓取统计
- buildReviewCards：从单行 问题::答案 改为多行卡（问题 / ? / 答案）
- renderSubjectManual：去除学习路径与视频笔记重复列表；术语表读取 definition 而不是 brief；mindmap 改为主题分组或删除
- renderOverview：学科列表显示视频数
- renderFrontmatter：支持中文键、seen-meta、cssclasses

### 8.2 core/lib/note-content.js

- 保留 8 类 contentType 和模板上限
- 教程/课程/评测/访谈/纪录的速览骨架
- 观点/科普不再输出独立论证/机制表
- 新增关键数字 time 可选字段的规范化

### 8.3 core/lib/analyze.js

- 分类提示词：标题清洗规则（后缀、hashtag、栏目名、促销/画质词、长度）
- 总结提示词：
  - summary 2～3 句，不提前下最终结论
  - keyPoints 每个主题第一条为结论句
  - numbers 增加 time 可选
  - 术语与概念去重
  - 复习卡片可选：由程序从 question/answer/concepts 生成，不额外调用模型

### 8.4 core/lib/tags.js

- mergeTags 继续生成完整四层标签供 state 使用
- 新增 displayTags / noteTags：学科 + 主题 + flashcards
- buildTagIndex 继续使用 state 全量标签，不受笔记属性显示标签影响

### 8.5 core/lib/index.js

- displayTitle / originalTitle
- updatedAt / createdAt 分开
- noteTags 与 allTags
- cssclasses 和 flashcards 标签
- 传给 renderVideoNote 的字段调整
- 旧笔记重刷时保留路径与 review

### 8.6 core/lib/note-check.js

- NOTE_FORMAT 仍为 4，新增 NOTE_FORMAT_V5 = 5；v5 用 note.format >= 5 或 isV5 分支识别
- 新 SECTION_ORDER_V5：速览、核心知识点、可质疑之处/常见误解、核心概念与术语、相关笔记、复习卡片、附录、我的补充
- 支持中文属性、seen-meta、编号 H2 与 H3 子区块、表格概念、多行复习卡、callout 折叠
- 概念检查不再依赖 ^concept- 块引用；改为校验概念表与 state.concepts 一致
- 保留标签、学科、时间链接、抓取统计检查；flashcards/review 作为控制标签跳过
- 旧 format 4 只告警

### 8.7 core/lib/config.js / obsidian.js / paths.js

- sanitizeFilename 改 UTF-8 字节安全截断
- 标题空格处理
- cssclasses 写入与属性隐藏
- 文件名校验与多 P 处理

### 8.8 scripts 与测试

- core/test：format-v5 渲染、note-check、标题清洗、pangu、标签拆分、复习卡、callout
- scripts/self-check.mjs：format 5 检查
- scripts/retag-notes.mjs：只改显示标签或完整标签需明确
- 新增 scripts/migrate-note-format-v5.mjs：预演、备份、路径/双链/state 更新
- npm run check、cd core && node --test、npm run self-check

## 九、实施阶段

### Phase 0：确认（当前）
- 确认本方案的范围和默认决策
- 确认是否接受 CSS 片段作为可选增强
- 确认旧笔记迁移是否首轮执行

### Phase 1：数据与基础工具
- [x] spaceCjk
- [x] displayTitle / originalTitle（生成链路已接入，render v5 字段待接）
- [x] updatedAt / createdAt 分离
- [x] noteTags / allTags（状态保留全量，笔记只写学科 + 主题）
- [x] frontmatter v5 + seen-meta schema
- [x] state 字段（noteTags/originalTitle/displayTitle），config 待补
- [x] publishedAt 平台抓取（B 站 pubdate / YouTube upload_date / 抖音 createTime）

### Phase 2：渲染主模板
- [x] renderVideoNoteV5 已落地，旧 renderVideoNote 保留给 format 4
- [x] 摘要、速览、核心知识点、类型矩阵
- [x] 概念与术语表（无正文块引用）
- [x] 相关笔记
- [x] 复习卡片多行卡
- [x] 07 附录内的 callout（默认展开）
- [x] 我的补充
- [x] 动态编号

### Phase 3：Obsidian 显示
- [x] seen-note.css（已入库 docs/examples/seen-note.css，复制到 vault 后可选启用）
- [x] H2 色带/左边框、H3 左边线、标签灰色、属性两栏
- [ ] callout 配色统一
- [x] Reading/Live Preview 验证
- [x] Spaced Repetition 多行卡验证

### Phase 4：质量与兼容
- [x] note-check v5 解析与校验
- [x] render/note-check/title/tags/dates 测试（403 项，402 通过 / 1 跳过）
- [x] 样例 docs/examples/note-format-v5-sample.md
- [x] 真实 B 站笔记端到端（临时 vault，真实抓取 + 模型，5 张复习卡、无假时间、无重复概念、文件名去尾句号）
- [x] 真实抖音笔记端到端（临时 vault，真实抓取 + 本地转写，真实发布时间、短标题、6 个带时间的关键数字、4 张复习卡）
- [x] 真实 YouTube 笔记端到端（临时 vault，真实字幕 + 模型；完整转写和仅元数据两种情况都验证）
- [x] 旧 format 4 回归（旧 renderer 测试保留）

### Phase 5：迁移与文档
- [x] 迁移脚本 `scripts/migrate-note-format-v5.mjs`：默认预演，`--apply` 才写，写前备份
- [x] README、docs/contracts.md、docs/architecture.md、docs/acceptance.md、CLAUDE.md 更新
- [x] format 版本策略：新笔记写 format 5，旧笔记不自动改写；正式库经用户确认后一次性迁移

## 九点五、实施状态（2026-11-26）

- render.js 新增 renderVideoNoteV5，旧 renderVideoNote 不动，保证 format 4 回归。
- note-check.js 支持 v5 解析与校验：中文属性、seen-meta、编号标题、H3 子区块、概念表、callout。
- index.js 已切到 v5 渲染，传入 originalTitle/displayTitle/updatedAt/noteTags，并在重整理时解析 seen-meta 的 review。
- obsidian.js 的收录识别与 review 更新支持 seen-meta；self-check.mjs 用 noteTags 对比状态标签。
- 测试：cd core && node --test 407 项全部通过；npm run check 通过。
- 样例已改为 callout 版式，附录在「我的补充」之前，并通过 v5 校验。
- 2026-11-27 附录独立成 `07 附录` 并默认展开，我的补充顺延为 `08`：render.js、迁移脚本、`SECTION_ORDER_V5`、render/note-check 测试、示例和 22 篇正式笔记同步；22 篇原文备份在 `~/.seen/backups/appendix-heading-2026-11-27T03-36-18-524Z`。
- 平台发布时间已接入：B 站 `pubdate`、YouTube `upload_date`/`release_date`/`timestamp`、抖音 `createTime`，统一经 `dates.js` 归一为 `YYYY-MM-DD`；旧缓存没有该字段时保持为空。
- README、docs/contracts.md、docs/architecture.md、CLAUDE.md 已同步；docs/acceptance.md 已追加 v5 验收段。
- 真实 B 站端到端（`BV1cUsu6ZEYp`，临时 vault，未写用户库）通过：生成 5 张真问答卡、原话不再出现 `[00:00]`、概念表无 `3A`/`DEI指标` 重复行、文件名去掉结尾句号；结构检查 0 findings。
- 端到端暴露的问题已修：复习卡提示词要求 3~5 组问答；`normalizeReviewCards` 统一清洗并兼容旧 `问题::答案`；`normalizeQuotes` 丢弃 time=0；概念表按别名与包含关系去重；标题去掉结尾句读；`doubts` 要求针对论证而非观众评论。
- 真实抖音端到端（`modal_id=7704484155313284785`，临时 vault）通过：真实发布时间 2026-11-05、短标题「山河表里潼关路」、6 个带时间的关键数字、4 张真问答卡、结构检查 0 findings。
- 抖音暴露并修复：抓取标题带长简介、分类标题再覆盖，导致文件名变长；新增 `pickOriginalTitle` 优先真实输入标题，分类标题只兜底，且拦截「原题 + 大段补充」的覆盖。
- 真实 YouTube 端到端通过：完整字幕视频（TEDx，5:56）生成 12 个概念、0 findings；仅元数据视频只保留摘要、章节、延伸思考和我的补充。
- YouTube 暴露并修复：无字幕时模型仍从简介编出知识点与复习卡，v5 改为元数据版整节省略；`<Untitled Chapter 1>` 占位章节被过滤；没有抓取到评论时，讨论区标签从「YouTube 评论」改为「延伸思考」。
- 2026-11-26 正式库迁移完成：22 篇、13 篇改名、40 个文件引用更新，备份 `~/.seen/backups/v5-2026-11-26T16-23-02`；修复改名未移走旧文件、索引写到 vault 根、字幕存档 owner、链接空格顺序、self-check 不识别 v5 五个问题。
- 迁移后验证：`node --test` 407/407、`npm run check` 122 个文件、`npm run self-check` 22 篇 0 错误 0 警告。
- 已发布：v0.5.7、v0.5.8、v0.5.9。

## 十、验收标准

- 新生成笔记结构符合本方案，属性面板只显示约定字段。
- 正文只有文件名一个标题，不出现 H1。
- 摘要、核心知识点、概念表、复习卡、07 附录、08 我的补充顺序正确。
- 视频链接、UP 主、BV 号、字幕来源不在抓取统计重复。
- 复习卡片默认折叠；展开后问题、?、答案分行可读。
- Spaced Repetition 能识别 #flashcards 笔记，5 张卡都能复习。
- Live Preview 和阅读视图的折叠行为一致。
- note-check 对 format 5 无 error；format 4 不误报。
- node --test、npm run check、npm run self-check 通过。
- 迁移前旧笔记不被自动改写。

## 十一、迁移策略

1. 新笔记直接写 format 5。
2. 旧笔记不自动改写；本次经用户确认后已对正式库 22 篇执行迁移，原文件在备份目录。
3. 迁移脚本默认只预演，--apply 才写，写前备份到 ~/.seen/backups/。
4. 需要迁移的内容：
   - 格式化 frontmatter、属性、摘要、概念表、复习卡、附录
   - 标题清洗 / 文件名空格（可选）
   - state.notePath、双链、索引、概念页、手册同步
5. 迁移失败可回滚；不删除旧备份。

## 十二、风险

- Spaced Repetition 多行卡在 callout 中的解析依赖插件版本；当前本机测试 5 张卡正常，需保留回归样例。
- CSS 是可选增强；如果丢失，属性、标题层级仍要可读。
- 标题清洗和文件名变更会影响双链；必须独立迁移并充分备份。
- 标签模型拆分后，标签索引必须使用 state 全量标签，否则类型/概念分区会丢。
- 旧笔记不自动改写，避免一次性大范围破坏。
- 我的补充、关键数字时间列、概念块引用三个默认决策如与预期不符，会在 Phase 0 调整。

## 十三、默认决策（待用户确认）

1. 尾部 details 全部改成可折叠 callout，统一浅色样式。
2. 核心知识点：每个 H3 第一条固定为结论句，不强行合并主题；超过 10 个 H3 时合并相近主题。
3. 我的补充：放在 07 附录之后作为 08，最后一节；加一行提示。
4. 概念块引用：移除正文 ^concept-，概念索引使用 state.concepts。
5. flashcards 标签：默认加；可在配置中关闭。
6. CSS：作为可选增强，随应用安装/提供一键安装，模板本身不依赖。
7. 标题空格：正文、标题、文件名统一执行 spaceCjk；旧笔记迁移时改名。

## 十四、下一步

用户确认本方案后，按 Phase 1 → Phase 4 实施；先改代码和测试，不改正式笔记模板；最后用一篇真实笔记和现有 22 篇旧笔记做回归验证。
