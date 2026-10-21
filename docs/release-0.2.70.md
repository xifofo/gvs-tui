# TUI v0.2.70

Apple TV 地区支持：账号地区补上土耳其（`tr`），发现页/榜单支持独立的内容地区。
（v0.2.69 已被 PR #23 的媒体元数据发布占用，本版在其之上。）

## 变更

- **地区列表**：`src/lib/appletvplus-auth.ts` 现在导出 `APPLE_TV_REGIONS`、`APPLE_TV_REGION_LABELS` 与
  `isAppleTVRegion()`，白名单为 `hk / tw / jp / us / gb / au / ca / tr`。导入媒体令牌（`0.…`）时仍需选择账号地区。
- **榜单按内容区拉取**：`Discovery` 增加 `region` 与 `setRegion()`；`browse_catalog` 带 `{ country }`，
  `browse` 带 `section.country || region`；栏目缓存 key 含地区，切换地区会清缓存并重新拉目录。
  与网关 `play/download` 的 `country` 参数配套：**账号地区决定换钥的 delivery service，内容地区决定目录**，
  两者可以不同。
- **回退文案**：Apple TV 目录不可用时的占位改为“目录暂不可用：检查网关 Apple TV 代理（直连 Apple 会 404）后重试”。

## 验证

- `bun test src/lib/appletvplus.test.ts src/lib/discovery.test.ts src/lib/appletvplus-import-quality.test.ts src/lib/provider-session.test.ts`：27 通过
- `bunx tsc --noEmit`：通过
- 新增用例：内容区驱动 `browse_catalog`/`browse` 的 `country`，以及切换地区后的重新加载。
