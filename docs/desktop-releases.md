# GitHub Actions 桌面端发布

安装包由本仓库的 `desktop` 工作流构建，发布到 `xifofo/gvs-tui` 的 GitHub Releases。Windows x64 使用 NSIS，macOS 同时生成 arm64 和 x64 DMG。桌面版使用 `desktop-v*` 标签，与 TUI 的 `v*` 标签独立，不占用 TUI 的 Latest。

## 正式发布

1. 更新 `app/package.json` 的版本，将本次发布说明写入 `docs/release-desktop-v<版本>.md`（缺少时由 GitHub 生成说明）。先完成版本涉及的源码检查、提交和推送。
2. 在要发布的提交上创建 `desktop-v<版本>` 标签并推送到 `origin`。例如包版本为 `0.1.90` 时，标签必须为 `desktop-v0.1.90`；工作流不会偷偷改写包版本。
3. Actions 安装锁定依赖，构建本地 IQCN、维护版 RE，执行类型检查和离线回归，然后分别构建 Windows 和 macOS 安装包。
4. 两个平台都成功且安装包、Windows blockmap、更新清单齐全后，统一上传到草稿 Release，再公开该 Release。附带 `SHA256SUMS.txt`。任一构建失败都不会发布不完整版本。

发布只使用当前仓库自带的 `GITHUB_TOKEN`，只有发布 job 具有 `contents: write`。无需新增 PAT 或提供发布端、网盘凭据。代码签名仍未配置。

## 手动构建与失败恢复

在 Actions → desktop → Run workflow 选择分支，可只构建安装包；产物在该次运行的 Artifacts 中保存 14 天，不创建 Release。对已存在的桌面标签执行工作流会走正式发布。

失败后可重跑工作流；草稿附件可重新上传。已公开的版本禁止覆盖，需要递增版本并使用新标签。相同 ref 的构建按顺序运行，不会在发布过程中被新运行取消。

## 下载与更新地址

客户端更新发现、更新清单都使用 `xifofo/gvs-tui`，拒绝上游仓库发布链接，避免将 PlutoFish 版替换成上游版。

当前仓库为私有仓库，Release 附件需要具有仓库权限的 GitHub 账号登录后下载。客户端的匿名更新检查不能读取私有 Release；本次没有将 GitHub token 放入安装包，也没有建立公开更新服务。需要面向无仓库权限用户自动更新时，应另行配置公开发布仓库或受控更新服务。

工作流依据 [GitHub Artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data) 在构建与发布 job 间传递产物；generic 更新源需要自行上传安装包与更新清单，见 [electron-builder v26 发布说明](https://www.electron.build/v26/docs/publish/)。
