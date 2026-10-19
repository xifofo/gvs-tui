# 爱奇艺国内版：整文件（单文件 MP4）投放的客户端处理（2026-10-19）

配套 gateway v3.9.90 之后的 iqcn 改动（详见 `gateway/docs/iqcn-jiemen-ep14-whole-file-20261019.md`）。

## 背景

`《界门之下》第14集`（`tvid=1934523215787300`）源站把选中的 1080P 画质作为一个整文件 MP4
分发（无 HLS 清单）。旧客户端在 `streams` 阶段只会看到 `iqcn_manifest_missing`（503），
整集无法下载；网关侧修复后，这一集的分片是**该 MP4 的字节区间**。

## 客户端改动

- `iqcn.ts`：`streams` 请求固定带 `'local-copy': '1'`，声明本客户端可按声明长度直存整文件区间。
  未声明的客户端会被网关以 `diagnostics.stage=iqcn_delivery_requires_update` 拒绝
  （建计划前、不扣次），不会再被误导成「缺清单」。
- `iqcn-local.ts`：
  - `iqcnProcessing` 在 `video.delivery === 'single-file'` 时返回 `copy: true`，并要求
    `video.drmType === 1`（网关只对明文整文件发计划；非明文一律由网关拒绝）。
  - `downloadIQCNLocalSegment` 在 `copy` 模式下**跳过 `iqcn-local` 还原**：整文件区间不是
    TS 样本，本地还原器只接受 188 字节 TS 包，走它必然失败。分片仍按声明长度校验后落盘。
  - HLS（`delivery=hls` 或缺省）路径完全不变：仍走 `drmType=1` 明文直通或 `iqcn-local` 还原。
- 拼接、音轨、字幕、封装不动：区间按 `index` 顺序写入同一文件即得到完整 MP4。

## 验证（2026-10-19，本机）

- `bun test src/lib/iqcn-local.test.ts`：新增「whole-file plans copy plain media ranges instead
  of running the TS helper」与「whole-file segment download skips the local helper and keeps
  exact bytes」；`iqcn-download` / `iqcn-recovery` 的计划请求断言补上 `local-copy=1`。
- `bun test src/lib/iqcn-*.test.ts`（16 个文件）与 `bun x tsc --noEmit` 通过。
- 用真实网关计划（17 段 / 137,674,469 字节）跑本文件的 copy 路径：逐段直连取回、拼接后
  sha256 与直接按 HTTP Range 下载的整文件**完全一致**，`iqcn-local` 调用次数 0。
- 未跑桌面端整片封装（音轨下载 + 字幕 + mkv 成品）：本次只验证到「整文件分片取回并被
  copy 路径原样拼接」与「选中音轨计划可用」。
