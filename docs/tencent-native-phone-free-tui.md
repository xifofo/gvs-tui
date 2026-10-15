# 腾讯原生事件：TUI 全流程验证（免手机运行时）

用户决策：**全部在 TUI 验证、要支持采集、日常使用不允许再插手机。** 手机/adb/Frida 仅用于研究侧一次采集/更新模板。

## TUI 怎么开（不插手机）

1. 本地网关（推荐）  
   - `GVS_HOST=http://127.0.0.1:8080`（或设置里把网关改成 `http://127.0.0.1:8080`）  
   - 网关已登录同一 TV 会话；`腾讯 TV 设备 ID` 与会话 `device_id` 一致。
2. 设置 → **腾讯原生事件采集** → 回车切到 **本地模板 · 免手机**  
   - 自动：打开观测绑定、模式=预览、写入默认 JSONL（`%APPDATA%/gvs/tencent-native-events.jsonl`）  
   - 立刻从 `fixtures/tencent-native-templates/` 装载一批新鲜事件（刷新 `observed_at` / id / GUID 摘要）
3. **腾讯原生事件模式** 保持 `仅预览` 先跑详情/播放；看诊断/日志里 `tencent_native_event ... status=preview`。
4. 确认预览字段合理后，再视需要：网关 `TENCENT_TV_OBSERVED_EVENT_SEND=1` + 隧道在线 + 模式改 `发送`。

外部 JSONL（研究采集器/手机）仍可选：采集=外部 JSONL，把文件指到生产者路径。日常不要用。

## CLI 装载模板（可选）

```powershell
cd G:\hongguo_handoff\work\tui-tencent-native-tui-verify-20261015
bun scripts/tencent-native-fixture-feed.ts `
  --gateway http://127.0.0.1:8080 `
  --device-guid <与TV会话一致的设备ID> `
  --out "$env:APPDATA\gvs\tencent-native-events.jsonl"
```

## 行为边界

- 本地模板是研究固化的事件形状重放，不是下载字节伪装观看，也不是现挂 Frida。
- 每次业务 drain 前，fixture 模式会再追加一批新鲜模板（满足 5 分钟新鲜度）。
- `adlog` 不提供可发送模板（需真实广告画像/cookie）。`bosskv`/`getfeature` 可能 preview 为 incomplete，取决于网关 collector/特征完整性。
- 手机采集脚本仍在 gateway `scripts/research/`，仅研究用。
