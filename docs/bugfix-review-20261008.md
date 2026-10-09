# 腾讯下载与 CK / 黄果修复复核

日期：2026-10-08。工作区：`G:\hongguo_handoff\tui`、`G:\hongguo_handoff\gateway`。
本次在已有未提交改动上修正，之后按用户要求在独立发布目录提交并推送。开始时 TUI HEAD 为 `ddd6aff`，网关为 `93e9b78`。初始源码差异留在 `G:\hongguo_handoff\work\fix-tencent-review-20261008` 的 `*-before.patch`。

## 发布记录

- 网关 `v3.9.36` / main：`7fd8d1e1ff0af32cc7a3c87506b118bf1f9900fb`。
- TUI `v0.2.29`、桌面 `desktop-v0.1.24` / main：`330d8428a395785b64440df312a13a824d0138c5`。
- 两个仓库分别原子推送 main 和所属标签，远端 main 与标签 peeled ref 均已确认。
- 独立发布目录客户端全量复验 512 通过、6 跳过；媒体异常 4 项通过；网关相关离线测试、三个入口编译、TUI 与 Electron 构建/类型检查通过。
- 发布复验修正了 TMDB 和 Range 续传测试的时序假设，断言未放宽。其他原有未提交工作保留。
- 云端已核验全部成功：网关 release `37740589417`、main GHCR `37740589489`、tag GHCR `37740589400`；TUI 标签检查 `37740595301`、main 检查 `37740595516`；桌面 release `37740595090`。
- 网关五种平台更新包及 SHA256SUMS 已上传。桌面 Windows 安装包、arm64 / x64 DMG、blockmap 与更新清单已上传，在线 Windows `latest.yml` 的版本确认是 `0.1.24`。
- 发布地址：网关 `https://github.com/my-name-is-alan/get_video_streaming/releases/tag/v3.9.36`；桌面 `https://github.com/my-name-is-alan/gvs-tui/releases/tag/desktop-v0.1.24`；TUI `https://github.com/my-name-is-alan/gvs-tui/releases/tag/v0.2.29`。
- 先更新网关，再更新客户端；未替用户部署到正在运行的服务器。原主工作区仍保留已有未提交改动，发布提交保存在独立 worktree。

## 用户反馈对应的修复

日志确认 MAXPLUS 下载与重试请求都发出，但实际版本未确认仍继续下载。截图中的 1080p / 三分钟视频属于用户提供的复核结果，本机没有其 Mac 成品或播放列表副本，未复现其源站取流。

- 任务保存所选视频宽高、帧率和动态范围，并保留分集时长。编码选择通过 `rendition_persona` 请求；它只修改已知编码能力与字幕参数，不修改已登录设备身份，不对 IMAX 应用。
- 网关只根据实际返回视频文件名与本次目录编号的匹配绑定地址和编号。目录存在某一档位、请求某一编号都不能证明实际得到它。
- 客户端不再让单纯的字幕匹配选中另一画质/编号；已确认版本不同，或精确编码无法确认对应地址时停止。
- 下载后以 FFmpeg 读取媒体包的真实覆盖时间，比较视频、每条音轨和已知分集时长。正常编码尾部允许 10 秒或 3% 的误差；真实短剧不会因为时长短而直接失败。
- 检查实际分辨率、帧率、HDR；封装后再次比较各轨覆盖。隐藏临时文件通过验收后才移为正式成品。失败保留源字节，避免把长音轨撑起来的容器时长当成视频完整性。
- 视频版本记录不再以容器总时长填充缺失的视频时长；增加不含完整 CDN URL 的选择和验收日志。

源站继续决定画质、会员权益与完整流是否可用；此补丁不会把试看流提升为完整 MAXPLUS。`tvskey_attached=false` / `playback_verified=false` 是当前网关的固定能力声明，不是本次鉴权失败的检测结果。

## 今日改动中发现并修正的问题

- CK 迁移不再用宽泛的 `invalid` / `not found` 匹配清空本地字段。只有明确的导入、持久化或绑定确认才清空；旧网关、错误 Key、离线、写盘失败都保留原值。
- TUI / Electron 粘贴凭证等待确认后才提示成功；连接切换、慢迁移或导入失败不会误清新值。新扫码成功时清除旧本地凭证，避免旧签名继续覆盖新登录。
- 优酷显式续期、自动续期、授权失败重试都更新本 API Key 的绑定凭证；未绑定的租户不借用全局账号。无租户的本地工具仍保留原全局路径。
- 优酷从旧路径恢复已加密会话时先解开再封装，避免二次加密后第二次读取丢登录态。
- 加密主密钥只首次创建；已存在但不可读/损坏时阻止启动，拒绝自动覆盖。并发启动使用排他创建，不能各自生成不同主密钥。腾讯新迁移备份同样加密，已有历史备份不重写。
- IQ / Hami 在选择最新副本之前验证并解密，避免坏文件覆盖有效数据库副本；重启恢复正确标记已持久化。持久化状态采用原子读写。Hami 串行写盘，只读取当前请求持有会话锁的字段，保留其他租户的不可变快照。
- 黄果重复密钥 URI 但不同 IV 也走逐段解密；旧网关只返回 hex 时保留原有效密钥。缺少概况时交给原始清单解析，不强行删密钥行当明文。JSON/HTML 错误和超长 hex 不再被截成假 AES 密钥，不支持的加密方式明确失败。

发布工作流、Docker / Widevine 说明中更早的未提交改动未回滚，也未作为本次 CK / 黄果修复发布。

## 验证

- `bun test`：515 通过、8 跳过、0 失败。布局用例的固定 70ms 等待曾偶发失败，已改为等待详情快照就绪，再次全量通过。
- `GVS_MEDIA_TESTS=1 bun test src/lib/tencent-output.test.ts`：4 通过，包括真实 MKV 中 1 秒视频与 15 秒音频的拒绝验收。
- TUI `bun run build`、Electron `bun run typecheck` / `bun run build` 通过。
- 网关 Tencent、Huangguo、IQ、Hami、secrets、app 套件及优酷选定的离线会话/续期测试通过。覆盖主密钥不覆写、三个优酷续期入口、加密旧路径连续读取、坏文件由数据库救回、Hami 两租户并发导入。
- 网关 gateway / apiserver / console-server 编译通过，相关业务源码 `go vet` 通过。优酷历史研究测试有已有重复 JSON tag，生产源码单独检查通过。
- GitNexus 已刷新并执行影响和变更分析。播放/会话/启动路径有 HIGH / CRITICAL 风险；图谱存在调用解析及流程截断，不能以未列出的路径推断无影响。

## 联网研究测试的误触发

第一次扩大网关套件时误触发优酷目录里未隔离的历史联网研究用例，包括登录探测；随后改为仅执行已核对的离线用例。联网失败未作为此补丁的回归结论，也没有把它们当作用户取流复现。

正式 `G:\hongguo_handoff\gateway\data\youku_session.json` 的修改时间仍为 2026-09-29，未被改写。下列研究输出被旧测试更新，原内容没有本次运行前快照可恢复，未继续覆盖或删除：

- `G:\hongguo_handoff\gateway\internal\provider\youku\data\youku_session.json`
- `G:\hongguo_handoff\downloads\dongcheng_play_lanes.json`
- `G:\hongguo_handoff\work\youku-avmp-ckey\evidence\live_dump\ups_quality_list_ep1.json`

验证文件、构建和初始源码差异位于 `G:\hongguo_handoff\work\fix-tencent-review-20261008`。没有记录或复制用户 Cookie、CDM 或真实内容密钥到本说明。
