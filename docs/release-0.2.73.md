# TUI v0.2.73

新增 **Crunchyroll** 平台（导入 refresh_token + 本人 Widevine 设备文件），下载走本机直连 CDN；
顺带把 Apple TV 下载收尾的整片解码校验去掉，并合入画质体积显示。

## 新增：Crunchyroll

- **登录**：设置 →「CR 令牌」粘贴本人 `refresh_token`（长期有效，等同账号），导入时调网关真实换一次 token 校验；
  留空即清除。网关**不落盘**该令牌，只存本机配置。
- **取流**：`series → seasons → episodes` 三跳自动拼成完整分集；画质给一条「自动（最佳）」——
  不为了列画质去换钥（换钥按次计费）。
- **下载**：`resolve(download=1)` 让网关换好内容密钥并签发约 1 小时的 access token，
  本机 N_m3u8DL-RE 直连 CR CDN（媒体流量**不经过网关**）。
- **设备文件**：CR 换钥需要本人 `.wvd`（L3 起）；设备入口复用 `client.drmUpload`（`PUT /v1/drm/devices/{system}`）。

获取 refresh_token 的步骤见网关仓库 `docs/crunchyroll-refresh-token.md`
（浏览器 DevTools 过滤 `auth/v1/token`，或 `scripts/crunchyroll_refresh_token.py` 校验）。

## 其他

- **去掉下载后整片解码校验**：4K 上耗时几分钟、收益低（密钥错全片坏，抽样也抓得到），
  下载完成即发布成品；黄果那条校验保留（它是换模式重试的依据）。
- **画质体积**：合入社区 PR #24（按码率×时长估算，标题标注「体积按码率和时长估算」），
  与既有的音轨/字幕列表共存。
- **芒果多季**：网关 v3.9.99 起详情返回全部季，TUI 按 `episode.season` 分组展示。

## 配套

网关 **v3.9.99**（CR download 模式 + 芒果全季）。旧网关能连，但 CR 下载需要 v3.9.99。

## 验证

- `bun test src/lib/appletvplus-download.test.ts src/lib/provider-session.test.ts`：26 通过
- `tsc --noEmit` 干净
