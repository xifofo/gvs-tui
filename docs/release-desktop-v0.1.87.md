# Desktop v0.1.87

配套 TUI **v0.2.82** / 网关 **v3.9.113**。桌面端与 TUI 共用下载库，这一版带上
**DRM OTT 音视频轨并行下载/解密**。

## 变更

- Apple TV / Disney+ / Crunchyroll 下载给 N_m3u8DL-RE 传 `-mt`：默认逐流串行时，
  音轨要等整条视频下载+解密结束；现在视频与音轨并行，各自解密；
- 其它 provider 保持串行；解密引擎（Shaka 整轨）与封装路径不变；
- 界面与协议无变化，仅有版本号与下载并发行为。

## 验证

```
bun install && bun run typecheck   # vue-tsc + tsc，0 error
```

## 回滚

回退 `desktop-v0.1.86`。
