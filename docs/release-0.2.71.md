# TUI v0.2.71

修复 Apple TV 一个误报：账号所在区目录里没有该作品时，界面显示
「Apple TV：提交的信息不完整或格式不正确」——输入没问题，是网关把「该区没上架」
错误归类成了参数错误。

## 变更

- **文案表重新同步**：`src/lib/user-message-catalog.ts` 由网关
  `internal/usermsg/catalog.json` 重新生成（73 条），补上 6 个缺失的 code：
  `CONTENT_NOT_IN_STOREFRONT`、`DRM_LICENCE_REJECTED`、`LICENCE_REQUIRES_PLAY`、
  `PLAN_EXPIRED`、`UPSTREAM_EMPTY_BODY`、`UPSTREAM_NO_MEDIA`。
- **同步脚本归位**：新增 `scripts/sync-user-messages.mjs`（原文件缺失，导致快照漂移）。
  支持参数 / `GVS_GATEWAY_CATALOG` / 同级 checkout / `~/Code` 自动查找，并校验每条规则的
  `pattern`/`code`/`message` 完整，避免半截文案被发出去。
- 新增文案：`该作品在你账号所在地区暂未上架，请在客户端切换地区后重试；若仍失败，请联系客服。`

## 配套

网关 **v3.9.94**：Apple TV 作品请求按「请求区 → 账号区 → 上次命中的区 → 固定顺序」跨 storefront
回退，只有 404 换区（401/403/5xx 原样抛出并保留诊断），`detail` 与 `play/download` 共用；
土区账号打开港区/美区作品不再报「信息不完整」。

## 验证

- 生成结果：73 条规则，全部 `pattern` 可编译为正则；`CONTENT_NOT_IN_STOREFRONT` 已在表中。
- 文案表与网关 `internal/usermsg/catalog.json` 逐条一致（同一份 JSON 序列化）。
