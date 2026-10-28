# Desktop v0.1.94

配套网关 **v3.9.120**（最低 v3.9.119）。这一版把 `e2c9fa8`（腾讯软字幕选轨下载与成片标签）
真正打进安装包 —— 那个提交改了 `app/src` 和 `src/lib`，但 `app/package.json` 还停在 0.1.93、
也没有新 tag，所以桌面端与自动更新都还没拿到。

## 变更

### 腾讯软字幕：选轨 → 下载 → 挂轨

- 新增 `src/lib/tencent-subtitles.ts`：把网关 `play` 的 `subtitles[]` 转成可勾选的字幕轨
  （`id / label / lang / format / url / isDefault / selected`），并挑选默认轨；
- `src/lib/online-subtitles.ts`：只保留真正可下载的轨（`id + url`），腾讯 `.vtt.m3u8`
  继续走 HLS(WebVTT) 拼接后落盘；
- `src/lib/jobs.ts`：任务上带 `subtitleIds`，取流后按所选轨下载并交给封装；
- `src/lib/tencent-caption.ts` / `tencent-quality-selection.ts`：字幕档位判定
  （`caption` 透传到画质选择与成片标签）。

### 桌面端

- `Quality.vue`：新增「所选档位为硬字幕」判定 —— 硬字幕档不再显示可勾选字幕、`subtitleIds`
  传空、成片也不挂软字幕；软字幕档才显示勾选框与「默认显示」标记；
- 修掉「所有画质都被标成软字幕」的问题：只在真实返回可下载软字幕轨时才启用字幕区，
  其余情况保持「跟随视频 / 平台内嵌」；
- `core.ts` / `shared/api.ts`：`subtitleIds`、字幕默认标记透传到任务。
- 新增 `app/scripts/tencent-subtitles-smoke.ts` 与 `docs/tencent-subtitles.md`。

## 网关依赖

| 能力 | 需要网关 |
|---|---|
| `subtitles[]` 带 `url` / `urls[]`（腾讯软字幕可下载） | **≥ v3.9.119** |
| 优酷软字幕标记 `has_soft_subtitle`（当前实测均为内嵌硬字幕） | ≥ v3.9.120 |

网关 < v3.9.119 时 `subtitles[]` 没有 url，本版会退化为「无字幕轨」，不会挂空轨。

## 验证

- `bunx tsc --noEmit` 无错误；
- `bun test src/lib`：1067+ pass / 38 skip / 4 fail —— 4 个 fail 均为 `iqcn-local` 本地 helper
  用例（需先 `bun run tools:iqcn` 构建原生 helper），与本次改动无关；
- 安装包由桌面端 Release 工作流构建（标签必须与 `app/package.json` 版本一致：`desktop-v0.1.94`）。

## 回滚

回退 `desktop-v0.1.93`。
