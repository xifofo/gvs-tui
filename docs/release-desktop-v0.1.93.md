# Desktop v0.1.93

配套 TUI **v0.2.88** / 网关 **v3.9.119**。桌面端与 TUI 共用下载库（`app/src/main/core.ts`
直接用 `@tui/quality.ts`、`@tui/jobs.ts`），所以国区同步（腾讯软字幕、优酷帧率档）与
main 上此前的 PlutoFish / 上传链路改动在这一版一起进安装包。

## 变更（共用库，桌面端同步生效）

### 优酷：帧享两条帧率阶梯

网关 `tier=multi` 默认 `fps=all`，除 5 个 60fps 档还会追加 4 个 25 帧母版档
（`frame_xiang_dv25 / imax25 / hdr10_25 / sdr25`）。UPS 的 `max_fps` 是硬上限，
`profile=full/hdr10/sdr` 全声明 60/120，只回 `*_hfr_*` —— 不 pin 帧率档就会
「选了 24 帧那一行、下载却拉成 60 帧」，随后按 `stream_type` 匹配找不到流。

- `src/lib/youku-play-input.ts`：按选中 `stream_type` 反推
  `dovi=dv25|dv60|hdr10_25|hdr10_60|sdr25|sdr60|imax25|imax60`（判据：有无 `_hfr_`）；
  桌面端下载走 `@tui/jobs.ts` 的同一条 `playYouku`，自动带上；
- `src/lib/quality.ts`：画质探测显式 `fps: 'all'`；同分辨率同 HDR 偏好的撞名档位补
  「· 60帧 / · 24帧」。

### 腾讯软字幕：清单带 URL，下载走 HLS 拼接

网关 `subtitles[]` 现在带 `url` / `urls[]`（HLS 封装的 WebVTT）。桌面端目前只把字幕轨
当作任务属性，不落字幕文件；清单解析修复后「有没有软字幕轨」的判定恢复正确。

- 新增 `src/lib/vtt-hls.ts`（`parseHlsSubtitlePlaylist` / `stitchVttParts` / `vttToSrt` /
  `fetchHlsVtt`，与网关 `tencent/subtitle.go` 同口径）；
- `src/lib/online-subtitles.ts`：`OnlineSubtitle` 增 `playlist` / `urls`，playlist 字幕
  先拼 VTT 再落盘。

### 桌面端（main 上此前未发版）

- 媒体成品补检与规格复核（上传前重试补检已有成品媒体规格）；
- 主分支源码提交后自动构建安装包；安装包 Release 仍由 `desktop-v*` 标签发布；
- PlutoFish 短暂断线保留页面并自动重连、自动上传模式允许手动搜索 TMDB。

## 验证

- `bunx tsc --noEmit`（仓库根）无错误；
- `bun test src/lib`：1067 pass / 38 skip / 4 fail —— 4 个 fail 全是 `iqcn-local` 的本地
  helper 用例（需先 `bun run tools:iqcn` 构建原生 helper），与本次改动无关；
- `app` 侧 typecheck 与打包由桌面端 Release 工作流完成（标签与 `app/package.json` 版本必须一致）。

## 兼容性

- 网关 < v3.9.119：`fps` / `dovi` 被忽略，优酷仍只列 60fps 档；腾讯字幕行没有 url，照旧不列；
- 网关 ≥ v3.9.119：两条帧率阶梯都能选、能下，腾讯字幕轨判定正确。

## 回滚

回退 `desktop-v0.1.92`。
