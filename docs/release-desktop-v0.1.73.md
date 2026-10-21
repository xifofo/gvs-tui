# Desktop v0.1.73

Apple TV 账号地区与榜单地区补上土耳其（`tr`）。
（v0.1.72 已被 PR #23 的媒体元数据发布占用，本版在其之上。）

## 变更

- `app/src/renderer/src/components/ProviderAccounts.vue`：账号登录的“账号地区”下拉新增 `tr`（土耳其），
  与网关 `appletvplus` 支持的地区一致（`hk / tw / jp / us / gb / au / ca / tr`）；导入媒体令牌时写入
  `itua=TR; media-user-token=…`。
- `app/src/renderer/src/views/Discover.vue`：发现页的“榜单地区”下拉新增 `tr`。该下拉以 `country`
  透传给网关的 `browse_catalog`/`browse`。

## 说明

账号地区与内容地区可以不同：账号地区决定换钥使用的 delivery service，内容地区决定目录。
网关侧 `play/download` 已支持 `country` 参数，桌面端按栏目返回的 `country` 透传。

## 验证

- `vue-tsc --noEmit`（tsconfig.web.json）+ `tsc --noEmit`（tsconfig.node.json）：通过
- `bun test app/src/main/appletvplus.test.ts`：通过
