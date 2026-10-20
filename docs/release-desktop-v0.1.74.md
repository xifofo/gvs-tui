# Desktop v0.1.74

与 TUI v0.2.71 同一份修复：Apple TV「账号区没有该作品」不再显示
「提交的信息不完整或格式不正确」。

## 变更

- 文案表同步到网关最新 73 条，补 `CONTENT_NOT_IN_STOREFRONT` 等 6 个 code；
  桌面端加载同一份 `src/lib/user-message-catalog.ts`，无需单独改动渲染层。
- 新增 `scripts/sync-user-messages.mjs`，避免文案表再次落后网关。

## 配套

网关 v3.9.94 的 Apple TV 跨 storefront 回退：土区账号打开港区/美区作品时，
网关自动换区取资产、仍用账号区 delivery service 换钥，旧客户端也能直接播。

## 验证

- 文案表 73 条、正则全部可编译；
- 与 TUI v0.2.71 同源产物，无渲染层改动。
