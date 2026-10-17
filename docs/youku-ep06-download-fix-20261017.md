# 优酷《嫁金钗》EP06 下载故障排查与客户端修正


> 后续实际成品核对（同日）：用户再次下载后，现已找到真实 MKV。实测 3840×2160、60fps、Dolby Vision Profile 5，AAC-LC 立体声；文件 963,688,654 字节（919.05 MiB），仅 368.484 秒。队列中 EP06 预期为 3093 秒。因此问题已进一步确定为短内容被误标完成，不能再沿用前一阶段“没有实际文件”的结论。下文最初调查保留其当时的证据边界，最新修正见文末。

2026-10-17。本次只修改 `tui` 共用下载实现，不修改 gateway、线上服务、用户账号或已安装 App。

## 本次故障的已知事实

本机 `desktop-run.log` 记录：2026-10-17 13:58:35（北京时间），任务 11 开始下载 VID `XNjU3NDY1MjAyNA==`，取流请求为 `tier=multi,expand=0,nocache=1`。下载器合并/解密约 908.1 MB 后，于 13:59:21 报“下载的文件中没有音频轨道”。工作目录标签为 `muxed`，日志中没有独立音轨下载阶段。

任务现已从持久队列移除，其工作目录也不存在；输出目录只剩空的 Season 01。原日志没有记录用户所选 stream_type、来源端或实际视频规格。因此不能仅凭 908 MB 推断具体下载了哪个 DV/HDR/SDR 档位，也不能补造媒体实测结论。

本轮曾尝试一次重新取 EP06，返回 HTTP 503、`error_code=RISK_REJECTED`，随即停止，没有重复探测或重新下载整集。响应没有可用于本次诊断的片源数据。

## 源码中复现的问题

1. `youkuPlayInput` 对帧享选择仍请求多端、多 profile 混合目录；`youkuVideoPlaylist` 能从目录选中帧享视频，但下载用的 `drm`、`audio_tracks` 和 `audio_delivery` 属于主响应。主响应来自其他端时，目录中存在 DV 不等于其音轨和密钥可以与主响应通用。
2. 旧的无来源任务在所选 stream_type 缺失时，选择器直接使用 `data.video`，可能静默改成其他规格。
3. `youkuUsesSeparateAudio` 把“没有独立音轨 URL”解释成“不需要独立音轨”，CMAF 视频会以 muxed 方式下载，直到最终音轨校验才失败。

这些源码路径和合成回归证明问题存在，但缺少原 EP06 响应和媒体，不能将它们全部当作这一次故障的已确认因果链。

## 修正后的行为

- 帧享下载按所选流指定已有 DV 默认、HDR10、SDR、Vivid 或 DRM7 profile，同时固定 `lane=frame_xiang`；TV/App 保持各自来源。目录探测仍用多端目录，实际下载和音轨续期使用固定来源/profile。
- 显式选择必须匹配实际返回的档位；来源冲突、多个不同地址或所选档位缺失均明确失败，不静默降档。
- CMAF 视频始终要求独立音轨。主响应没有可下载的独立音轨时，在视频下载前停止，避免先下载近 1 GB 的无声视频。
- TV/App 的确切 muxed 流保留内嵌音轨，不借用帧享音轨。
- 日志增加所选档位、实际匹配档位、主响应来源、分轨模式及音轨数量。不输出播放地址、Cookie 或内容密钥。

## AAC 与 DV 的核对范围

画面的 DV 与声音的 AAC/杜比数字+是两套独立规格，看到 AAC 不能据此判定视频不是 DV。现有客户端封装使用流复制和 mkvmerge/MP4Box；未加入将音频统一转为 AAC 的步骤。

本轮本地合成媒体分别使用 AAC 与 E-AC-3，经过实际 CDN 下载、独立音轨下载和封装，再用 ffprobe 读取成品：AAC 仍为 AAC，E-AC-3 仍为 E-AC-3。该测试不代表腾讯/优酷真实节目或 DV 媒体实测，也不证明 EP06 的源站一定提供 Atmos/杜比音轨。

