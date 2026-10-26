# Desktop v0.1.86

配套网关 **v3.9.113** / TUI **v0.2.81**。这一版把 Apple TV 的音轨/字幕选择接进桌面端。

## 变更

- **音轨口述影像**：读取网关新增的 `audios[].audioDescription`，音轨卡片显示「口述影像」
  标签；默认只勾选正片音轨（此前 Apple 两条 `DEFAULT=YES` 都会被勾上，导致 MKV 里多一条
  口述影像）；
- **字幕**：沿用桌面端已有的字幕卡片（Apple TV / Disney+ 通用）；说明文案由「Disney+」
  改为通用，Apple TV 的 HLS 字幕渲染同样会出现在列表里；
- 除以上两点不桌面端下载主流程（jobs/mkvmerge/RE 参数）无改动。

## 验证

```
bun install && bun run typecheck   # vue-tsc + tsc，0 error
```

## 回滚

回退 `desktop-v0.1.85`。
