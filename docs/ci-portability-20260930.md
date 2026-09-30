# TUI / Electron 最近更新与 CI 修复

日期：2026-09-30（北京时间）。客户端基线 `e62d9b1`；本轮修复发布为 TUI `v0.2.15`、Electron `desktop-v0.1.8`。

## 最近改动

- `2424d11`（PR #15）：暂停/恢复、任务持久化、每任务工作目录、下载管理与桌面 UI。
- `1574ec5`：仅针对已识别 E-AC-3 首帧异常的修复，保留后续完整解码校验。
- `ed8bbd8`：Hami/mewatch 等 provider 适配、账号界面与腾讯观测/诊断；两端共享 `src/lib`。DRM 受保护媒体的端到端支持仍以 `provider-adaptation-20260930.md` 的边界为准。
- `e62d9b1`：优酷 legacy TS PES 解密与版本更新；不放宽普通损坏或完整解码校验。

## GitHub 实际状态

- [TUI main run #85](https://github.com/my-name-is-alan/gvs-tui/actions/runs/36690179523)：Failure。Ubuntu check 的 annotations 与用户给出的 5 个失败吻合。
- [Electron desktop-v0.1.7 run #8](https://github.com/my-name-is-alan/gvs-tui/actions/runs/36690179410)：Success。Windows/macOS 构建、两份 artifacts 和 Release job 已完成。
- 公共页面可读 summary/annotations；本机 gh 未登录，未获取完整 Actions 日志或触发 rerun。不能将 TUI check 失败描述成 Electron 安装包失败。

## 五个失败的原因与修复

1. `re-abort`：POSIX 原 `killTree` 只 SIGKILL 父 PID，留下 RE 的 packager/ffmpeg 子进程。现在 spawn 建独立 process group，取消杀负 PGID。Windows 保留 taskkill /T /F，并等它结束再返回，减少恢复与文件占用竞争。
2. `config`：测试把 Windows 盘符路径当所有平台的绝对路径；Linux `isAbsolute` 正确返回 false，导致错误断言。测试改用宿主平台的绝对临时路径，保留 Windows 驱动选择测试；没有让 Linux 使用 Windows 盘符目录。
3. `workTagOf`：POSIX basename 不识别反斜杠，得到 `C_x_a_4K_video_mp4`。提取 basename 前规范化反斜杠，保留既有 track ID 安全字符规则。
4. 成功下载 scratch 测试：Ubuntu 没有 FFmpeg，`clearFixture` 在生成样本前失败。check job 显式 apt 安装 FFmpeg。
5. 失败下载 scratch 测试：缺 FFmpeg 使下载器未真正运行，空工作目录被正常清理，后续 readdir 变成 ENOENT。同一 FFmpeg 准备步骤保证测试走到实际下载失败路径。

这 5 个失败不在日志尾部列出的腾讯账号、provider-session、Youku QR/TS 测试内。没有删掉失败用例、把它们 skip 或降低断言。MP4Box 原有的条件 skip 属于独立工具可用性检查。

## 本轮验证

- Windows Bun 1.3.14：`bun test src app/src/main` 340 pass、0 fail、1137 assertions、46 files；日志 `.build/ci-review-windows-test.log`。
- Windows 目标失败用例：三个文件 17 pass、0 fail，包含真实本机 HLS 成功下载与 HTTP 500 失败保留 scratch。
- Linux WSL 原生 Bun 1.3.14 musl：config 与取消进程树 13 pass；workTagOf 1 pass。下载的 Bun 和运行库只放 `.build/linux-verification`，未安装或修改发行版运行库。
- TUI TypeScript/Vite 构建通过；Electron renderer/main/preload 类型检查与 electron-vite 构建通过。
- Ubuntu 的两个外部媒体工具集成测试尚未在本机 Linux 环境全跑；FFmpeg 安装补丁仍需推送后由 Actions 验证。本机 Docker daemon 未就绪，未声称完成容器内全量回归。
- 本地修复验收未生成新安装包或移动既有标签；新安装包由 `desktop-v0.1.8` 的 Actions 构建。上面的 Electron 成功状态是已发布的基线版本，不代表新版本已成功。

## 发布边界

本轮独立提交下载取消、路径兼容、FFmpeg CI 准备、报告及两端版本号，推 main 与 `v0.2.15` / `desktop-v0.1.8`。观察 check/windows-source/ui-compatibility 和 desktop 构建结果。既有标签保留；本机诊断脚本、样本和 native 原型不纳入版本。
