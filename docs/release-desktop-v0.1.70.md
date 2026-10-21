# Desktop v0.1.70

配套 gateway **v3.9.90** 及以上（新增 `dengta` provider）。本次只有桌面端变化，TUI 仍为 v0.2.67。

- **追剧日历「发现新剧」改走网关排播**：`Core.calendar()` → `POST /v1/invoke {provider:"dengta", action:"calendar"}`，一次拿到腾讯 / 爱奇艺 / 优酷 / 芒果四家官方排期（每天更新哪几集、几点、共多少集），不再只有芒果一家。平台筛选从硬编码改为按数据派生，类型筛选数据为空时不再占位。卡片带灯塔 CDN 的真实封面。
- **排播条目和订阅的关联**：网关条目只有剧名、没有平台剧集 id，所以用归一剧名（`titleKey`：去空白/标点/书名号/「第 N 季」）对齐本地订阅 —— 已订阅的显示「已订阅」角标，点击直接打开**那条订阅**的详情（用订阅自己的 `provider + showId`）；未订阅的点击带着剧名跳搜索页，搜到即可订阅。
- **「我的追剧」信息更准**：订阅的预计更新时间/集数优先用平台排播的确切值补齐（原来只有「按更新文案推算」），当天没有排播的仍按推算显示并标 `~`。
- **芒果直连排播保留为兜底**：网关未连接或上游失败时，`calendar-source.ts` 继续直连 `playbill.api.mgtv.com`，至少还有芒果一家，不会空白。
- **抓码逻辑一律不进客户端**：灯塔的 appKey / mtop 签名 / cookie 全在网关侧，客户端只做 invoke 与形状映射（`parseGatewayCalendar` / `openTarget` / `titleKey` 三个纯函数，均有单测）。

## 验证（2026-10-19，本机）

- `bun test app/src/shared app/src/main`：**152 通过 / 0 失败**（25 个文件，含新增 `titleKey`、`openTarget`、`parseGatewayCalendar` 用例）。
- `bun run typecheck`（`vue-tsc --noEmit` + `tsc --noEmit`）通过；`bun run build`（tsc + vite）通过。
- gateway v3.9.90 + 本版本 dev 实跑：「发现新剧」按天显示 8 部、四平台、真实封面；已订阅条目点「详情」打到 `mgtv/detail clip:875855` 正常打开；日志 `invoke dengta/calendar days=14 ... ok code=0`。
- 未做整集下载验收。**本期网关不对客户端暴露 `dengta`**：gateway v3.9.90 只是把 provider 落地，任何 key 调它都是 403，所以本版本上线后日历实际仍走芒果直连兜底（用户看到的效果与 v0.1.69 一致）；等排播验收通过、网关按 key 开 `dengta` 之后，这条链路才会自然生效，客户端无需再发版。
