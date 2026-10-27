# Desktop v0.1.89

配套 TUI **v0.2.84** / 网关 **v3.9.118**。与 TUI 共用下载库，这一版带上芒果 CDN 容错、
Crunchyroll 字幕出口修复与 Apple TV+ 简繁字幕备注。

## 变更

### 下载（共用库）

- 芒果：清单 405 自动重试、被拒时重取播放地址、任务串行化、出口限流给准确提示并冷却；
  清单请求改用非浏览器 UA、不带 Referer；
- Crunchyroll：字幕下载走媒体同一条出口，修「成片没字幕」；整文件型 DASH 下载期间显示
  真实速度；账号并发会话已满时报错；音轨被源站错标 `eng` 时按所选原声 locale 纠正；
- Apple TV+：合轨后给简繁字幕写轨名备注（`简体中文` / `繁体中文`），字幕语言标签用
  `zh-Hans` / `zh-Hant`，成片字幕轨带默认标记；视频轨跟随主语言打标签；
- 发布源标签用 `ATVP`；CR / Apple TV+ / Disney+ 完成后记录成片实测规格。

### 桌面端

- 新增 `fetchMediaPart` shim：CR 字幕这类附属媒体文件走 Electron 同一条 native 媒体通道，
  与媒体分片共用代理解析；
- 画质页字幕文案改正：按源站原格式（ASS / VTT / SRT）挂成独立轨，写入语言、轨名与默认
  标记；默认勾选简体中文，没有则繁体、再没有则英语。

## 验证

- 共用库单测 116 pass / 0 fail，`tsc --noEmit` 无错误；
- CI（desktop）在 Windows / macOS 上跑 typecheck、共用库与卡片搜索相关测试后出安装包。

## 回滚

回退 `desktop-v0.1.88`。
