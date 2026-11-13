# 视觉升级 v2 示意图提示词

使用内置 image_gen。浅色网页参考 `menubar/icon/squirrel/reference-v1.png`；深色网页以浅色网页图为编辑参考；菜单栏同时参考浅色网页图和松鼠图。示意图均包含虚构示例内容。

## 网页浅色

```text
Use case: ui-mockup. Design ONE gorgeous, original, premium, contemporary desktop workspace UI for a real Chinese macOS video-knowledge app "拾影 Seen". One full, large, unobstructed, front-facing desktop app window fills the landscape image, no other windows, with genuinely readable controls. This is not a mood board. The reference image is the user's approved squirrel brand. Use precisely that small rust-orange curled squirrel mark in the interface.

Make the interface feel extraordinarily polished, modern, simple and quietly lively. It should look like a carefully art-directed contemporary native Mac application with editorial design sensibility. Clear hierarchy, exceptional spacing, exquisite restrained typography and a memorable identity. NOT a Chinese enterprise admin dashboard, NOT a website landing page, not a bank app, not generic minimalist SaaS. The user requested substantially more aesthetic and modern visuals.

VISUAL SYSTEM:
- Warm porcelain-white #F8F8F4 content background with a very subtle warm-gray lower-priority surface.
- A single narrow deep-forest graphite left rail #1C2B25, lending contrast and character; its top has the exact orange squirrel logo and white Chinese word "拾影".
- Strong dark-ink typography in a highly refined crisp Chinese sans-serif. Compact labels, distinct type weights, generous line height, crisp Chinese legibility. No heavy serif type.
- Burnt orange #CB5221 used for the single primary action, active navigation mark and a few micro-details; pale sage for positive states.
- Fine subtle borders, carefully chosen corner radii, little or no shadow. Sophisticated graphic structure, asymmetry, one tonal dark status card, less empty boxes. Modern desktop UX. Restrained natural palette, clean functional interface.
- No gratuitous ornaments, blobs, huge blobs, photography, text over illustration, sparkles, gradients, fake charts, generic thick icons, or stock art.

COMPOSITION:
1. Left slim navigation rail: squirrel logo at top, a selected "工作台" navigation item, then "知识库", then "设置". Small accurate monochrome line icons. Bottom: restrained "本地运行" status. These are the ONLY items. 
2. Main top navigation header: small breadcrumb "拾影 / 工作台" on the left. On the right the real model status "模型已就绪" and monitoring status/control "轮询中".
3. Upper main: a medium-size headline in Chinese, "看过，留下" and a short human, useful subheading "让值得记住的内容，随时可以回看。". On the right side of that title area, a small understated visual motif inspired by a single orange seed, simple like a tiny dot.
4. An exceptionally crafted primary capture component directly below: a thin label "添加视频", a generously wide light-background input reading "粘贴 B站 / 抖音精选视频链接", and one vivid burnt-orange button "立即整理". Below in a very compact single line the real controls "轮询间隔 15 秒", "保存", "强制重生成", "诊断".
5. Editorial asymmetric content area: left ~65% is an elegant "最近总结" reading surface with a fictional title "如何把零散的信息整理成知识", small metadata "学习方法 · B站", a real-looking 2-line sample excerpt, two short bullet points, and the link "在 Obsidian 中打开 ↗". Use excellent spacing and very little card chrome. Right ~35% has a stylish dark forest-green compact real-time status surface titled "实时观察", a small green positive dot and "正在观察", a current browser row and two time-stamped actual-kind event rows. Keep text clear and readable. A bright squirrel-orange tiny progress highlight can add a touch of personality but DO NOT create a fake progress meter or imaginary playback time.
6. Beneath that: "知识库" section with THREE beautifully typeset recent note rows. Each row has a short fictional Chinese title, small subject/category, a one-line excerpt and a discreet right chevron. All note content is fictional. Rows are separated by fine lines. Show a small understated count. No images.
7. A quiet unobtrusive footer.

Make this an exceptionally attractive, practical, implementable software interface. The design should look clearly more premium and different from a basic two-card admin page, but still light, simple and functional. Chinese UI text must be accurately rendered where quoted, with excellent contrast. No other software names apart from "Seen", "B站" and "Obsidian". No explanatory labels outside the window, no watermark.
```

