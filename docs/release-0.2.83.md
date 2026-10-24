# TUI v0.2.83

配套网关 **v3.9.114**。修复 **Apple TV+ 默认音轨（E-AC-3 / Atmos）下载失败**。

## 变更

- 内置 N_m3u8DL-RE 升到 **managed-re-v0.6.0-iq.4**（提交 `1bb9fc6`）；
- 修复 RE「多初始化段拼接」把音频写成 `.m4a`（mp4/`ipod` 容器）的问题：mp4 不支持
  E-AC-3，Apple TV+ 默认音轨（`16/JOC` Atmos）会在拼接阶段直接 Failed；
- 现在按实际音频编解码选容器：aac/mp3 → `.m4a`，E-AC-3/AC-3/DTS → `.mka`（有视频时
  `.mkv`），归一化输入跟随同一容器族；
- 回落封装（mkvmerge）输入识别补 `.mka` / `.mkv`。

## 验证

真实 Apple TV+ 960p、40 分片、eac3 6 声道音轨：

```
修复前：正在拼接 2 个独立初始化的点播段... -> [ipod] eac3 不支持 -> Failed
修复后：cli.mkv 237 MB（h264 1920x960 + eac3 6ch），ffmpeg 全解码 0 错误
```

## 回滚

回退 `v0.2.82` + 旧 RE（`managed-re-v0.6.0-iq.3`）。
