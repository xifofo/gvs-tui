# Desktop v0.1.83

在 v0.1.82（优酷无音轨回退）之上，新增 **Crunchyroll 一键登录**：点一下就跳官方登录页，
登录完自动把令牌存到本机，不用再去浏览器 DevTools 里手抓 refresh_token。

## 新增

- 平台账号 → Crunchyroll → **一键登录（自动获取令牌）**：
  - 主进程生成 PKCE(S256)，向网关 `sso_start` 换授权地址；
  - 在独立 session（`persist:cr-sso`）的登录窗里打开 `sso.crunchyroll.com/authorize`；
  - 登录完成后 CR 回跳 `crunchyroll://auth?code=…`，客户端在窗口内拦截取出授权码；
  - 调网关 `sso_finish` 兑换，`refresh_token` 直接写入本机配置（网关不落盘）。
- 登录窗命中回跳后不再秒关：切一张状态页显示「登录成功／登录未完成（附原因）」再自动关闭。
- 账号状态改为读**本机令牌**并走一次网关 `login` 真校验：无令牌 / 有效 / 已失效三种结果。
- 退出登录会一并清掉 `persist:cr-sso` 的 CR 会话，换账号时能回到真正的登录页（此前会秒回跳旧号）。

## 修复

- `will-navigate` 之外的补充捕获路径（`will-redirect` / `did-navigate` / `did-fail-load`），
  自定义 scheme 回跳不再依赖单一路径。
- `loadURL` 的 `ERR_ABORTED(-3)` 曾被当成致命错误：已登录状态下 CR 秒回跳时会把
  「已经抓到授权码」误判成「授权页打不开」。
- SSO 结果字段 `message` → `note`：`userFacing()` 会把 `message/msg/hint/reason/summary`
  当错误文案改写，导致**登录成功却显示「操作暂时未能完成，请稍后重试…」**。

## 配套

- 网关 v3.9.92 起支持 Crunchyroll，本次新增 `sso_start` / `sso_finish` 两个动作
  （见网关仓库 `internal/provider/crunchyroll/auth.go`）；
- 下载仍需要本人 Widevine `.wvd`（实测 L3 可用，L1 被源站 4035 拒绝），内容最高 1080p。
