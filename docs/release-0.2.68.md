# TUI v0.2.68 / Desktop v0.1.71

爱奇艺国内版（`iqcn`）支持**整文件（单文件 MP4）投放**的单集。配套 gateway **v3.9.91** 及以上。

## 背景

源站有一部分单集不给 HLS 清单，而是把选中画质作为一个渐进式 MP4 分发。实测《界门之下》第14集
（`tvid=1934523215787300`）`probe` 有 6 档画质，`streams` 却因为「没有清单」失败，
整集无法下载。网关 v3.9.91 起把这类单集切成该文件的字节区间下发。

## 本次修改

- `iqcn.ts`：`streams` 请求固定带 `'local-copy': '1'`，声明本客户端可按声明长度直存整文件区间。
  未声明的客户端会被网关以 `iqcn_delivery_requires_update` 明确拒绝，而不是拿到无法处理的分片
  （旧客户端在分片阶段会撞上本地 TS 还原失败，诊断会误导）。
- `iqcn-local.ts`：
  - `iqcnProcessing` 在 `video.delivery === 'single-file'` 时进入 `copy` 模式，并要求
    `video.drmType === 1`（网关只对明文整文件发计划）。
  - `downloadIQCNLocalSegment` 在 `copy` 模式下**跳过 `iqcn-local` 还原**：整文件区间不是
    188 字节 TS 包，本地还原器只接受 TS，走它必然失败。分片仍按声明长度校验后落盘。
  - HLS（`delivery=hls` 或缺省）路径完全不变：明文直通或 `iqcn-local` 还原照旧。
- 拼接、音轨、字幕、封装不变：区间按 `index` 顺序写入同一文件即得到完整 MP4。

## 验证（2026-10-19，本机）

- `bun test src/lib` 全通过；`bun x tsc --noEmit`、`bun run --cwd app typecheck`、
  `bun run --cwd app build` 通过。
- 新增用例：「whole-file plans copy plain media ranges instead of running the TS helper」
  「whole-file segment download skips the local helper and keeps exact bytes」；
  `iqcn-download`/`iqcn-recovery` 的计划请求断言补上 `local-copy=1`。
- 用真实网关计划（17 段 / 137,674,469 字节）跑 copy 路径：逐段直连取回、拼接后 sha256 与
  直接按 HTTP Range 下载的整文件**完全一致**，`iqcn-local` 调用次数 0。
- 未做整片封装（音轨下载 + 字幕 + mkv 成品）验收。

发布不等于网关已升级：服务端请保持 **v3.9.91+**，否则整文件单集仍会以旧错误失败。
