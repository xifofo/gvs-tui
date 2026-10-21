# 优酷登录、产品会员与片源权益判断修正

2026-10-17。本次在本地源码与独立测试环境修正判断，不部署线上网关，不修改用户账号、不再次生成二维码、不反复取流。

## 已确认的问题

用户确认本人的会员已过期。此前对 EP05/06 的新扫码本地测试显示，登录成功并取得凭证，但帧享实际清单仍只有约六分钟。`play` 同时出现 can_play=true、is_vip=true、trial.time=360。此前把这类结果先归因于掉登录、再要求重扫，是不准确的。

既有源码包含几处实质错误：

- 网关 `buildAccountSummary` 用登录时 yktk_vip 提升当前 is_vip；任何产品有效都会提升汇总，且将多个产品的最大到期日作为一个到期时间。
- `walkAccountProfile` 扫描任意 isActive 和未来日期，容易把营销或其他字段混入会员状态；过期 endTime 也没有否决同条记录的残留 isVip=true。
- 客户端把标准摘要与原始 profile 的会员标志做 OR；画质页/账号摘要又将 play.is_vip 当会员确认。
- 桌面切换账号没有清空优酷专有登录与权益摘要；旧查询可以晚到覆盖新账号，请求还可能携带默认账号的旧 Yk-Sign。
- 本机设备会员文件可包含历史多账号，不能用其中任意用户的有效权益证明当前会话会员。

## 当前数据与界面规则

登录：仅明确失效、续期要求重新登录时进入需扫码状态。会员过期和会员查询 SESSION_EXPIRED 不自动等同于 App 登录失效。查询暂不可用或缺少登录标志时是未确认，不能凭空显示已登录或要求重扫。

产品会员：普通优酷、酷喵、帧享分别保留产品名称、产品 ID、有效/已过期/未开通/未确认及独立到期时间。有效期已经过去时优先判过期，不让残留 true 标志推翻。同一端 VIP 有效但 SVIP 已过期，两条都展示；一种产品不授予其他端。不能识别的产品 ID 保留 unknown scope，不猜映射。

当前片源：play.can_play/is_vip 和 DV/4K 标签仅描述响应中的片源标志，不能认证当前账号某种 SVIP 仍有效；仍需试看标志和实际媒体时长检查。过期会员无需通过重新扫码“续费”。

账号隔离：固定请求账号与签名；选择非默认网关账号时不携带默认 Yk-Sign。切换账号先清空旧摘要，使用修订号丢弃迟到的旧查询。设备来源仅接受与当前会话 YTID 相同的产品条目；缺少身份时不借用设备其他账号。

## API 契约

`summary.products[]` 为产品记录，包含 product_id/name/scope/status/active/end_ms/end_at/source。`summary.entitlements.youku|kumiao|frame_xiang` 各自包含 status、known、products。只有一条产品记录时才保留兼容顶层 expire_at；多产品不再用最大的一个日期代表全部产品。

兼容 `is_vip` 只表示至少一条观察到的产品当前有效，不是跨端通行标志。`login_vip_snapshot` 只保留历史信息。空成功回包或不可认证的会员查询返回 unknown，而不是猜成有效或无会员。

## 实际查询的剩余缺口

本轮仅进行一次本地网关的现有会员查询，没有重复取 EP05/06。该查询使用刚扫码的独立凭证及本机隧道；现有 profile 接口返回 SESSION_EXPIRED/服务失败，未返回可靠的产品列表或到期日。离线回放保存的真实回包后，新客户端结果为“已登录；普通优酷未确认；酷喵未确认；帧享未确认”，不再显示会员有效或要求重新扫码。

用户已确认会员过期，但程序不能把用户这一说明伪装成接口查出的产品记录。本轮未证明纯 App 扫码身份可自动查询到任意账号的全部产品有效期；这条经认证的产品查询仍需后续打通。当前修正解决错误归类、过期覆盖、产品混用与假成功，不宣称已完成真实到期日自动查询。

## 证据与回归

E-1：本地 `.build/youku-local-20261017/public-results.json` 和 `playlist-coverage-results.json`，记录新扫码后两集帧享仍为试看清单。它们支撑“登录成功不等于完整片源授权”。

E-2：保存的会员查询回包仅在本地忽略目录，脱敏回放结果为 `.build/youku-membership-20261017/observed-account-replay.json`，支撑“实际产品资料未取得”；不输出 Cookie、签名、手机号或账号 ID。

E-3：Go 产品解析测试覆盖普通 SVIP 有效/OTT 过期、旧快照不提升会员、营销时间不算会员、unknown 产品不授予全部端，以及设备历史账号隔离；优酷和数据面 short 回归通过。

E-4：`TestAccountSummaryClientMembershipFlow` 使用真实 Go 摘要经本地 HTTP 传给实际 GwClient/ykAccount；普通优酷有效、酷喵与帧享过期状态分别保留，且登录仍有效。显式执行通过，非跳过。

E-5：客户端十文件 165 项回归通过，含实际本地媒体、时长截断保护、独立音轨、账号请求头、TUI runtime。后续补充同端 VIP/SVIP 同时展示的产品测试，11 项产品测试全部通过。桌面类型检查、Electron 构建和 TUI 构建通过。

F-1：E-1/E-2 证明此前登录与会员推断不可靠；E-3/E-4/E-5 支撑本轮分层判断实现。真实产品接口尚未获取到期日的缺口不由合成测试关闭。

路径：网关改动在 `gateway/internal/provider/youku/account.go`、`account_entitlements.go`；客户端在 `src/lib/youku-membership.ts`、`youku-session.ts`、`client.ts`、`app/src/main/core.ts`，TUI 显示在 `src/scenes/QualityScene.vue`。未提交、推送或部署。

## 本轮交付

本地 App 安装包：`app/release/youku-membership-fix-20261017/GVS-Setup-0.1.64-x64.exe`，SHA-256 `3fa39d6b0dc9799ffa33069734ffc834205d13eab3ee81de3c7dfd34ea2b238f`。包含之前的优酷分轨/完整性和腾讯搜索详情修正。包内四个 JavaScript 文件与构建逐项摘要一致，三端产品分类、拒绝未知授权、账号修订保护、试看过期提示和完整性检查均已核对。它修正已知误判，不代表实际产品到期查询已经全面打通。

网关改动留在当前源码中，验证用可执行文件为 `gateway/.build/youku-local-20261017/gateway-membership-check.exe`；没有把旧自动画像服务包冒充为包含本轮后端修正的部署包，未推送或部署。
