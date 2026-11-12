import AppKit
import Foundation

// 生成菜单栏模板图标：SF Symbols 渲染为 18pt @1x/@2x PNG。
// 用法：cd menubar && swift scripts/make-status-symbol.swift [symbolName]

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let symbolName = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "book.pages"
let outDir = "Resources"

func render(points: CGFloat, scale: CGFloat, path: String) {
    let px = Int(points * scale)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
    rep.size = NSSize(width: points, height: points)
    guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return }

    guard let base = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil),
          let image = base.withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: points * 0.82, weight: .regular)) else {
        print("找不到符号：", symbolName)
        exit(1)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx
    NSColor.black.set()
    let size = image.size
    let factor = min(points / max(size.width, 1), points / max(size.height, 1))
    let w = size.width * factor
    let h = size.height * factor
    image.isTemplate = true
    image.draw(in: NSRect(x: (points - w) / 2, y: (points - h) / 2, width: w, height: h),
               from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()

    if let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: URL(fileURLWithPath: path))
        print("已生成", path)
    }
}

try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
render(points: 18, scale: 1, path: outDir + "/StatusIcon@1x.png")
render(points: 18, scale: 2, path: outDir + "/StatusIcon@2x.png")
