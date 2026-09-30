# TUI 与 Electron provider 适配

更新：2026-09-30。客户端仓库为 `tui`，Electron 工程在 `tui/app`，不是 `tui/native` 离线原型。接口基线为 gateway `v3.9.26` / `f0ea801`。

## 已实现

- `src/lib/providers.ts` 统一七个平台的名称和入口；两端共用。TUI 支持 1–7 平台快捷键。Hami 加入按 Key 权限判断的自动隧道列表。
- mewatch：设备激活码/官方激活地址、按源站 interval 检查授权、状态、profiles/profile、退出。TUI 可显示激活页面二维码；Electron 显示可复制激活地址和激活码。
- Hami：本人 TV Cookie 文本导入、续期、状态和退出；Web 准备、明确确认发码、六位短信码验证、状态和退出。Web/TV 会话分别选择，不把 Web 登录冒充 TV。
- 手机号、短信码、Cookie、profile PIN 只作瞬时提交，不保存到客户端配置；离开输入页/提交后清空对应输入。切换网关或 Key 后丢弃本地登录流程。
- mewatch 接浏览栏目和分集分页；两端识别 mewatch/Hami 官方产品链接。TUI 选择 Hami 时也可直接输入产品 ID。Hami 不显示不存在的搜索/榜单功能。
- 共享详情适配保留实际分集 ID、季号、集号；单部影片保留可播放条目。分页最多追加 20 页，重复 cursor 会停止；未完整目录明确提示，不声称已经取全。
- 画质读取保留同次取流的 CDN 地址、请求头与 DRM 标志。Web Hami 始终使用 `quality=auto`；TV 使用已返回的档位，不自动扫所有档位。
- 明确标记 `drm.clear=true` 的 DASH/HLS 可交给本机下载管线；媒体不由 gateway 中转。未知加密、受保护媒体和无限直播录制会明确拒绝，而不是按明文误下载。

## 腾讯风险处置与日志

- 在现有未提交的 `tencent-operations.ts`、client/config/jobs/runlog 改动上增量完善；没有覆盖或撤销原有实现。
- TV 观测绑定保留 flow / operation / job 的关联，账号/会话绑定失效、明确 em=93/94、HTTP 403/429 或 stop 信号停止当前流程。
- CDN 刷新不能吞掉 `TencentRiskStop` 或带 HTTP 拒绝状态的账号错误。普通 CDN 地址过期处理仍走既有逻辑。
- 去掉“通常数小时恢复”的无证据承诺，显示恢复时间未知并要求按官方提示处理。下载进度从不冒充观看进度。
- `tencentObservations` / `GVS_TENCENT_OBSERVE=1` 只控制绑定和观测，不开启 `TENCENT_TV_EVENT_REPORT`，也不自动提交 bosskv/getfeature。风险诊断无需开启该选项即可本地记录。
- Electron 使用真实 `electron_process` 来源。当前 gateway 只接受 `tui_process` 观测，故 Electron 绑定仍走现有接口，但测量事件仅记本地，并标注 `local_only_gateway_source_unsupported`；不会冒充 TUI，也不宣称服务端已经记录。若将来扩展网关来源白名单，需要独立部署和验收。

### 查看日志

- TUI：设置 → 腾讯诊断日志；任务列表 → 回车打开任务详情，可看当前任务最近诊断。
- Electron：设置 → 平台账号 → 风控处理日志；下载列表 → 腾讯任务 → 腾讯诊断。面板只读，可手动刷新。
- 默认文件：与 `tui.json` 同目录的 `tencent-diagnostics.jsonl`，Windows 通常为 `%APPDATA%/gvs/tencent-diagnostics.jsonl`。测试可用 `GVS_TENCENT_DIAGNOSTICS_PATH` 指向隔离文件。
- 单文件约 2 MiB 后轮转为 `.1`，只读取有界文件；查询按网关地址与完整 Key 的摘要隔离，不能通过猜 job ID 读取其他 Key 的记录。
- 记录白名单字段：时间、关联 ID、动作、阶段、状态、处置决定、有限错误码/HTTP 状态。不存 Cookie、binding、手机号、短信码、许可证正文、签名媒体 URL、设备凭据或内容密钥。
- `observed_locally` 仅表示观测已被网关记录；`unverified_response`/HTTP 200 不表示腾讯风控接受。未知送达结果不会自动重发。

## DRM 与流量边界

客户端继续采用“控制请求到网关、视频从源站 CDN 到本机”的架构。没有复制、打包或请求任何 L1/L3 设备认证文件；此次也没有修改网关认证文件或镜像。

**当前 gateway 的 Hami/mewatch 公共 `license` 动作返回许可证，而非下载器可直接使用的原始内容密钥。共享 Widevine 包也没有公开 key 导出接口。因此本次没有完成这两家的受保护媒体下载。** 客户端显示 `DRM_CLIENT_UNAVAILABLE`，不会偷偷改为服务器视频转发，也不会增加假 key 接口或将设备私钥下发。后续必须先确定并验证实际受支持的授权处理/交付协议，再接通加密媒体链路。

直播录制、字幕多选和完整多轨选择也不在本次验收范围；已有接口能返回相关元数据，不等于客户端已经支持相应全流程。

## 验证方式

```text
bun test src app/src/main
bunx tsc --noEmit
bun run build
cd app
npm run typecheck
npm run build
```

Electron 离线界面冒烟：用本机 Electron 运行 `app/scripts/renderer-smoke.cjs`。该脚本使用独立临时 userData、隐藏 offscreen 窗口、合成 IPC，并拦截所有 HTTP/HTTPS 请求；不读取真实账号配置，不发真实短信、不请求许可证。截图与结果位于 `.build/electron-smoke/`。

普通构建不是安装包发行：本轮实现未执行 electron-builder。后续按用户明确要求提交并推送客户端代码；此次不打 tag、不发布安装包。真实 mewatch/Hami 登录、受保护内容、真实腾讯风控效果均不由离线测试证明。

## 本轮验证结果

- `bun test src app/src/main`：333 passed、0 failed，44 个测试文件。
- TUI TypeScript/Vite 构建通过；Electron renderer/main/preload 类型检查及 electron-vite 构建通过。
- 隔离 Electron offscreen 界面检查通过：七个平台入口、mewatch 激活码、切换 Hami Web 后保留其他平台激活状态、Web 准备入口、账号级/任务级腾讯诊断面板。已查看实际渲染截图并修正账号区域间距和标签换行。
- 界面测试使用合成 IPC，HTTP/HTTPS 全部阻断；不等于真实登录、真实短信或真实 DRM 的端到端验收。
- `git diff --check` 通过；实现验收时未提交；后续按用户要求仅提交/推送本轮代码。未生成安装包，未读取或下发真实设备认证文件。
