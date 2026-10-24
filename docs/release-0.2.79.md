# TUI v0.2.79

Crunchyroll 登录改为**自动网页会话登录**：设置里填一次邮箱/密码，TUI 驱动本机 Chrome 拿到
`etp_rt`，网关按网页会话换 token 取流。不再需要手抄 refresh_token。

## 背景

CR 的 SSO 设备授权页（`sso.crunchyroll.com/authorize`）对当前 client_id 只渲染 loading，
拿不到授权码；password grant 也已被服务端废弃。可用路径是网页登录态 `etp_rt`，
网关 v3.9.111 起支持 `crunchyroll.session` / `CR_ETP_RT`。

## 改动

- 设置页新增 **CR 网页会话**：
  - 回车 → 输入邮箱 → 输入密码（掩码）→ 自动打开/复用 Chrome、填表、读取 `etp_rt`；
  - 也可以直接粘贴 `etp_rt` 保存；
  - 保存后调用网关 `crunchyroll.login` 校验一次；
  - 留空再次回车 = 重新登录；粘贴空串保存 = 清除。
- 拉流时 `session` 优先于 `refresh_token`（旧配置继续可用）；
- 自动登录用独立 profile 的 Chrome（`~/.cache` 临时目录），不打扰正在用的浏览器；
  若 9222 调试端口已在跑则直接复用。
- 凭据只在自动登录的一次调用里使用，不保存、不写日志；保存的只有 `etp_rt`。

## 验证

- 新增 `cr-login.test.ts`（9 例）：cookie 提取、表单就绪判定、脚本转义、
  调试端口复用、参数校验；
- 新增 `crunchyroll-session.test.ts`（5 例）：session 优先传参、回落 refresh_token、
  没凭据报错、网关 login 校验走 session；
- `tsc --noEmit` 通过；本机对已登录 Chrome 实测自动登录返回 36 字符 `etp_rt`。

## 回滚

- 不填 CR 网页会话，继续用「CR 令牌」的 refresh_token 即可回到旧行为；
- 版本回退：`v0.2.78`。
