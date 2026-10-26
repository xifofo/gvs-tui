# TUI v0.2.82

配套网关 **v3.9.113**。这一版是**下载效率**：DRM OTT 源的音轨不再等整条视频下完。

## 变更

- Apple TV / Disney+ / Crunchyroll 的清单下载给 N_m3u8DL-RE 传 `-mt`
  （`--concurrent-download`）：RE 默认**逐流串行**，音轨要等整条视频下载+解密结束才开始；
  开启后视频与音轨**并行下载、各自解密**；
- 其它 provider 保持串行，避免无故抬高源站并发；
- 不改解密引擎：仍是 Shaka 整轨解密，也不改合并（mkvmerge/ffmpeg）路径。

## 实测

- 解密本身不是瓶颈：215 MB cbcs 样本，Shaka `0.22s`、FFmpeg `0.20s`（≈1 GB/s），
  两者输出逐帧一致、0 解码错误；
- 真实 Apple TV 960p 样本（40 分片）：视频 223.6 MB、音轨 22.0 MB —— 串行时音轨整段
  下载/解密要排在视频之后，`-mt` 可省掉这一段，约等于下载阶段的 **9%**；
- 合成 cbcs 双轨样本：串行与 `-mt` 都产出 h264+aac 可解码 MKV，0 错误；日志确认
  生产路径（无分段范围）只有「二进制合并 → Shaka 解密 → 封装」，没有多余的 ffmpeg 重封装。

## 验证

```
bun test src/lib/media.test.ts src/lib/appletvplus-download.test.ts src/lib/manifest-provider.test.ts
# 56 pass / 0 fail
tsc --noEmit / bun run build   # 通过
```

## 回滚

回退 `v0.2.81`；`-mt` 只影响多轨下载的并发，其余行为不变。
