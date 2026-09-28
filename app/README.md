# GVS 桌面端（Windows / macOS）

Electron + Vue 3 的图形界面，替代在旧版 Win10 控制台里缺字、错位的 TUI。
业务逻辑**直接复用** `../src/lib`（网关客户端、隧道、画质探测、下载/解密/封装、命名、NFO），
和 TUI 读写同一份配置 `%APPDATA%\gvs\tui.json`（macOS：`~/.config/gvs/tui.json`），
两边切换不用重新填网关和登录。下载目录是其中的 `outDir`：设置页「保存到」，第一次连接时也能改。
没配过时 Windows 默认用空间最大的非系统盘 `盘符:\GVS`，不再跟着程序目录落到 C 盘。

## 开发

```bash
bun install
bun run dev          # 热更新
bun run typecheck    # 主进程 + 界面类型检查
```

Electron 二进制下载慢时：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，
再执行 `node node_modules/electron/install.js`。

## 打包

```bash
bun run dist:win     # release/GVS-Setup-<版本>-x64.exe（NSIS，可选安装目录，自带媒体工具）
bun run dist:mac     # 需在 Mac 上执行；release/GVS-<版本>-arm64.dmg / -x64.dmg
```

- Windows 包把 `../bin` 里的 ffmpeg / N_m3u8DL-RE / mkvmerge / MP4Box / shaka-packager 放进 `resources/bin`。
- macOS 包不带工具：`brew install ffmpeg gpac mkvtoolnix`。应用会把 Homebrew 路径补进 PATH，
  包装脚本写在用户数据目录的 `bin/`，不改动 .app 本身。
- 目前没有代码签名；macOS 首次打开需右键 → 打开。

## 结构

```text
src/main/index.ts      窗口、IPC（gvs:call 按方法名分发）
src/main/core.ts       业务编排：连接/隧道、浏览、搜索、详情、探测、入队、账号登录
src/main/posters.ts    gvs-img:// 海报协议：带 Referer 直连 + 磁盘缓存，HEIC 用 ffmpeg 转 JPG
src/main/env.ts        网络环境：网关走系统代理，CDN/上游直连；隧道 WebSocket 挂代理
src/main/shims/        构建时替换 TUI 里依赖 Bun 的 proxy.ts、依赖源码布局的 tool-paths.ts
src/shared/api.ts      主进程 ↔ 界面契约
src/renderer/          界面（设计稿：GVS 桌面端设计稿，米白/墨黑/橙色硬阴影）
```

网络约定与 TUI 相同：网关与 TMDB 请求走 Chromium 网络栈（跟随系统代理，适配网关屏蔽 CN 的部署）；
优酷/腾讯上游经隧道、CDN 分片都从本机直连。

## 下载任务

- 任务列表存在用户数据目录的 `jobs.json`，重启后还在；上次没下完的变成「已中断」，点继续接着下。
  只存任务本身和入队时钉住的目录/并发等设置，不存 Key、Cookie 和登录态。
- 可以暂停、继续、删除（可选同时删除文件）。直链分片下载（红果、黄果直链、腾讯、抖音）从断点续传；
  优酷与黄果 HLS 走 N_m3u8DL-RE，暂停后继续会重新下载这一集。
- 中间文件放在「临时目录」：默认是下载目录下的 `.gvs-tmp`（同盘，完成后直接改名），
  设置里可以改到别的盘；每个任务一个子目录，完成后自动删除，失败/暂停的保留给重试和续传。
  设置 → 下载 → 缓存 可以清掉海报缓存和没有任务在用的临时残留。

## 已知限制（v0.1）

- 抖音只支持在设置里填 Cookie 后搜索，暂未接入抖音下载流程。
- 只有浅色主题。
