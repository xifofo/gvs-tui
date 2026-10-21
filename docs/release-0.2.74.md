# TUI v0.2.74

配套网关 **v3.9.100**：修 Apple TV 下载 `-1021`，优酷未绑定的提示改清楚。

## 修了什么

- **Apple TV 换钥范围收敛**（网关侧）：上一版为了多配音，对每条音频 playlist 都发起换钥，
  源站对非默认配音返回 `status=-1021 errorCode=-42191`，整单下载失败。
  现在只取「视频 + 默认配音」两条 playlist 换钥（同档位各语言共用一个 KID），
  其余配音仍可在下载选项里选。
- **优酷未绑定**：网关把 `Yk-Sign header or yk_sign param required` 映射成明确文案
  「当前 Key 还没绑定优酷账号：请在设置里扫码登录优酷后再试」，不再显示成“输入格式错误”。

## 配套

网关 v3.9.100（必须先升级，否则 Apple TV 下载仍会 -1021）。

## 验证

`bun test src/lib`（用户文案用例）通过；文案表由 `scripts/sync-user-messages.mjs` 从网关同步（75 条）。
