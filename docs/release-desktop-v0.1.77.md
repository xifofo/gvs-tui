# Desktop v0.1.77

与 TUI v0.2.73 同一份改动（共用 `src/lib`）：新增 Crunchyroll 账号区块、去掉下载后整片解码校验、
合入画质体积显示。

## 变更

- **平台账号 → Crunchyroll**：粘贴本人 `refresh_token` → 「导入令牌」（会调网关真实换一次 token 校验）；
  「账号状态」「退出」齐全。令牌写入共享配置 `crunchyrollToken`，网关不保存；退出即清空。
- **下载**：网关 `resolve(download=1)` 返回 access token + 内容密钥，本机直连 CR CDN 下载解密，
  媒体流量不经过网关。
- **去掉整片解码校验**：Apple TV / DSNP 类下载收尾不再整片解码，成品直接发布。
- **画质体积**：合入 PR #24，按码率×时长估算并标注。

## 配套

网关 v3.9.99。

## 验证

- 与 TUI 同源改动；`tsc --noEmit`（node 侧）干净，模板由 desktop 构建的 `vue-tsc` 校验。
