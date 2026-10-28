# 国区同步：腾讯软字幕可下载 + 优酷帧率档（2026-10-28，配套网关 v3.9.119）

从上游 `my-name-is-alan/gvs-tui` v0.2.86 同步进来，只涉及国区两家：
腾讯（软字幕）与优酷（帧享帧率档）。海外平台（CR / Apple TV+ 等）零改动。

## 一、腾讯软字幕：清单带 URL，下载要拼 HLS

网关 v3.9.119 起 `play` 的 `subtitles[]` 带 `url` / `urls[]`（4 条 CDN 镜像），
`url` 是 **HLS 封装的 WebVTT**（`…<blob>.f53102000.vtt.m3u8?ver=4`）。

旧实现有两处问题：

1. `onlineSubtitles` 要求 `subtitles[].url`，腾讯行没有 url → 被 `.filter(s => !!s.id && !!s.url)` 整批丢弃；
2. 即便有 url，把 playlist 当直链写盘会得到「内容是 m3u8 的 .vtt 文件」，播放器整轨读不出来。

本次：

- 新增 `src/lib/vtt-hls.ts`
  - `parseHlsSubtitlePlaylist`：`#EXTINF` 累加出分片起点，相对 URI 按 playlist 解析，master 退化为第一个 variant；
  - `stitchVttParts`：相对 cue 按分片起点平移、绝对 cue 原样保留，`WEBVTT` 头只留一个，
    NOTE/STYLE/REGION 丢弃，重复 cue 去重；
  - `vttToSrt`；`fetchHlsVtt`（走注入的 `fetcher`，与视频同一条出口；分片失败不整轨报废）。
- `online-subtitles.ts`：`OnlineSubtitle` 增 `playlist` / `urls`；`label` 回退顺序补 `name`；
  `downloadSubtitles` 对 playlist 字幕先拼 VTT 再落盘。

拼接口径与网关 `internal/provider/tencent/subtitle.go` 完全一致 —— 客户端自取和
`subtitle?mode=content` 代取得到同一份文本。

## 二、优酷：帧享两条帧率阶梯

网关 v3.9.119 起 `tier=multi` 默认 `fps=all`：除 5 个 60fps 档，还会追加 4 个 25 帧母版档
（`frame_xiang_dv25 / imax25 / hdr10_25 / sdr25`）。`qualities[]` 因此同时出现例如

```
cmfv5hd4_dolbyvision_hfr_hbr_hq   3840x1608@60  31.14 GB   （HFR）
cmfv5hd4_dolbyvision_hbr_hq       3840x1608@24  26.72 GB   （母版）
```

客户端要跟上的两点：

1. **选择下载必须 pin 帧率档**：UPS 的 `max_fps` 是硬上限，`profile=full/hdr10/sdr`
   都声明 60/120，只回 `*_hfr_*`。`youkuPlayInput` 现在按选中的 `stream_type` 反推
   `dovi=dv25|dv60|hdr10_25|hdr10_60|sdr25|sdr60|imax25|imax60`（判据：有无 `_hfr_`），
   否则「选了 24 帧那一行、下载却拉成 60 帧」，`youkuVideoPlaylist` 按 stream_type 匹配会找不到。
   TV / App 端不加 `dovi`。
2. **探测显式要全档**：`probeOptions` 的 youku play 输入加 `fps: 'all'`，意图明确；
   旧网关忽略未知参数，行为不变。
3. 同分辨率同 HDR 偏好的两条阶梯 label 会撞名，撞名时补 `· 60帧 / · 24帧`。

## 验证

```
bunx tsc --noEmit                                  # 无错误
bun test src/lib/vtt-hls.test.ts src/lib/online-subtitles.test.ts src/lib/youku-play-input.test.ts
                                                   # 40 pass / 0 fail
bun test src/lib                                    # 1067 pass / 38 skip / 4 fail
```

4 个 fail 全部是 `iqcn-local` 的本地 helper 用例（`helper_failed` /
「无法启动爱奇艺本地处理模块」）——需要先跑 `bun run tools:iqcn` 构建原生 helper，
本机没有产物，与本次改动无关。

## 兼容性

- 网关 < v3.9.119：`fps` / `dovi` 参数被忽略，优酷仍只列 60fps 档（无回归）；
  腾讯 `subtitles[]` 没有 url，字幕行照旧被过滤（等同改动前）。
- 网关 ≥ v3.9.119：两条帧率阶梯都能选、能下；腾讯字幕能落成真正的 `.vtt`。
