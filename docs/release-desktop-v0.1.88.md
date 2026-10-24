# Desktop v0.1.88

配套 TUI **v0.2.83** / 网关 **v3.9.114**。与 TUI 共用下载库，这一版带上
**Apple TV+ E-AC-3（Atmos）音轨下载修复**。

## 变更

- 内置 N_m3u8DL-RE 升到 **managed-re-v0.6.0-iq.4**（提交 `1bb9fc6`）：
  RE 的多初始化段拼接此前把音频输出为 `.m4a`（mp4/`ipod` 容器），mp4 不支持
  E-AC-3，Apple TV+ 默认音轨（16/JOC Atmos）会在拼接阶段 Failed；
- 现在 E-AC-3/AC-3/DTS 走 `.mka`（有视频时 `.mkv`），aac/mp3 仍为 `.m4a`；
- 回落封装输入识别补 `.mka` / `.mkv`；
- 界面与协议无变化。

## 验证

真实 Apple TV+ 960p / 40 分片 / eac3 6ch：修复前 `ipod` 报错 Failed；修复后
`cli.mkv 237 MB`（h264 1920x960 + eac3），ffmpeg 全解码 0 错误。

## 回滚

回退 `desktop-v0.1.87`。
