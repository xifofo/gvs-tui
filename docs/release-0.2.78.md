# TUI v0.2.78

配套网关 **v3.9.108**。这一版只改**上游请求通道**：tx / yk 的 API 请求默认走 HTTP/2。

## 变更

- 隧道对 `.youku.com` / `.qq.com` / `.atianqi.com` 默认走 `node:http2`；**失败自动回落 h1.1**，可用性不受影响；
- fake-IP 路径（Clash）保留「真实 IP + 域名 SNI」，同样进 h2；`dial()` 补上 `ALPNProtocols`（原来是「无 ALPN」）；
- 开关：`GVS_TUNNEL_H2=0` 整体关闭；`GVS_TUNNEL_H2_HOSTS` 改白名单；`GVS_TUNNEL_H2_INSECURE=1` 仅本地测试；
- 新增 `scripts/fingerprint-probe.ts`：三臂量 JA3 / ALPN（裸 fetch / 隧道 localFetch / node:tls）。

## 为什么

实测隧道出口原来只声明 `http/1.1`（fake-IP 路径连 ALPN 都没有），而 tx / yk 的真实客户端
（OkHttp / TTNet）都声明 h2。基准与复测数据见网关仓库
`docs/analysis/fingerprint-baseline-20261023.md`。

注意：JA3 只哈希扩展编号、不哈希 ALPN 值，所以「JA3 相同」不代表「协议相同」；
这次改动的收益要在实网 A/B（punish 页 / 429 / em=93 分布）里看。

## 验证

```
bun test src/lib/tunnel-h2.test.ts src/lib/tunnel.retry.test.ts src/lib/tunnel-policy.test.ts
# 7 pass / 0 fail
```