## 验证

- 六个相关测试文件 88 项通过、0 失败，包含来源/profile 固定、缺 DV 拒绝替换、主响应不一致、跨集音轨归属及 TS 解密。
- 开启 `GVS_MEDIA_TESTS=1` 的本地媒体集成实际执行，覆盖默认分轨、指定帧享、E-AC-3 保留、TV 自带音轨、缺档位和缺音轨提前停止。
- TUI TypeScript 检查与构建、桌面类型检查和 Electron 构建通过。
- 实际 EP06 的 DV 元数据和源站可用音轨仍需账号限制解除后的真实取流及媒体检查；本次没有宣称整集修复验收通过。

测试命令（在 `tui`，PowerShell）：

```powershell
$env:GVS_MEDIA_TESTS='1'
bun test src/lib/youku-play-input.test.ts src/lib/jobs.test.ts src/lib/youku-delivery.integration.test.ts src/lib/quality.test.ts src/lib/youku-session.test.ts src/lib/youku-ts.test.ts
Remove-Item Env:GVS_MEDIA_TESTS
```

证据关系：本机日志支撑“下载后缺音轨”；源码与缺陷回归支撑“跨端混用和静默替换路径”；本地媒体成品支撑“修正后合成下载/音轨保留”。它们分别对应本次故障定位、客户端选择修正、媒体回归，不互相替代实网节目验收。

## 更新包

客户端安装包：`app/release/youku-ep06-fix-20261017/GVS-Setup-0.1.64-x64.exe`。版本仍为本地 0.1.64，SHA-256 为 `1f0b08e45552606de09996b006684dcff2ebdea5440a998e53dd3c8fa83effb3`；与前一个自动画像安装包使用不同交付目录。包内主进程已核对所选 profile 固定、禁止静默替换、主响应来源检查、缺音轨提前停止和选择诊断。完整文件身份见同目录 `youku-ep06-build-manifest.json`。仅生成安装包，未关闭用户正在运行的 App、未安装替换、未部署服务端。

## 实际成品与登录校验修正

本地成品 `嫁金钗.S01E06.魏娆操办寿宴陆濯相助.2026.2160p.YOUKU.WEB-DL.HQ.DV.60fps.HEVC.AAC.2.0-ADWeb.mkv` 经内置 ffprobe 只读核对：视频 Dolby Vision Profile 5、3840×2160、60fps、368.484 秒；音频 AAC-LC、双声道、368.477 秒。视频统计平均码率约 20.66 Mbps。若按观测码率延伸到分集的 3093 秒，大小约为 7.53 GiB；这解释了目录 7G+ 与短文件 919MB 的差异，不是重新编码压缩成了 919MB。

新任务日志有实际所选和返回流标识，两者均为 `cmfv5hd4_dolbyvision_hfr_hbr_hq|frame_xiang` 对应帧享 DV，下载视频、音频各 37 段。日志与成品共同支持“下载到 DV 短内容”。单凭这些记录不能还原原响应的 Trial、鉴权标志或上游裁剪原因；用户确认当时登录已掉线。本轮没有请求线上地址，后续验证均为本地文件和本地合成 HTTP/媒体。

### 为什么没有提示

- 桌面自动续期读到了 `needs_relogin` 却没有使账号进入需扫码状态；旧 UID、已存凭证及会员快照还可能令登录摘要保持可用。
- 账号解析对 `logged_in` 使用 OR，明确未登录的标准摘要可能被旧 session=true 覆盖；凭证摘要中的旧 UID、yktk 长度也能覆盖 explicit logged_in=false。
- 画质探测只拦不能播放，没有阻止“可播放试看”；桌面探测遇到失效签名还可能自动退回其他网关会话。
- 优酷下载检查了解码/音轨，却没有将成品时长与已保存的分集时长比较。

### 当前处理

