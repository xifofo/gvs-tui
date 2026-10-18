#!/usr/bin/env swift
// Run on macOS: swift app/scripts/gen-mac-icon.swift
// Regenerates the committed PNG/ICNS from the same SVG used by the app.
import AppKit

let appRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let source = appRoot.appendingPathComponent("src/renderer/src/assets/gvs-mark.svg")
let build = appRoot.appendingPathComponent("build", isDirectory: true)
let canvas: CGFloat = 1024
let tile: CGFloat = 824
let inset = (canvas - tile) / 2

// Legacy macOS artwork includes the rounded tile and transparent safe area.
// Render the SVG rather than reusing icon.png, whose alpha mask is malformed.
let document = try XMLDocument(contentsOf: source)
guard let root = document.rootElement(),
      let background = root.children?.compactMap({ $0 as? XMLElement }).first(where: { $0.localName == "rect" }),
      let viewBox = root.attribute(forName: "viewBox")?.stringValue?.split(separator: " "),
      viewBox.count == 4, let sourceWidth = Double(viewBox[2]), sourceWidth > 0,
      Double(viewBox[3]) == sourceWidth, background.attribute(forName: "rx") != nil else {
    fatalError("App mark must have a square viewBox and a background rect")
}
// The tile corner radius follows the macOS grid; leave the glyph unchanged.
background.attribute(forName: "rx")?.stringValue = String(185 * sourceWidth / Double(tile))
guard let artwork = NSImage(data: document.xmlData) else {
    fatalError("Cannot render app mark SVG")
}

func png(size: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Cannot allocate icon bitmap")
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    let scale = CGFloat(size) / canvas
    artwork.draw(in: NSRect(x: inset * scale, y: inset * scale, width: tile * scale, height: tile * scale),
                 from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Cannot encode icon PNG")
    }
    return data
}

let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
let iconset = temporary.appendingPathComponent("GVS.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temporary) }
for size in [16, 32, 128, 256, 512] {
    try png(size: size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try png(size: size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}

let icns = temporary.appendingPathComponent("icon-mac.icns")
let converter = Process()
converter.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
converter.arguments = ["--convert", "icns", "--output", icns.path, iconset.path]
try converter.run()
converter.waitUntilExit()
guard converter.terminationStatus == 0 else { fatalError("iconutil failed") }
try png(size: 1024).write(to: build.appendingPathComponent("icon-mac.png"), options: .atomic)
try Data(contentsOf: icns).write(to: build.appendingPathComponent("icon-mac.icns"), options: .atomic)
print("Generated build/icon-mac.png and build/icon-mac.icns")
