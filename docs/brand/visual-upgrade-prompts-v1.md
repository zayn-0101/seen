# 视觉升级示意图提示词

使用内置 image_gen。浅色图的参考为 `menubar/icon/squirrel/reference-v1.png`；深色图以本轮浅色示意图为编辑参考。示意图内容为虚构示例。

## 浅色

```text
Use case: ui-mockup.
Create a polished, high-fidelity VISUAL DESIGN CONCEPT (not code) for the existing macOS desktop and local web app "拾影 Seen": a quiet personal video-knowledge companion that detects useful videos, summarizes them into notes, and helps the owner browse and revisit what they learned. The user wants a simple, lively, thoughtfully designed, usable interface consistent with the selected squirrel brand.

Reference image: the user's approved brand mascot. Use it as a SMALL app icon next to the word 拾影 in both interfaces, retaining its exact recognizable rust-orange curled-tail squirrel silhouette. Do not draw huge mascots or new characters.

One clean landscape design board, approximately 16:10, opaque warm ivory studio background. Present two realistic complete flat-on app UI surfaces side by side, no perspective:
- LEFT, approximately 72% width: a large desktop web dashboard in a softly rounded Mac window, with a small native title bar. 
- RIGHT, approximately 24% width: one narrow macOS menu-bar popover in the same visual language, shown separately, not overlapping or covering the dashboard.
Together they demonstrate one cohesive, implementable product design system.

Art direction: a quiet, modern reading desk. Architectural editorial hierarchy, restrained warmth, exceptionally refined alignment, great breathing room, unmistakable real app usability. Canvas warm soft ivory #F6F2E9, panels milky off-white, intelligent ink #26342E, muted sage, one small rust-orange #C84B1C primary accent drawn from the mascot. Finely tuned hairline borders and very subtle shadows. Gentle tactile warmth without textures, photography, leaves, sketched decoration, excessive beige, cartoonish playfulness, or a childish learning-app feel. This should feel like a premium native productivity tool for an adult. Crisp legible simplified Chinese UI typography; use a refined humanist Chinese sans-serif, with just a touch of editorial character in the large heading. A very sophisticated actual product, not a dribbble marketing page. Do not use a sidebar, not a finance dashboard, not big meaningless statistics.

Dashboard UI composition, consistent with existing functions:
1. Header with the small squirrel icon, exact title "拾影", smaller English "Seen", a compact quiet status chip "模型已就绪" and a clear monitoring control "轮询中" on the far right.
2. Well-spaced page title, exact text "看过，留下"; a short secondary line about saving what you learned. 
3. A prominent tasteful single-row functional video link input reading "粘贴 B站 / 抖音精选视频链接" and a rust-orange filled primary button "立即整理". Beneath, in smaller secondary styling, actual controls "轮询间隔 15 秒" and "诊断".
4. Below, two unequal columns with a clear reading hierarchy. LEFT wider: a generously but compactly sized real content panel titled "最近总结", showing a fictional note about learning "如何把零散的信息整理成知识", short readable 2-line fictional summary, 2 small bullet points, and a subtle "在 Obsidian 中打开 ↗" link. RIGHT narrower: a compact "实时观察" status panel showing "正在观察", one current browser/video row, and 2 short activity rows. Organically distribute height, avoid oversized empty panels.
5. Lower section labeled "知识库" with 3 compact recent note rows in a clean editorial list, displaying short fictitious titles, small category text and small arrows, no thumbnails or stock photos.
6. Bottom tiny understated local-data and Obsidian note.

Menu popover UI: same squirrel mark, title "拾影", small status pill "轮询中"; then a compact recent-video summary, a full-width rust-orange pause control, a 2-column group of small neat actions for "网页面板", "笔记目录", "本周回顾", "设置", and one understated auto-start switch at the bottom. Mac native compact sizes and realistic spacing.

Write Chinese text correctly and legibly, particularly the exact quoted labels. Include no fake navigation or charts. No artist signature, no watermark, no annotation callouts or arrows outside the UI. This is a visual concept for approval, not an interactive implementation.
```

## 深色

```text
Use case: precise-object-edit.
Input image is a finished light-mode CONCEPT for a Chinese personal knowledge desktop app and adjacent small macOS menu-bar popover. Create its DARK-MODE companion for visual review.

Change ONLY its overall UI color scheme from light to dark. Keep the exact two side-by-side interfaces, left/right proportions, sizes, grid, placement, whitespace, hierarchy, component shapes, squirrel logo, icon shapes, text content and text positions. Preserve all visible Chinese labels verbatim, such as "拾影", "看过，留下", "最近总结", "实时观察", "知识库", "暂停轮询", "网页面板", "笔记目录", "本周回顾", "设置". This is the same product at night, not a redesign.

Color: use sophisticated deep charcoal with a very subtle green undertone for the canvas (#171D1A), slightly lighter charcoal-olive (#222A25) for interface panels, soft muted warm ivory (#F0EDE4) for prominent text, sage gray for secondary text and very fine separators. Main action button in warm muted burnt orange (#D86029), legible light text; a restrained soft green status chip. Preserve the original rust-orange squirrel logo with a tiny brighter accent as needed. Ensure every note row, input, control, chip and separator remains comfortably distinguishable and all text has high contrast, including the dark menu popover.

Style: calm, refined modern productivity software, warm dark surfaces, native macOS feel, no bright white panels, no neon, no additional graphics, no camera perspective, no decoration, no watermark. Exact layout and content preserved; only dark-mode color values and contrast change.
```
