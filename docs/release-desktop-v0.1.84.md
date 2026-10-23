# Desktop v0.1.84

在 v0.1.83（Crunchyroll 一键登录）之上，把 CR 的画质页接上网关新加的 `qualities` 动作：
**选片阶段就能看到真实档位**，不再是唯一一条「自动（最佳画质）」。

## 改进

- Crunchyroll 画质列表改调网关 `qualities`（只读源站 DASH 清单、**不换钥**）：
  - 每档显示分辨率 / 码率 / 编码（如 `1080p · 7061 kbps · avc1.640028`）、帧率；
  - 音轨按源站清单列出（`ja-JP · 199k` 之类），默认选中第一条；
  - 网关 < v3.9.106 或本次探测失败时，自动退回单条「自动（最佳画质）」——下载行为不变，
    仍由下载器在同一条 DASH 清单里自选，不会因此下不了。
- 顺带把 CR 的下载/探测错误提示对上新的错误码：`DRM_LICENCE_REJECTED`（含
  `diagnostics.licence.error_code=4035`）、`DRM_CLIENT_DEVICE_REQUIRED`、
  `CRUNCHYROLL_TOKEN_REQUIRED` 现在都能直接看出是「设备证书被拒 / 没传设备文件 / 没令牌」，
  不再是「服务暂时不可用」。

## 配套

- 网关 v3.9.106：CR 新增 `browse_catalog` / `browse_section` / `qualities`，修 `detail` 空壳、
  海报、分集时长、同名两版区分，并把换钥失败从通用 503 改成带拒绝码的精确错误。
- 下载仍需本人 Widevine **L3** `.wvd`：实测 23 台 L1 全部被源站 `4035` 拒绝，已吊销的公开 L3
  同样被拒；未被吊销的 L3 可正常换钥（`resolve download=1` 返回内容密钥）。

## 验证

- `bun test src/lib/manifest-provider.test.ts`：13 项通过（新增 2 项：档位来自网关清单 / 旧网关退回自动）。
- `bun run build`（`tsc --noEmit` + vite build）通过。
