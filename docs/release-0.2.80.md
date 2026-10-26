# TUI v0.2.80

配套网关 **v3.9.112**。这一版给画质页补上**字幕列**，并把选择随 `resolve` 下发给网关。

## 变更

- 画质页 `←/→` 按 **画质 → 音轨 → 字幕** 循环；平台没返回轨道的列不出现；
- `probe` 返回的 `subtitles[]` 不再在 `adoptOptions` 里被丢弃：进入画质页即保存；
- 字幕列：空格勾选、`a` 全选、`c` 清空，`↑↓` / `PgUp/PgDn` / `Home/End` 与音轨一致；
- 确认下载时把勾选写成 `DlTask.subtitleTracks`，`jobs.ts` 拼成 `subtitle=1,3` 传给网关
  （Apple TV、Disney+ 共用；Crunchyroll 字幕走签名直链，逻辑不变）；
- 返回导航时恢复字幕选择；换片 probe 前清空，避免跨片串号；
- 字幕行显示语言与 `平台默认/强制/SDH` 标记；底部新增「已选字幕」；帮助页快捷键文案同步。

## 验证

```
bun test src/lib/subtitle-selection.test.ts src/subtitle-runtime.test.ts
# 6 pass / 0 fail
tsc --noEmit        # 0 error
bun run build       # 通过
bun test            # 1218 pass / 17 fail（全为缺 mkvtoolnix 的既有环境失败，改动前后一致）
```

## 回滚

回退 `v0.2.79`。不带 `subtitle` 参数时网关按默认下发（不带字幕），与旧版行为一致。
