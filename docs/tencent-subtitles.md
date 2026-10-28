# 腾讯软字幕

腾讯 `play` 返回可下载的 `subtitles[]` 后，桌面端和 TUI 的字幕选项会列出这些轨道。默认勾选简体与繁体，简体优先默认显示；没有中文时勾选英语。取消所有勾选表示不额外添加字幕。选择硬字幕档位时不追加软字幕。

任务只保存字幕 ID、语言、名称和选择标记。每集下载使用当集最新取流响应中的地址；视频地址刷新时一起刷新字幕。跨集字幕 ID 变化时，只接受能唯一确认的相同语言，简体和繁体分别匹配。缺少所选字幕或无法确认语言时停止任务，避免静默生成缺轨成品。旧任务没有字幕选择记录时，保持原先下载行为。

腾讯的 HLS WebVTT 先完整下载、拼接时间轴，再转换为 SRT 挂进 MKV，以兼容更多播放器。镜像 CDN 会逐一尝试；任一分片仍不可读取时整轨失败。有效的空白分片允许存在，整轨必须有字幕内容。下载和挂轨均在临时成品上完成，全部成功后才交付最终文件并进入后续上传流程。

成片字幕轨写入：

| 字段 | 规则 |
| --- | --- |
| 语言 | 简体 `zh-Hans`、繁体 `zh-Hant` |
| 名称／播放器备注 | 当集网关返回的字幕名称，例如“简体中文”“繁體中文” |
| 默认显示 | 已选轨中优先简体；取消简体后选择其余轨中的首条，最多一条默认 |
| 强制字幕 | 否 |
| 编码 | UTF-8 |

这里的备注是 MKV 字幕轨的 `track_name`，不添加文件级备注。视频和音频保持复制封装。

验证（本地合成视频、回环 HTTP 服务和模拟网关，不使用真实下载或上传）：

```sh
bun test src/lib/tencent-subtitles.test.ts src/lib/online-subtitles.test.ts src/lib/vtt-hls.test.ts src/subtitle-runtime.test.ts
GVS_MEDIA_TESTS=1 bun test src/lib/tencent-subtitles.integration.test.ts src/lib/tencent-download.test.ts
cd app
bun run typecheck
bunx electron-vite build
bunx vite build --config scripts/tencent-subtitles-smoke.config.ts
node_modules/.bin/electron ../.build/tencent-subtitles-ui/smoke.cjs
```

媒体测试读回实际 MKV 的轨道语言、名称、默认／强制标记和字幕时间，比较挂轨前后音视频压缩数据；覆盖独立音轨、只选繁体、空选择、硬字幕、缺轨、分片失败、刷新与暂停。桌面验收通过生产探测、任务构造和渲染页面验证选轨，并检查宽／窄窗口布局。
