# IQ mdcm 下载器解析修复与本地验证（2026-10-17）

本次修复针对 `Unsupported IQ mdcm encryption pattern` 的解析兼容性。下载器版本为 `0.6.0-gvs-iq.2`。尚未取得《真珠美人魚（日文版）》第 8 集的原始失败分片，因此不能把兼容性验证写成该集整集下载已通过。

## 修改内容

旧实现对整个 TS 文件做 ASCII 正则匹配，要求 `mdcm|s1:9:10|` 后只能跟零或一个字段再跟 IV。字段顺序变化或 SDT 跨 TS 包时，可能抛出不支持模式；另有把 provider name 中的文本误当成加密信息的风险。

新实现读取 PID 17 的 SDT service name，按长度限制各字段的边界，重组跨包 section，再独立解析模式、pattern 和 16 字节 IV。支持旧布局与已有 Go 还原器支持的 a0-first 布局。缺失或无效 IV、未知模式、明确不支持的 pattern 均拒绝。AES、NAL counter、CRC 处理、TS 包数量和时间戳处理保持原算法。

构建脚本从 `gvs-source.json` 读取版本，安装 Windows 下载器时同步更新 `bin/manifest.json` 的版本、长度和 SHA-256。

## 已有验证

- 旧实现的新增 descriptor 回归测试：4 项失败、7 项通过。失败覆盖 a0-first 布局、字段重排、跨包 SDT 和 provider name 混入。
- 修复后 IQ Crypto 测试：18 项通过，包含原有 sparse AES/CRC 和明文保持测试。
- 本地 Go `TestLivePureGoCurrentKREDecode`：三个真实 4K 片源与一个真实 1080P 片源的单分片下载及 FFmpeg 严格解码通过。
- 本地 Go `TestLiveIQMdcmDescriptorLayouts`：真实 4,638,900 字节加密分片，原始 descriptor 和只改变字段顺序的 descriptor 均下载、解密和严格解码通过。
- IQ 音轨下载、续传与合流相关 Bun 测试上轮合计 25 项通过。

上游 RE 全量测试另有 CLI、网络接口及 HTTPS 失败，原因未逐项确认；该次运行未作为通过验收。针对本次修改的 Crypto 测试和真实分片集成测试单独记录。

## 两个用户问题的状态

1. 第 8 集 `4078712526122100 / tv:800:hevc`：当前本地 TV 会话验证成功，但 DASH 返回 `st=502` 和 `program=[]`，尚未取得该集分片。解析缺陷已修复；该集端到端验收待完成。
2. 附件日志中的 `6532537854937800 / 6:1:500`：原日志失败点为独立音轨第 4/5 段 `aborted`。本地同参数调用当前亦未取得音轨目录。本轮没有修改音轨重试代码，不能声称这个故障已修复。

通用出口检测的直连与本机代理均返回 TW。IQ 域名的本机配置规则仍指向 DIRECT，DASH 的 cached/uip 与通用检测地址不同；这提示需继续核对域名实际路由，但不能仅凭缓存字段断言真实出网国家。

## 复跑

从 `tui/` 运行：

```powershell
$env:PATH = (Join-Path $env:USERPROFILE '.dotnet') + ';' + $env:PATH
dotnet test third_party/N_m3u8DL-RE/src/N_m3u8DL-RE.Tests/N_m3u8DL-RE.Tests.csproj --filter 'FullyQualifiedName~IqMdcmDescriptorTests|FullyQualifiedName~IqBbtsTests'
./scripts/build-managed-re.ps1 -Runtime win-x64 -Install
```

从 `gateway/` 运行，使用本机已有的私有测试会话，不输出 Cookie 或密钥：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:IQ_MDCM_LAYOUT_LIVE = '1'
go test ./internal/provider/iq -run '^TestLiveIQMdcmDescriptorLayouts$' -count=1 -v -timeout 4m
```

macOS 文件使用 osx-arm64/osx-x64 构建，交叉构建成功不等于在 macOS 上实际启动验收。
