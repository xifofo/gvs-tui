# GVS RE v0.6.0-iq.4

## 修复

- **Apple TV+ Atmos（E-AC-3）音轨下载失败**：Apple 的媒体清单按 part 分段（多段
  `#EXT-X-MAP`），RE 走「多初始化段拼接」路径时把音频输出写成 `.m4a`，ffmpeg 用
  `ipod`(mp4) 封装器，mp4 不支持 E-AC-3：
  `Could not find tag for codec eac3 in stream #0` → `Failed`。
- 现在按实际探测到的音频编解码选容器：
  - MP4 可承载（aac / mp3 / mp2 / alac）→ 保持 `.m4a`；
  - E-AC-3 / AC-3 / DTS 等 → `.mka`（纯音频）或 `.mkv`（含视频）；
  - 拼接前的归一化输入跟随同一容器族，`-video_track_timescale` 只对 mov 输出使用。
- 不影响 AAC 音频、TS/AES-128、DASH 常规路径。

## 验证

- 复现样本：Apple TV+ 960p（`ec-3`, 16/JOC, 40 分片）。
  旧二进制：`正在拼接 2 个独立初始化的点播段...` → `ipod` 报错 → Failed。
  新二进制：拼接产出 `.mka`，封装 MKV 成功（CI 产物实测，见桌面端 v0.1.88 发布说明）。
