# Desktop v0.1.75

与 TUI v0.2.71 同一份修复：Apple TV「账号区没有该作品」不再显示
「提交的信息不完整或格式不正确」。

## 变更

- 文案表同步到网关最新 **74** 条，补 `CONTENT_NOT_IN_STOREFRONT` 等规则；
  桌面端加载同一份 `src/lib/user-message-catalog.ts`，渲染层无需改动。
- 新增 `encoder not found` → `MEDIA_FORMAT_UNSUPPORTED` 规则，避免把
  `Encoder not found` 报成「未找到所需内容」。
- 新增 `scripts/sync-user-messages.mjs`，文案表不再手改、不再落后网关。

## 说明

v0.1.74 的构建在本次修复前触发，其草稿 Release 未发布，保留不用。

## 验证

- 文案表 74 条、`pattern` 全部可编译为正则；逐条幂等（与网关 `Message()` 行为一致）。
