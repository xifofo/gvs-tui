# 腾讯原生事件本地模板（免手机运行时）

本目录是 **一次研究采集后固化的事件形状模板**，供 TUI 在无 adb/Frida/手机 时做本地验证与采集重放。

| 文件 | kind | 说明 |
|------|------|------|
| watch.json | watch | 单条观看进度骨架；装载时刷新 date/played/update |
| qimei.json | qimei | 原生 `native` 输入骨架；装载时刷新 tm |
| getfeature.json | getfeature | start_up 骨架；缺完整 SDK 特征时网关 preview 可标 incomplete |
| bosskv.json | bosskv | 最小指标骨架；需网关配置 collector 才完整 |
| README 备注 | adlog | 需真实广告画像与 cookie，不提供可发送模板 |

**运行时不要插手机。** 手机/Frida 仅用于研究侧更新本模板（见 gateway `scripts/research/`）。
