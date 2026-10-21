# Desktop v0.1.76

与 TUI v0.2.72 同一份 Apple TV 下载修复（共用 `src/lib`）。

## 变更

- 音轨下拉：Apple TV 一片 19–20 条配音，默认选默认音轨；下载时按序号传给网关裁剪 master。
- 字幕：默认只勾 DEFAULT 那条；想全要可在字幕列表里自己勾。
- 下载进度：多流时不再被音频顶到 99% 卡住。
- 长片校验：抽 3 段解码替代整片解码，收尾明显变快。

## 配套

网关 v3.9.98。

## 验证

- 与 TUI v0.2.72 同源改动，渲染层无需调整；`bun test src/lib/appletvplus-download.test.ts` 8 通过。
