# TUI v0.2.88

配套网关 **v3.9.119**。本版把上游 v0.2.86 / v0.2.87 的**国区改动**同步进来
（腾讯软字幕、优酷帧率档），同时把 main 上此前未发版的 PlutoFish 上传/恢复与桌面端修复
一并纳入首个 tag。

## 一、国区同步（来自上游 v0.2.86 / v0.2.87）

### 腾讯软字幕：清单带 URL，下载走 HLS 拼接

网关 v3.9.119 起 `subtitles[]` 带 `url` / `urls[]`（4 条 CDN 镜像），`url` 是
**HLS 封装的 WebVTT**（`…<blob>.f53102000.vtt.m3u8?ver=4`）。旧实现两处问题：
腾讯行没有 url 被 `.filter(s => !!s.id && !!s.url)` 整批丢弃；即便有 url，
把 playlist 当直链写盘会得到「内容是 m3u8 的 .vtt 文件」。

- 新增 `src/lib/vtt-hls.ts`：`parseHlsSubtitlePlaylist`（`#EXTINF` 累加起点、相对 URI 解析、
  master 退化为第一个 variant）、`stitchVttParts`（相对 cue 平移 / 绝对 cue 保留 /
  头部只留一个 / NOTE·STYLE·REGION 丢弃 / 重复去重）、`vttToSrt`、`fetchHlsVtt`；
- `online-subtitles.ts`：`OnlineSubtitle` 增 `playlist` / `urls`，`label` 回退补 `name`，
  playlist 字幕先拼 VTT 再落盘；直链行为不变。

拼接口径与网关 `internal/provider/tencent/subtitle.go` 一致：
客户端自取与 `subtitle?mode=content` 代取得到同一份文本。

### 优酷：帧享两条帧率阶梯

网关 `tier=multi` 默认 `fps=all`，除 5 个 60fps 档还追加 4 个 25 帧母版档
（`frame_xiang_dv25 / imax25 / hdr10_25 / sdr25`）。UPS 的 `max_fps` 是硬上限，
`profile=full/hdr10/sdr` 全声明 60/120，只回 `*_hfr_*` —— 不 pin 帧率档就会出现
「选了 24 帧那一行、下载却拉成 60 帧」，随后按 `stream_type` 匹配找不到流。

- `youku-play-input.ts`：按选中 `stream_type` 反推 `dovi=dv25|dv60|hdr10_25|hdr10_60|
  sdr25|sdr60|imax25|imax60`（判据：有无 `_hfr_`）；TV / App 端不加；
- `quality.ts`：探测显式 `fps: 'all'`；同分辨率同 HDR 偏好的撞名档位补「· 60帧 / · 24帧」。

## 二、main 上此前未发版的改动（并入首个 tag）

- PlutoFish：上传完成回执、失败诊断保留、续传参数更新、断线保留页面并自动重连、
  按进度追更与换设备/换账号补漏、唯一发布版本匹配、手动搜索 TMDB；
- 桌面端：媒体补检与成品规格复核、主分支源码提交后自动构建安装包；
- 命名与规格：发布组、输出命名、实际规格识别（E-AC-3 指数兼容错误复核后保留原音轨）、
  IQCN 整文件投放。

细节见 `git log 2dc0908..v0.2.88`。

## 验证

```
bunx tsc --noEmit                                   # 无错误
bun test src/lib/vtt-hls.test.ts src/lib/online-subtitles.test.ts src/lib/youku-play-input.test.ts
                                                    # 40 pass / 0 fail
bun test src/lib                                     # 1067 pass / 38 skip / 4 fail
```

4 个 fail 全部是 `iqcn-local` 的本地 helper 用例（`helper_failed` /
「无法启动爱奇艺本地处理模块」）——需要先 `bun run tools:iqcn` 构建原生 helper，
本机没有产物，与本次改动无关。

## 兼容性

- 网关 < v3.9.119：`fps` / `dovi` 被忽略，优酷仍只列 60fps 档；
  腾讯 `subtitles[]` 没有 url，字幕行照旧被过滤（等同改动前）。
- 网关 ≥ v3.9.119：两条帧率阶梯都能选、能下；腾讯字幕能落成真正的 `.vtt`。

## 回滚

回到 `v0.2.85`（国区两处改动与 PlutoFish 上传链路均不存在）。
