#!/usr/bin/env node
/** 从选定的松鼠 SVG 母版导出各平台资源；不删除旧文件，不添加运行时依赖。 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = join(root, 'menubar/icon/squirrel')
const resources = join(root, 'menubar/Resources')
const web = join(root, 'web/icons')
const brand = join(root, 'docs/brand')
const pack = join(brand, 'squirrel-icons-v1')
const appSizes = [16, 32, 64, 128, 256, 512, 1024]
const logoSizes = [32, 64, 128, 256, 512, 1024]
const statusSizes = [16, 18, 20, 24, 32, 36, 48, 54, 64]

for (const tool of ['rsvg-convert', 'magick', 'iconutil', 'ditto']) {
  execFileSync('/usr/bin/which', [tool], { stdio: 'pipe' })
}
for (const dir of ['svg', 'png/app-light', 'png/app-dark', 'png/logo', 'template/black', 'template/white', 'macos/Seen.iconset', 'web']) {
  mkdirSync(join(pack, dir), { recursive: true })
}
mkdirSync(resources, { recursive: true })
mkdirSync(web, { recursive: true })

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

function render(svg, size, output) {
  mkdirSync(dirname(output), { recursive: true })
  execFileSync('rsvg-convert', ['--width', String(size), '--height', String(size), svg, '--output', output], { stdio: 'pipe' })
}

const svgFiles = ['squirrel.svg', 'squirrel-template.svg', 'squirrel-white.svg', 'app-light.svg', 'app-dark.svg', 'app-square.svg', 'app-maskable.svg', 'favicon.svg']
for (const name of svgFiles) copy(join(source, name), join(pack, 'svg', name))
for (const theme of ['light', 'dark']) {
  for (const size of appSizes) render(join(source, `app-${theme}.svg`), size, join(pack, `png/app-${theme}/app-${size}.png`))
}
for (const size of logoSizes) render(join(source, 'squirrel.svg'), size, join(pack, `png/logo/squirrel-${size}.png`))
for (const size of statusSizes) {
  render(join(source, 'squirrel-template.svg'), size, join(pack, `template/black/status-${size}.png`))
  render(join(source, 'squirrel-white.svg'), size, join(pack, `template/white/status-${size}.png`))
}

// ICNS 的十个标准表示，包含 512pt @2x 对应的 1024px 图像。
const iconset = join(pack, 'macos/Seen.iconset')
for (const points of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    copy(join(pack, `png/app-light/app-${points * scale}.png`), join(iconset, `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`))
  }
}
execFileSync('iconutil', ['--convert', 'icns', iconset, '--output', join(pack, 'macos/Seen.icns')], { stdio: 'pipe' })
copy(join(pack, 'macos/Seen.icns'), join(resources, 'AppIcon.icns'))

// 深色版本为可选交付；Finder 当前仍使用 Info.plist 指定的 AppIcon.icns。
const darkIconset = join(pack, 'macos/Seen-Dark.iconset')
mkdirSync(darkIconset, { recursive: true })
for (const points of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    copy(join(pack, `png/app-dark/app-${points * scale}.png`), join(darkIconset, `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`))
  }
}
execFileSync('iconutil', ['--convert', 'icns', darkIconset, '--output', join(pack, 'macos/Seen-Dark.icns')], { stdio: 'pipe' })

copy(join(pack, 'template/black/status-18.png'), join(resources, 'StatusIcon@1x.png'))
copy(join(pack, 'template/black/status-36.png'), join(resources, 'StatusIcon@2x.png'))
render(join(source, 'squirrel.svg'), 32, join(resources, 'BrandIcon.png'))
render(join(source, 'squirrel.svg'), 64, join(resources, 'BrandIcon@2x.png'))

for (const size of [16, 32, 48, 64]) render(join(source, 'favicon.svg'), size, join(web, `favicon-${size}.png`))
execFileSync('magick', [[16, 32, 48, 64].map(size => join(web, `favicon-${size}.png`)).flat(), join(web, 'favicon.ico')].flat(), { stdio: 'pipe' })
render(join(source, 'app-square.svg'), 180, join(web, 'apple-touch-icon.png'))
render(join(source, 'app-square.svg'), 192, join(web, 'icon-192.png'))
render(join(source, 'app-square.svg'), 512, join(web, 'icon-512.png'))
render(join(source, 'app-maskable.svg'), 512, join(web, 'icon-maskable-512.png'))
copy(join(source, 'squirrel.svg'), join(web, 'squirrel.svg'))
copy(join(source, 'favicon.svg'), join(root, 'web/favicon.svg'))
for (const name of ['favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'favicon-64.png', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'squirrel.svg']) {
  copy(join(web, name), join(pack, 'web', name))
}
copy(join(source, 'favicon.svg'), join(pack, 'web/favicon.svg'))
if (existsSync(join(root, 'web/site.webmanifest'))) copy(join(root, 'web/site.webmanifest'), join(pack, 'web/site.webmanifest'))

const readSvg = name => readFileSync(join(source, name), 'utf8').replace(/^<svg[^>]*>\s*/, '').replace(/\s*<\/svg>\s*$/, '')
const image = (name, x, y, size) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 ${name.startsWith('app-') ? 1024 : 512} ${name.startsWith('app-') ? 1024 : 512}">${readSvg(name)}</svg>`
const silhouette = readSvg('squirrel-template.svg')
const single = (x, y, size, white = false) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 512 512">${white ? silhouette.replaceAll('#000000', '#FFFFFF') : silhouette}</svg>`
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1140" viewBox="0 0 1600 1140">
<rect width="1600" height="1140" fill="#F6F3ED"/>
<g font-family="PingFang SC, sans-serif" fill="#302C25">
<text x="88" y="88" font-size="36" font-weight="600">拾影 · 松鼠图标</text>
<text x="88" y="124" font-size="17" fill="#787367">把看过的，留在身边。</text>
<rect x="88" y="166" width="440" height="390" rx="24" fill="#FFFDF8"/>
<rect x="580" y="166" width="440" height="390" rx="24" fill="#FFFDF8"/>
<rect x="1072" y="166" width="440" height="390" rx="24" fill="#33382F"/>
${image('squirrel.svg', 182, 185, 252)}
${image('app-light.svg', 662, 185, 276)}
${image('app-dark.svg', 1154, 185, 276)}
<text x="308" y="495" text-anchor="middle" font-size="21">透明品牌标识</text>
<text x="800" y="495" text-anchor="middle" font-size="21">浅色应用图标</text>
<text x="1292" y="495" text-anchor="middle" font-size="21" fill="#F8F1E5">深色应用图标</text>
<text x="308" y="526" text-anchor="middle" font-size="14" fill="#817A6C">SVG / PNG</text>
<text x="800" y="526" text-anchor="middle" font-size="14" fill="#817A6C">16 — 1024 px / ICNS</text>
<text x="1292" y="526" text-anchor="middle" font-size="14" fill="#C4BEAE">16 — 1024 px / ICNS</text>
<text x="88" y="628" font-size="23" font-weight="600">菜单栏 · 清晰的卷尾轮廓</text>
<rect x="88" y="658" width="686" height="104" rx="18" fill="#E7E5DF"/>
<rect x="826" y="658" width="686" height="104" rx="18" fill="#252A24"/>
${single(122, 690, 36)}${single(212, 698, 18)}${single(280, 696, 24)}${single(354, 690, 36)}${single(445, 681, 54)}
${single(860, 690, 36, true)}${single(950, 698, 18, true)}${single(1018, 696, 24, true)}${single(1092, 690, 36, true)}${single(1183, 681, 54, true)}
<text x="88" y="802" font-size="15" fill="#787367">透明底黑 / 白轮廓 · 18pt @1x / @2x / @3x · macOS 模板自动适配外观</text>
<text x="88" y="872" font-size="23" font-weight="600">浏览器与主屏幕</text>
<rect x="88" y="900" width="1424" height="166" rx="22" fill="#FFFDF8"/>
${image('favicon.svg', 120, 944, 64)}
${image('favicon.svg', 225, 960, 32)}
${image('favicon.svg', 298, 968, 16)}
<text x="350" y="981" font-size="18">favicon · SVG / ICO / PNG</text>
<svg x="874" y="930" width="108" height="108" viewBox="0 0 512 512"><rect width="512" height="512" rx="108" fill="#F8F1E5"/>${readSvg('squirrel.svg')}</svg>
<text x="1014" y="975" font-size="18">180 / 192 / 512 px</text>
<text x="1014" y="1006" font-size="15" fill="#787367">Apple Touch / Web Manifest / Maskable</text>
</g></svg>`
const previewSvg = join(pack, 'squirrel-icons-preview.svg')
writeFileSync(previewSvg, preview)
execFileSync('rsvg-convert', [previewSvg, '--output', join(brand, 'squirrel-icons-preview-v1.png')], { stdio: 'pipe' })
copy(join(brand, 'squirrel-icons-preview-v1.png'), join(pack, 'squirrel-icons-preview.png'))

writeFileSync(join(pack, 'README.md'), `# 拾影 Seen · 松鼠图标 v1\n\n选定造型：卷尾、抬头、抱着一粒种子。\n\n## 使用\n\n- macos/Seen.icns：当前默认应用图标；Seen-Dark.icns 为可选深色版，不会自动切换 Finder 图标。两个 iconset 各包含十个标准 macOS 表示。\n- svg/：8 份可编辑的纯路径矢量母版，可任意放大。\n- png/app-light、png/app-dark：16、32、64、128、256、512、1024px 应用图标。\n- png/logo：32、64、128、256、512、1024px 透明彩色标识。\n- template/black、template/white：16、18、20、24、32、36、48、54、64px 透明单色轮廓。macOS 使用黑色模板并设置 isTemplate=true，由系统着色。\n- web/：SVG favicon、含 16/32/48/64px 的 ICO、PNG favicon、180px Apple Touch、192/512px 主屏幕图标、512px maskable 图标和 Web Manifest。\n- squirrel-icons-preview.png：整套资源预览。\n\n主屏幕与 maskable 图标背景不透明；macOS 图标保留透明外边距；模板图标只有透明度与单色像素。网页静态资源部署在根路径时，可直接使用 web/site.webmanifest；若部署在子路径下须调整图标路径。\n\n## 母版与生成\n\nimage_gen 独立绘制定稿后，按原轮廓转换为纯路径 SVG，清理边缘噪点并统一四个平涂色块。正式尺寸从同一份 SVG 导出。生成参考与提示词位于项目 menubar/icon/squirrel/reference-v1.png 和 docs/brand/prompts-v1.json。\n\n在项目根目录运行 node scripts/export-icons.mjs 可重新导出。需要本机已有的 rsvg-convert、ImageMagick、iconutil、ditto。不会删除旧文件。\n`)
execFileSync('ditto', ['-c', '-k', '--keepParent', pack, join(brand, 'squirrel-icons-v1.zip')], { stdio: 'pipe' })
console.log('已导出松鼠系列：应用图标、ICNS、菜单栏模板、SVG、网页图标、预览与 ZIP。')
console.log('交付目录：' + pack)
