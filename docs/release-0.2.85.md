# TUI v0.2.85

配套网关 **v3.9.118**（本次无网关改动）。合入 PR #27：独立轨道封装时**给中文字幕写上语言标签**，
并让**红果 / 黄果的 ffmpeg 封装**与**挂字幕的二次封装**把**发布组**写进 MKV 的 `GROUP`。

## 变更

### 字幕语言（独立轨道封装）

- 文件名的 `zh-Hans` / `zh-Hant` 原样交给 mkvmerge，成品语言是 `chi` 且保留书写标记；
  `zh` 等简写仍按 ISO 639-2 归一到 `chi`；
- 此前把 `zh-Hans` 直接塞给文本轨，mkvmerge 不认，合轨后中文字幕停在 `und`
  （英语正常），现在简繁两条轨都带正确语言，播放器可按语言自动选轨。

### 发布组（MKV `GROUP`）

- 红果、黄果走 ffmpeg 封装时补 `-metadata GROUP=<发布组>`；
- Crunchyroll 等挂字幕的二次封装用 `--global-tags` 写入同一发布组，不再只写在第一次封装里；
- 组名仍取任务上保存的值，缺省回落到设置；空值跳过，MP4 不写。

### 合并处理

- 与 main 上「合轨后给简繁字幕写轨名备注」(`简体中文` / `繁体中文`) 的改动并存：
  同一轨道既有轨名备注，也有 `--language` 标签；
- 语言码统一走 `mkvLang()` 归一，不再直接透传原始文件名片段。

## 验证

- `bunx tsc --noEmit` 无错误；
- `bun test src/lib`：**1003 pass / 35 skip / 0 fail**（137 个文件，1038 个用例）；
- `GVS_MEDIA_TESTS=1 bun test src/lib/mkvmerge-tracks.integration.test.ts src/lib/release-group.integration.test.ts`：
  **4 pass / 0 fail**（简繁字幕语言分别为 `zh-Hant` / `zh-Hans`，发布组在各条本地封装路径都保留）。

## 回滚

回退 `v0.2.84`。
