# 腾讯搜索来源点击详情修正

2026-10-17。本次依据用户截图及本地源码排查，只修改客户端，不请求线上搜索/取流，不部署 gateway，也不操作现有安装进程。

## 现象与本地复现

搜索同名作品合并为一行时，腾讯来源显示“可看”，点击却按标题重新搜索，未打开腾讯详情。

本地找到两条会产生该现象的路径：

- 卡片带腾讯 15 位 cover ID，但旧 target.type=search。共享 cardTarget 原先在末尾无条件保留 search，丢掉可用于详情的 item.id/meta.id/target.id。
- 同一来源先出现关键词建议、后出现有详情身份的节目，mergeSearch 原先仅保留每来源第一条，直接详情会被搜索入口遮住。

原界面还把任何非 unavailable 条目标成“可看”，因此关键词入口被误标成可直接进入详情的片源。截图本身不包含底层返回值，本轮未把上述本地复现当作已采集到的线上原始搜索响应。

## 修正

- 腾讯 legacy search 目标携带符合 CID 形式的 15 位 ID 时，保留该 ID 并打开详情；target.id/meta.id 中的腾讯封面/单集 URL 也解析为对应详情或单视频入口。
- 明确频道、预约、不可用入口不改写；仅有数字排名/关键词标识而无媒体身份的条目仍是搜索。
- 同来源同名节目合并时，直接详情优先于关键词入口；已有两个直接详情仍保持原次序，咪咕 App/TV 的独立来源不变。
- 点击来源芯片始终使用该来源卡片。整行“选集下载”优先选择有详情身份的来源。
- 仅有关键词的来源显示“相关搜索”；整行没有任何详情入口时，按钮显示“查看相关结果”，避免承诺选集下载。

## 验证

- 卡片解析、合并及来源过滤五文件 49 项测试通过。
- 加入既有优酷登录/试看回归后，七文件 64 项通过。
- 发现卡片及链接解析另有 25 项通过，包含腾讯 cover/page 路径和跨平台边界。
- renderer 导航集成测试调用真实 toCards → mergeSearch → openCard → store：从“嫁金钗”的优酷/腾讯合并结果选腾讯，仅调用一次 detail(tencent, CID)，最终 view=detail，优酷保留为备用来源；不触发 searchProvider。
- 导航测试使用本地合成数据，CID 是固定测试身份，不是本轮线上核实的本剧 CID。未执行腾讯真实详情/媒体下载验收。
- 桌面类型检查、Electron 构建通过。

复现与回归（在 tui）：

```powershell
bun test src/lib/card-target.test.ts app/src/main/cards.test.ts app/src/shared/search-merge.test.ts app/src/shared/search-merge-sources.test.ts app/src/main/search-sources.test.ts
bun test src/lib/discovery.test.ts src/lib/link.test.ts
```

renderer 导航测试（在 tui/app）：

```powershell
bun test --tsconfig-override ./tsconfig.web.json ./tests/search-navigation.test.ts
```

本机 Bun 在后一个命令报告 directory mismatch 内部提示，但测试进程正常结束、1 项通过、0 失败；该提示不能当作前端编译验证，因此桌面 TypeScript 与 Electron 构建也单独执行并通过。

## 安装包

使用 `app/release/tencent-search-fix-20261017/GVS-Setup-0.1.64-x64.exe`，包含本次搜索点击修正及前一轮优酷登录/试看/完整性修复。SHA-256：`11944cabf0cefd56e0261aea7737e5d8a761cf8352f2ed515aa7f16a1cf23c33`。包内四个 JS 文件逐一与当前构建比对摘要一致，主进程包含腾讯 CID 恢复，渲染器包含“相关搜索/查看相关结果”，优酷保护仍在。安装包和完整校验清单位于同目录。本次未关闭用户 App 或执行安装，需安装后重新搜索生成新卡片。