- 明确过期、续期要求重登、explicit logged_in=false 优先于 UID/凭证残留；桌面和 TUI 更新需扫码状态。
- 桌面探测遇到过期明确提示登录，停止此次操作，不再静默改用其他会话；下载中的过期事件携带 requiresReauth，账号未切换时同步更新其登录提示。
- 最新的试看结果覆盖旧会员摘要，显示仅试看；画质页和下载阶段拒绝试看成功响应。仅网页会员查询 SESSION_EXPIRED 不作为 App 掉线证据。
- 已声明流时长不足时在下载前停止。即使接口没有声明试看，封装后的实际视频时长仍必须达到分集预期，允许 3% 或 10 秒差异；没有可靠实际时长时不宣告完整。
- 成品未过检查时保留诊断材料，不提交到正式成品路径，不写下载完成事件、不写成功历史，也不自动删除用户现有 919MB 文件。

### 本地验证

八文件回归 148 项通过，覆盖 TUI runtime、登录摘要、续期标志、DV/分轨、实际 AAC/E-AC-3 保留、试看/过期提前停止，以及声明完整却实际只有 1 秒的媒体在封装后被拒绝。另增加两项本地 HTTP 回归，真实 GwClient 对接 `127.0.0.1` 合成成功 envelope，验证过期或试看响应即使附有 DV 目录也不会进入可下载选项；5 项 guard 测试全部通过。桌面类型检查、Electron 和 TUI 构建通过。

本地证据摘要位于 `.build/youku-ep06/completed-file-evidence.json`；日志位于该目录的 `final-login-regression.log` 和 `local-http-login-tests.log`。这些日志和成品均留在本机，未上传。

## 登录与时长修复安装包

请使用本轮较新的 `app/release/youku-login-fix-20261017/GVS-Setup-0.1.64-x64.exe`，它包含前一轮音轨/选档修正及本轮登录、试看和完整性检查。安装包 SHA-256：`ab679c7d0dc287c42bb232f1d3b5ef2ca274607f3fa30ec5eff8588f7c4b872e`。包内主进程七项检查通过，完整摘要见同目录 `youku-login-build-manifest.json`。尚未替换用户正在运行的安装版；本轮不部署或改动 gateway。

## 新扫码后的本地真实取流（2026-10-17）

用户在本地隔离网关完成新的优酷 QR 登录。该网关使用独立 API Key、数据目录、加密凭证目录及本机客户端隧道，不读取或覆盖生产网关会话，不修改桌面 App 的账号配置。登录回包和凭证信息确认新的签名已签发、logged_in=true。

EP05：帧享 DV `cmfv5hd4_dolbyvision_hfr_hbr_hq`，3840×2160、60fps、dvh1.05.09；目录标称 6,733,361,022 字节、3091.750 秒。实际 video m3u8 为 37 段、365.850 秒、ENDLIST，audio m3u8 为 37 段、365.830 秒。只有 `cmfa1hd3` AAC 独立音轨。

EP06：同档帧享 DV，3840×2160、60fps、dvh1.05.09；目录标称 7,479,109,448 字节、3093.283 秒。实际 video m3u8 为 37 段、368.483 秒、ENDLIST，audio m3u8 为 37 段、368.477 秒。只有 `cmfa1hd3` AAC 独立音轨。

两集均 can_play=true、is_vip=true，同时 trial.time=360、quality_gate.has_trial=true。真实清单支持“仅获得约六分钟内容”，目录中的整集规格和 can_play/is_vip 不能当完整授权证明。EP06 与此前 919MB 实际文件时长相符。

这一轮新登录后仍为短流，说明“只是旧登录失效，重新扫就会恢复完整 DV”的判断不足；尚未核实当前帧享端产品权益或授权请求链路的具体限制原因，不能把它归因为多 IP 或确认账号无会员。本轮没有额外更换端参数反复探测，也没有下载整集。

脱敏结果位于 `.build/youku-local-20261017/public-results.json`、`playlist-coverage-results.json`。原始登录/取流回包及带签名清单仅存该本地忽略目录，不入库、不展示凭据和播放链接。
