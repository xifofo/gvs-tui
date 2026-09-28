<script setup lang="ts">
// 画质: the quality table and, on ←/→, the audio track table in the same
// frame. The two share one cursor treatment so the switch never moves.
import { computed } from 'vue-termui'
import { Box, StyledText, Text, fg } from 'vue-termui'
import { colsLine, ink, markCol, tabChunks } from '../lib/rows.ts'
import type { Col } from '../lib/rows.ts'
import { displayWidth } from '../lib/text.ts'
import { c } from '../lib/theme.ts'
import { qualityCaptionText, qualityFpsText, qualityHdrText, qualityResolution } from '../lib/quality.ts'
import { human } from '../lib/util.ts'
import { audioTab, optionWindow } from '../lib/view.ts'
import type { Audio, Quality, Snapshot } from '../bridge.ts'

const props = defineProps<{
  state: Snapshot
  /** bodyW */
  width: number
  /** bodyH */
  height: number
}>()

const bodyW = computed(() => props.width)
const bodyH = computed(() => props.height)

const qualities = computed(() => props.state.qualities ?? [])
const audios = computed(() => props.state.audios ?? [])
const detail = computed(() => props.state.detail)
const isMovie = computed(() =>
  detail.value?.kind === 'movie' || /电影/.test(detail.value?.category ?? ''),
)

const qualityAction = computed(() => {
  const q = qualities.value[props.state.qualityIndex]
  const n = props.state.pendingCount || 1
  const picked = audios.value.filter((a) => a.selected).map((a) => a.label)
  const audio = !audios.value.length
    ? ''
    : picked.length
      ? picked.slice(0, 2).join('+')
      : '默认音轨'
  return [`下载 ${n} ${isMovie.value ? '部' : '集'}`, q?.label, audio]
    .filter(Boolean)
    .join(' · ')
})
const onAudioTab = computed(() => audioTab(props.state))
const audioPicked = computed(
  () => audios.value.filter((a) => a.selected).length,
)

/**
 * VIP 徽标要分清三件事：片源要不要 VIP、账号是什么状态、**这次取流到底成不成**。
 * 最后一条来自 `play` 的 `quality_gate`，比会员接口可信——它是真的取到流了。
 */
const vipNotice = computed(() => {
  if (!detail.value?.vip) return null
  const probe = props.state.vipProbe
  const acc = props.state.ykAccount
  if (acc?.needsScan) return { text: 'VIP · 需重新扫码', color: c.err }
  if (probe) {
    if (!probe.canPlay) return { text: 'VIP · 该账号不可播', color: c.err }
    if (probe.hasTrial) return { text: 'VIP · 仅试看', color: c.warn }
    return { text: probe.isVip ? 'VIP ✓' : 'VIP · 可播', color: c.ok }
  }
  if (!acc) return { text: 'VIP', color: c.violet }
  if (acc.vipSource === 'api' && !acc.isVip)
    return { text: 'VIP · 账号无权益', color: c.err }
  return {
    text: acc.isVip ? 'VIP ✓' : 'VIP',
    color: acc.isVip ? c.ok : c.violet,
  }
})
/** 画质页右上角：这次取流的实际权益（`play` 给的，不是猜的）。 */
const rightsChip = computed(() => {
  const probe = props.state.vipProbe
  if (probe) {
    const bits = [probe.canPlay ? '可播' : '不可播']
    if (probe.isVip) bits.push('会员✓')
    if (probe.hasTrial) bits.push('仅试看')
    if (probe.note) bits.push(probe.note)
    return {
      text: bits.join(' · '),
      color: !probe.canPlay || probe.hasTrial ? c.warn : c.ok,
    }
  }
  const acc = props.state.ykAccount
  if (acc) {
    if (acc.needsScan) return { text: '登录态不可用', color: c.err }
    if (acc.vipSource === 'api')
      return {
        text: acc.isVip ? '会员✓' : '无会员权益',
        color: acc.isVip ? c.ok : c.warn,
      }
    return {
      text: acc.isVip ? '会员(登录快照)' : '会员未知',
      color: acc.isVip ? c.ok : c.dim,
    }
  }
  return { text: '权益未知', color: c.dim }
})

const qualityView = computed(() =>
  optionWindow(qualities.value, props.state.qualityIndex, bodyH.value),
)
const audioView = computed(() =>
  optionWindow(audios.value, props.state.audioIndex, bodyH.value),
)

