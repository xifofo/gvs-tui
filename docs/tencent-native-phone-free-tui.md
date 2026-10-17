# 腾讯原生协议研究：免手机模板回放

2026-10-16 更新：本功能是隔离研究入口。普通 App/TUI 使用不需要手机、采集器、JSONL、模板或发送模式配置，操作记录默认自动处理。当前产品行为与验收范围见[接入说明](tencent-native-business-flow-20261015.md)。

## 使用范围

研究侧一次采集或更新模板后，可在隔离进程中检查 Go 组包和响应解密。显式设置 `GVS_TENCENT_NATIVE_RESEARCH=1` 后，配置中的 `tencentNativeEventCollect=fixture` 才会启用模板生产者；模板从 `fixtures/tencent-native-templates/` 加载，并写入研究配置指定的文件。普通账号设置已经移除这些控件。

模板回放始终只预览，即使旧配置保存了 `tencentNativeEventMode=send`，也不会发送模板事件。记录中的日期、ID 和 GUID 摘要更新仅用于测试新鲜度与绑定检查，不构成真实观看或设备遥测证据。

CLI 的 `scripts/tencent-native-fixture-feed.ts` 继续可用于研究装载；`scripts/tencent-native-gateway-flow.ts` 是隔离本地集成探针，会显式开启研究入口，不加载用户配置。外部实际生产者文件使用 collect=file，仍须校验账号、网关、设备、来源与送达状态。

## 已知边界

- 普通产品已实现自动画像生成和 Qimei 注册，本模板回放仍是研究入口。腾讯实网接收验收尚未完成；操作观测、模板回放或本地联调均不等于腾讯线上接收。
- `watch` 模板不表示用户实际观看；下载字节和下载耗时不会转换成观看时长。
- `adlog` 需要实际广告画像；`bosskv`、`getfeature` 的缺失字段不能靠模板证明真实发生。
- 手机、adb、Frida 仅属于研究侧。普通客户端不会要求用户安装或连接这些工具。
