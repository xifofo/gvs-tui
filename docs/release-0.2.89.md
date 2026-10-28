# TUI v0.2.89

配套网关 **v3.9.120**（最低 v3.9.119）。修 **画质表全标「软字幕」**。

## 问题

网关 `formats[]` 每行都带 `caption_probe`（表示这行是用哪种 persona 探的），探测默认就是
`soft`，所以几乎每行都是 `caption_probe=soft`。旧逻辑在拿不到已证实的 `caption` 时回退到
probe，于是整张画质表全标「软字幕」—— 优酷这种只有内嵌硬字幕的片源也一样。

`caption` 才是网关按「实际下发的 rendition + sfl 字幕证据」写出的真值。

## 改动

- `qualityCaptionText(caption, captionProbe, probeMixed)`：只认 `caption`；
  仅当同一目录里同时存在软/硬两种探测档（`probeMixed`）时才用 probe 区分；
- `qualitiesFromTencentFormats`：统计 probe 集合，>1 时给每行打 `captionProbeMixed`；
- `Quality` 类型补 `captionProbeMixed`；`qualityChoiceLabel` 传三参；
- 测试：未证实 probe 的用例改为断言不显示（`''` / `'FHD'`），软+硬并存用例仍要求区分。

## 行为对照

| 场景 | 之前 | 现在 |
|---|---|---|
| 只有 soft 探测档（默认） | 全部标「软字幕」 | 不显示字幕列 |
| 软 + 硬两档并存 | 分别显示 | 不变 |
| 网关证实 `caption=soft`（有 sfl 真轨） | 「软字幕」 | 「软字幕」 |
| 优酷硬字幕（`subtitle_lang=default`） | 误标软字幕 | 不显示 |

## 验证

`bunx tsc --noEmit` 无错误；`bun test src/lib/quality.test.ts src/lib/tencent-quality-selection.test.ts
src/lib/ui-layout.test.ts` 66 pass / 0 fail。

## 回滚

回退 `v0.2.88`。
