# TUI v0.2.67 / Desktop v0.1.69

合并 PR #22（`fix: improve IQ downloads and macOS DDP validation`）。配套 gateway v3.9.88 及以上。

- IQ 音频：新增独立音轨选择与 E-AC-3 校验（`iq-audio-selection`、`eac3-validation`），损坏的 AAC 轨道只清掉它自己的可复用状态，不再牵连整集。
- IQCN：`iqcn-local`、`iqcn-control`、预取与描述符缓存收敛为同一套分片/清单校验，失败信息走统一的下载器错误类型（`downloader-error`）。
- 媒体时序与画质：`media-timing`、`media`、`quality` 修正时长/轨道判定，字幕与音轨语言标签沿用源站。
- macOS：DDP（Dolby Digital Plus）校验路径修正，避免把可播放的 E-AC-3 判成不可用。
- 与本次同时发布的账号改动：爱奇艺登录以「扫码登录爱奇艺国内版」为主，IQ 海外版登录降级为可选（仅 iq.com 独播内容需要）。

验证：`bun test src/lib` 911 通过 / 0 失败（31 个需真机媒体的用例跳过）；`bun run tools:check` 工具链校验通过；`bun run build`（tsc + vite）通过。未做整集真机下载验收。发布不等于网关已升级，服务端请保持 v3.9.88+。
