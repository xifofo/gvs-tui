# TUI v0.2.81

配套网关 **v3.9.113**。这一版只改音轨默认勾选：**口述影像不再被默认选中**。

## 变更

- `probe` 返回的 `audios[]` 新增 `audioDescription`（Apple TV）：画质页音轨列表给这类
  轨道标「口述影像」，且**默认不勾选**；
- 之前 Apple 把正片与口述影像都标 `DEFAULT=YES`，客户端把两条都勾上，下载会把口述
  影像也封装进 MKV；现在默认只勾正片（第一条），需要时仍可手动勾选；
- 画质页底部/任务预览的「已选音轨」因此只显示正片；
- 单测：`appletvplus-download.test.ts` 增加口述影像用例。

## 验证

```
bun test src/lib/appletvplus-download.test.ts src/lib/manifest-provider.test.ts src/lib/media.test.ts
# 55 pass / 0 fail
tsc --noEmit   # 0 error
```

## 回滚

回退 `v0.2.80`；旧网关不返回 `audioDescription` 时行为与之前一致（两条默认都勾选）。
