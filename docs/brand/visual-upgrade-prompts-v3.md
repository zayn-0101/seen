# 视觉升级：英文名修订提示词

使用内置 image_gen；分别以 v2 浅色网页、深色网页和菜单栏示意图为编辑目标。此轮只更新设计预览，并未实施到应用。

## 共同提示词

```text
Use case: precise-object-edit.
Edit the provided visual concept screenshot for the Chinese personal knowledge app "拾影 Seen". The user wants the English name Seen included clearly in the brand lockup.

Change ONLY the app's brand text at its top-left identity area: next to the existing squirrel logo, keep the Chinese name exactly "拾影" and add the English name exactly "Seen" in Latin letters with uppercase S, lowercase e-e-n. Set "Seen" beneath the Chinese name in a tasteful, smaller, modern sans-serif font, left-aligned with the Chinese name, with adequate spacing and contrast. Make it easy to read while keeping the hierarchy restrained. The name should be "拾影" with a separate smaller "Seen" on the next line, not translated into different words. There must be exactly one "Seen" at each brand header. Do not change the squirrel icon.

Everything else is an exact invariant: preserve composition, all Chinese UI labels, controls, note titles, sidebar, status indicators, line breaks, colors, spacings, background, window dimensions and all other elements. Do not add icons, decorative shapes, shadows, watermarks, or new text outside the brand lockup. This is the same design with only the missing English name added.
```

## 每张图的补充要求

- 浅色网页：`Apply this to the one brand lockup at the top of the dark green left navigation rail. Keep the pre-existing footer intact.`
- 深色网页：`Apply this to the one brand lockup at the top of the dark left navigation rail. Render the smaller Seen in muted light gray. Keep the pre-existing footer intact.`
- 菜单栏：`The reference has TWO side-by-side macOS popovers. Add the English name Seen beneath 拾影 in the brand lockup at the top of EACH of the two popovers. Preserve both popovers' exact structure and alignment, keep all controls visible, and use dark muted gray text in the light theme, light gray in the dark theme.`
