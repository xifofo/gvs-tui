# Desktop v0.1.81

修「设置 → 设备文件」卡片被挤成一字一行的问题。

## 问题

v0.1.79 给卡片加了设备池列表，但 `.srow` 是单行 flex（说明区 `flex-grow:1`、操作区 `flex-shrink:0`），
池区块作为第三个子元素写死 `width:100%`，又没让 `.srow` 允许换行 —— 说明区被压到只剩一个字宽，
整段说明文案竖排，池中设备行还溢出到卡片右边缘。

## 修复

- `.srow` 允许换行，设备池 `flex: 1 0 100%` 独占一行；
- 去掉池行重复的左右内边距（`.srow` 已有 20px）。

## 配套

网关 **v3.9.103**：修「已上传却提示未上传」（`userdrm.Source.Level` 仍读池化前的单文件路径，
导致 Apple TV+ / Disney+ 下载返回 412 `DRM_CLIENT_DEVICE_REQUIRED`）。

本版只改样式，未改动业务逻辑；`vue-tsc --noEmit` 干净。