function qualityTable(header: boolean, row?: Quality, selected = false): StyledText {
  const width = bodyW.value
  const showRes = width >= 64
  const showDrm = width >= 72
  const showCaption = qualities.value.some((q) => qualityCaptionText(q.caption))
  const showHdr = qualities.value.some((q) => qualityHdrText(q.hdr))
  const showFps = qualities.value.some((q) => qualityFpsText(q.fps))
  const tone = selected ? c.text : c.dim
  const name =
    !row
      ? '档位'
      : row.group === 'source'
        ? row.label || '原画'
        : row.group === 'encode'
          ? `⚡${row.label || (row.stream || row.title || '').split('|')[0] || '转码'}`
          : row.label || row.title || '视频流'
  const drm = !row?.drm ? '—' : 'DRM'
  // Size the name column to the longest label, and let a trailing spacer take
  // the slack, so short tables do not stretch across a wide terminal.
  const nameCells = Math.min(
    Math.max(10, Math.floor(width * 0.4)),
    qualities.value.reduce((n, q) => Math.max(n, displayWidth(q.label || q.title || '') + 3), 8),
  )
  const cols: Col[] = [
    header ? { text: '  ', cells: 2 } : markCol(selected),
    {
      text: header ? '档位' : name,
      cells: nameCells,
      color: header ? c.dim : c.text,
      bold: selected,
    },
  ]
  const field = (title: string, value: string, cells: number, align?: 'left' | 'right') => {
    cols.push({ text: '', cells: 2 })
    cols.push({
      text: header ? title : value,
      cells,
      align,
      color: header ? c.dim : tone,
    })
  }
  // Keep these labels inside the cell. Row truncate used to plant an ellipsis
  // immediately after the short HDR word.
  const captionText = (q?: Quality) => (q ? qualityCaptionText(q.caption) || '-' : '')
  const hdrText = (q?: Quality) => (q ? qualityHdrText(q.hdr) || '-' : '')
  if (showCaption) field('字幕', header ? '字幕' : captionText(row), 10)
  if (showHdr) field('HDR', header ? 'HDR' : hdrText(row), 8)
  if (showRes) field('分辨率', row ? qualityResolution(row.width, row.height) : '', 12)
  if (showFps) field('fps', row ? qualityFpsText(row.fps) || '—' : '', 6)
  field('编码', row ? row.encodeTag || row.codec || '—' : '', width >= 100 ? 10 : 8)
  field('体积', row ? (row.size > 0 ? human(row.size) : '—') : '', 10, 'right')
  if (showDrm) field('DRM', row ? drm : '', 4)
  cols.push({ text: '', grow: true })
  return colsLine(cols, width, selected && !header)
}

function qualityHeader(): StyledText {
  return qualityTable(true)
}

function qualityLine(row: Quality, selected: boolean): StyledText {
  return qualityTable(false, row, selected)
}

const AUDIO_COLS = { label: 18, lang: 10, codec: 12 }

function audioHeader(): StyledText {
  return colsLine(
    [
      { text: ' '.repeat(4), cells: 4 },
      { text: '音轨', cells: AUDIO_COLS.label, color: c.dim },
      { text: '', cells: 2 },
      { text: '语言', cells: AUDIO_COLS.lang, color: c.dim },
      { text: '', cells: 2 },
      { text: '编码', cells: AUDIO_COLS.codec, color: c.dim },
    ],
    bodyW.value,
  )
}

function audioLine(row: Audio, selected: boolean): StyledText {
  const muxDefault =
    (audios.value.find((a) => a.selected) ??
      audios.value.find((a) => a.isDefault)) === row
  return colsLine(
    [
      markCol(selected),
      {
        text: row.selected ? '✓ ' : '□ ',
        cells: 2,
        color: row.selected ? c.ok : c.faint,
      },
      {
        text: row.label || row.id,
        cells: AUDIO_COLS.label,
        color: selected ? c.text : c.dim,
        bold: selected,
      },
      { text: '', cells: 2 },
      { text: row.lang || '—', cells: AUDIO_COLS.lang, color: c.dim },
      { text: '', cells: 2 },
      { text: row.codec || '', cells: AUDIO_COLS.codec, color: c.dim },
      {
        text: [muxDefault ? '封装默认' : '', row.isDefault ? '平台默认' : '']
          .filter(Boolean)
          .join(' · '),
        grow: true,
        align: 'right',
        color: muxDefault ? c.ok : c.faint,
      },
    ],
    bodyW.value,
    selected,
  )
}
</script>

<template>
  <Box flexDirection="column" :width="bodyW">
    <Text
      :content="
        colsLine(
          [
            {
              text: qualityAction,
              grow: true,
              color: c.accent,
            },
            {
              text: state.detail?.vip
                ? (vipNotice?.text ?? 'VIP')
                : rightsChip.text,
              cells: 20,
              align: 'right',
              color: state.detail?.vip
                ? (vipNotice?.color ?? c.violet)
                : rightsChip.color,
            },
          ],
          bodyW,
        )
      "
      :height="1"
    />
    <Text
      :height="1"
      :marginTop="1"
      :width="bodyW"
      :content="
        new StyledText([
          ...tabChunks(`画质 ${qualities.length} 档`, !onAudioTab),
          ...(audios.length
            ? tabChunks(
                audios.every((a) => a.embedded)
                  ? '内嵌音轨 · 随画质切换'
                  : `音轨 ${audios.length} 条 · 已选 ${audioPicked}`,
                onAudioTab,
              )
            : []),
          fg(c.faint)(audios.length ? '   ←→ 切换' : ''),
        ])
      "
    />
    <Text
      :height="1"
      :content="onAudioTab ? audioHeader() : qualityHeader()"
      :width="bodyW"
      wrapMode="none"
    />
    <Text
      :height="1"
      :content="ink(c.line, '─'.repeat(bodyW))"
      :width="bodyW"
      wrapMode="none"
    />
    <Text v-if="!qualities.length && !state.busy" :content="ink(c.err,state.status || '没有可用画质，请重试或返回')" :width="bodyW" :height="Math.max(2,bodyH-5)" />
    <Text
      v-for="entry in onAudioTab ? audioView.rows : qualityView.rows"
      :key="`${onAudioTab ? 'a' : 'q'}-${entry.index}`"
      :width="bodyW"
      :height="1"
      wrapMode="none"
      :truncate="onAudioTab"
      :bg="
        entry.index === (onAudioTab ? state.audioIndex : state.qualityIndex)
          ? c.sel
          : undefined
      "
      :content="
        onAudioTab
          ? audioLine(entry.item as Audio, entry.index === state.audioIndex)
          : qualityLine(
              entry.item as Quality,
              entry.index === state.qualityIndex,
            )
      "
    />
  </Box>
</template>
