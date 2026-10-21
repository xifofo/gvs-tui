# IQ 国内 Cookie 与 CDN 策略接入（2026-10-17）

## 使用方式

更新 gateway 与客户端后，在桌面 IQ 账号抽屉打开「IQ / 国内爱奇艺 Cookie 会话」。国内 Header 选择「国内爱奇艺（iqiyi.com）」再保存；Netscape 导出可选择自动识别。导入不会覆盖已保存的海外会话，Cookie 由网关按当前 Key/账号保存。

同一面板可选择自动测速、Akamai、BSCloud 或 Zenlayer。CDN 选择只使用源站给当前物理文件签发的地址；无该节点或已失败时切换候选。每个地址保留原签名和文件路径，只改变分片 byte window。

TUI 的配置字段为 `iqCdn`，默认 `auto`。国内旧式分片需要 RE IQ.3，工作区 Windows 工具已更新；Mac arm64/x64 是交叉构建产物，尚需在 Mac 上运行验收。没有发布桌面安装包或部署远程网关。

## 实现范围

- gateway：隔离国内/海外 Cookie、国内 Web/Puma 请求签名、国内 identity 与当前票据处理、内嵌 M3U8、精确单集/画质检查、来源固定、CDN 偏好和完整签名保留、音频 dispatch 文件身份校验。
- 客户端：保存 Cookie 来源、保存 CDN 偏好、同来源音轨与重试、官方候选中优选和失败切换、国内音轨名称不套用海外 ID 修正规则。
- RE：从参考脚本补充完整 `a0|v(32hex)|e1|f(6hex)` 旧式描述，拒绝未知模式、残缺描述和冲突内容标签。

## 验证与限制

- IQ/IQCN Provider 与真实 dataplane 包 Go 测试通过。
- 客户端 IQ/CDN/下载/续传/合流/凭据迁移：52 项通过。
- 桌面 vue-tsc / tsc 检查通过。
- RE IQ Crypto 专项：19 项通过。
- 国内 CK 实测 `5114308636194200`：3840×1608、IQ_BBTS、当前票据密钥取得成功；2,088,304 字节视频分片下载并严格解码通过。
- 国内 CK 实测 `4078712526122100 / tv:800:hevc`：仍为源站 `st=502、program=[]`，未取得第 8 集视频分片。没有把对照片源的成功当作该集通过。
- 本次没有把参考脚本的 PhantomJS/cmd5x 浏览器签名执行器引入 Go 服务。实现的是纯 Go 国内 Web/Puma 路径及 CDN 策略。

## 复跑

在 gateway 目录运行（私有会话保留在原位置，不输出凭据）：

```powershell
$env:IQ_DOMESTIC_LIVE_DIR = 'G:/hongguo_handoff/gateway/runtime/iqcn-live-20261009-validation'
$env:IQ_DOMESTIC_LIVE_TVID = '5114308636194200'
$env:IQ_DOMESTIC_LIVE_MEDIA = '1'
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
go test ./internal/provider/iq -run '^TestLiveIQDomesticCookieEpisode8$' -count=1 -v -timeout 4m
```

将 `IQ_DOMESTIC_LIVE_TVID` 改为 `4078712526122100` 可复跑第 8 集；测试不会悄悄改用另一集或较低画质。实时结果保存在 gateway/.build/iq-reported-20261017/domestic-episode8.log 与 domestic-control-download.log。
