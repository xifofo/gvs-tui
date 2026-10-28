# Desktop v0.1.95

配套 TUI **v0.2.89** / 网关 **v3.9.120**（最低 v3.9.119）。修 **画质表全标「软字幕」**。

## 问题

网关 `formats[]` 每行都带 `caption_probe`（这行用什么 persona 探的），探测默认 `soft`，
所以几乎每行 `caption_probe=soft`。旧逻辑拿不到已证实的 `caption` 就回退 probe，
导致整张画质表全标「软字幕」—— 优酷这类只有内嵌硬字幕的片源也一样。

## 改动

- `src/lib/quality.ts`：`qualityCaptionText` 只认 `caption`；仅当目录里软/硬两档并存
  （`captionProbeMixed`）时才用 probe 区分；`qualitiesFromTencentFormats` 统计 probe 集合后置位；
- `src/types.ts`：`Quality.captionProbeMixed`；
- `Quality.vue`：`hardTencentCaption` 不再拿 `captionProbe` 判断 ——
  `caption==='hard'`，或「没有任何可下载软字幕轨且未证实 soft」时按硬字幕处理；
  字幕勾选区仍只看 `subtitles[]` 里真实可下载的轨。

## 验证

`bunx tsc --noEmit` 无错误；`bun test src/lib/quality.test.ts src/lib/tencent-quality-selection.test.ts
src/lib/ui-layout.test.ts` 66 pass / 0 fail；安装包由 `desktop-v0.1.95` 标签触发构建。

## 回滚

回退 `desktop-v0.1.94`。
