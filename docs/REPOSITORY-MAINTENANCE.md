# 仓库与上游维护

PlutoFish 版以 `xifofo/gvs-tui` 为主要开发、更新和发布仓库。`my-name-is-alan/gvs-tui` 是原版上游，继续从中吸收平台下载、登录、音轨、字幕及界面改进。合入代码后仍由 PlutoFish 仓库构建客户端，发布方式见 [桌面端发布](desktop-releases.md)。

## 远程与分支

| 名称 | 地址 | 用途 |
| --- | --- | --- |
| `origin` | `https://github.com/xifofo/gvs-tui.git` | PlutoFish 主仓库，开发分支和正式代码推送到这里 |
| `upstream` | `https://github.com/my-name-is-alan/gvs-tui.git` | 原版，只拉取更新 |
| `fork`（可选） | `https://github.com/Townley9288/gvs-tui.git` | 保留早期开发分支和历史记录 |

`origin` 为私有仓库，需要具有访问权限的 GitHub 账号。使用本机已有的 GitHub 凭据工具，不把访问令牌写入远程 URL、脚本、文档或安装包。新克隆后，先增加上游并防止误推送：

```sh
git remote add upstream https://github.com/my-name-is-alan/gvs-tui.git
git remote set-url --push upstream DISABLED
git config remote.pushDefault origin
```

`main` 跟踪 `origin/main`。本仓库直接提交源码到 `main`，由 GitHub Actions 自动检查并构建安装包，不要求创建 PR。需要隔离开发时可以先使用 `codex/` 分支，验证后把提交合入本地 `main` 再推送。更新前先检查 `git status`，提交已有修改；不要用其他仓库的文件或安装包覆盖正在维护的版本。

多个 worktree 共用远程配置和分支引用，但每个 worktree 的工作文件、当前分支和未提交改动彼此独立。调整远程时保留其他工作目录使用的分支，不切换或重置它们的文件。

## 获取原版改进

先从 PlutoFish 最新主分支创建集成分支，再查看上游相对于当前版本新增了什么。下面的分支日期按实际更新日期填写：

```sh
git fetch origin
git fetch upstream
git switch main
git merge --ff-only origin/main
git switch -c codex/upstream-sync-YYYYMMDD
git log --oneline HEAD..upstream/main
```

需要上游的一整批改进时，在集成分支执行 `git merge upstream/main`，保留共同历史，方便后续同步。只需要独立修复时，用 `git cherry-pick <commit>`，同时检查依赖提交和相应测试。两种方式按改动范围选择，不把 `main` 强制重置为上游。

发生冲突时同时保留平台基础功能和 PlutoFish 接入要求，特别核对 [维护边界](PLUTOFISH.md#维护边界) 中的入口，以及任务、命名和发布状态：

- GVS 与 PlutoFish 双重鉴权、源账号绑定及 IPC 检查。
- 下载与上传进度、任务恢复、失败断点和历史记录。
- 自动上传关闭时的本地下载、已有任务的手动上传策略。
- 文件命名、季集号、S00 版本选择和改名后成品关联。
- 上传核验、资源登记和本地成品保留。

上游改动若确实改变这些行为，应明确说明取舍并补充对应验证。

## 验证与合入

按改动运行平台测试和 PlutoFish 回归。共享命名或任务流程变化时，可使用：

```sh
bun test src/integrations/plutofish src/lib/config.test.ts src/lib/jobs.test.ts src/lib/output-naming.test.ts src/runtime.test.ts app/src/shared/job-transfer.test.ts app/src/main/history-db.test.ts app/src/main/job-updates.test.ts app/src/renderer/src/job-updates.test.ts
cd app
bun run typecheck
bun run build
```

涉及画质、发布表单或任务界面时，再运行对应的隔离 Core／UI smoke；命令见 [PlutoFish 接入说明](PLUTOFISH.md#验证)。测试使用临时配置和模拟接口，避免将真实下载、上传、账号设置当作测试数据。

验证后先拉取 `origin/main`，将最新主分支与已验证的提交合入本地 `main`，然后直接推送 `main`，无需 PR。提交说明写明改动内容和必要的验证结果。推送会自动触发 TUI 检查及桌面端安装包构建，产物在 Actions 中保留 14 天。正式发布仍按发布流程更新版本并推送 `desktop-v*` 标签；普通源码提交不会自动创建 Release。