## 网页深色

```text
Use case: precise-object-edit.
Input is an approved-composition LIGHT visual concept for the Chinese personal knowledge desktop app "拾影 Seen". Produce the matching refined DARK MODE view of precisely the same interface.

Change ONLY the palette to make a coherent, exquisitely readable dark mode. Preserve the exact interface geometry, all layout, navigation structure, squirrel logo, sizes, positions, typography, icons, buttons, text and relative content. Preserve all visible Chinese labels verbatim and keep it one full, front-facing desktop application window.

Colors: main workspace background a very dark, warm forest charcoal #151C19. Sidebar slightly darker #101713 with its original small orange squirrel identity, clear active navigation in muted rust-orange. Text soft ivory #F4F1E9; secondary text clear gray-sage. Surfaces deep charcoal green #202C26 with fine subtle separators. The right '实时观察' card should remain distinguishable from the main workspace, with comfortably readable text and good visual contrast. Primary button '立即整理' remains beautiful muted persimmon orange, crisp high-contrast text. Status green understated and legible. All knowledge rows, inputs, link states, headings and buttons have high contrast. Do not use any pure white bright panels or neon elements.

A polished, calm, modern Mac productivity application at night. No gradients, no texture, no 3D, no new decorations, no layout changes, no new characters, no fake data, no text modifications, no watermark.
```

提示词中的 `approved-composition` 是要求深色图沿用浅色图的构图，并不表示用户已确认最终设计。

## 菜单栏浅色 / 深色

```text
Use case: ui-mockup.
Design a polished pair of compact macOS MENU-BAR POPOVERS for the same app and brand in the supplied desktop-interface reference. Show two individual menu popovers side by side, light mode at left and dark mode at right, with exactly matching composition. This is a high-fidelity product UI design review board, front-on, no perspective, on a clean neutral background. Each popover should look approximately 336pt wide and compact, elegant, realistically usable and visually cohesive with the reference workspace. No other app windows and no decorative mockup elements.

Reference 1: match its elevated modern charcoal-forest + warm ivory + restrained squirrel-orange design language, readable modern Chinese sans-serif typography and finely tuned spacing. Reference 2: use the same exact small orange curled-tail squirrel logo; no different animals or cartoon mascot.
Left popover: warm near-white #F8F8F4 background with dark-ink text and hairline dividers.
Right popover: deep warm forest charcoal #17221C background with soft warm white text and subtle lighter surfaces/dividers.
Both have rounded macOS panel corners, a very subtle shadow, slim top notch.

Within each actual popover, include only existing app controls:
- header: small squirrel icon and title "拾影", subtle status pill "轮询中".
- one compact recent-video section headed "最近总结", with fictional title "如何把零散的信息整理成知识", understated subject "学习方法 · B站", and small last processed time.
- clear primary but not overly bulky button "暂停轮询", burnt-orange fill with legible high-contrast text.
- tasteful compact action grid with labels "网页面板", "笔记目录", "本周回顾", "运行诊断", "设置". Tiny refined line icons; all action labels shown correctly.
- unobtrusive bottom row "登录时自动启动" and switch, and a small "退出" action.
- Use different visual weights rather than drawing a separate heavy box around every button. Nice spacing and legible labels.

The two themes must match the reference desktop screenshot in restrained palette, character and shape. Keep the information simple and useful, no fake progress, no invented controls, no charts, no decorative seed graphics, no gradients, no stock images, no external title or legend outside the popovers, no watermark. Text in Chinese must be accurate.
```
