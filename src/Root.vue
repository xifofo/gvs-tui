<script setup lang="ts">
/**
 * GVS terminal UI.
 *
 * The shell is fixed: a header bar, an optional hairline rule, a content
 * region, a status line and a key-hint footer. Content rows are single
 * `<Text>` renderables built by `colsLine`, so every scene lines up on the
 * same columns and nothing reflows when a status message appears.
 *
 * Each scene under `src/scenes/` owns its own template and row builders; this
 * file owns the window budget, the keys, and the chrome around them.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue-termui'
import {
  Box,
  StyledText,
  Text,
  bold,
  fg,
  onKeyDown,
  useExit,
  useInterval,
  useTerminalSize,
  useTitle,
} from 'vue-termui'
import { Bridge, type Snapshot } from './bridge'
import type { TextChunk } from 'vue-termui'
import KeyHints from './components/KeyHints.vue'
import Spinner from './components/Spinner.vue'
import ConfirmScene from './scenes/ConfirmScene.vue'
import DetailScene from './scenes/DetailScene.vue'
import EditScene from './scenes/EditScene.vue'
import FiltersScene from './scenes/FiltersScene.vue'
import HelpScene from './scenes/HelpScene.vue'
import JobDetailScene from './scenes/JobDetailScene.vue'
import JobsScene from './scenes/JobsScene.vue'
import QrScene from './scenes/QrScene.vue'
import QualityScene from './scenes/QualityScene.vue'
import ResultsScene from './scenes/ResultsScene.vue'
import SearchScene from './scenes/SearchScene.vue'
import SettingsScene from './scenes/SettingsScene.vue'
import SetupScene from './scenes/SetupScene.vue'
import TmdbScene from './scenes/TmdbScene.vue'
import WorkspaceScene from './scenes/WorkspaceScene.vue'
import { chipChunks, colsLine, ink } from './lib/rows'
import { clip, displayWidth, padStart } from './lib/text'
import { FLOW, GLOBAL_HINTS, HINTS, SCENE_TITLES } from './lib/scene-meta'
import { c, hostLabel, providerName, toneColor } from './lib/theme'
import {
  audioTab,
  isMovieDetail,
  logWindow,
  resultWindow,
  tmdbWindow,
  workspaceSections,
} from './lib/view'

const exit = useExit()
const bridge = new Bridge()
const state = ref<Snapshot>(bridge.snapshot)
const query = ref('')
const host = ref('')
const key = ref('')
const edit = ref('')
const { width, height } = useTerminalSize()
// Input scenes expose `focus()`; the shell decides when a scene change (or the
// setup tab) should move the caret into the right field.
const setupScene = ref<{ focus?: () => void } | null>(null)
const searchScene = ref<{ focus?: () => void } | null>(null)
const editScene = ref<{ focus?: () => void } | null>(null)

watch(
  () => state.value.scene,
  (scene) => {
    queueMicrotask(() => {
      if (scene === 'search') searchScene.value?.focus?.()
      else if (scene === 'edit') editScene.value?.focus?.()
      else if (scene === 'setup') setupScene.value?.focus?.()
    })
  },
)
watch(
  () => state.value.hostFocused,
  () => {
    if (state.value.scene !== 'setup') return
    queueMicrotask(() => setupScene.value?.focus?.())
  },
)
const stop = bridge.onSnapshot((next) => {
  state.value = next
  if (next.scene !== 'search') query.value = next.query ?? query.value
  if (next.scene === 'setup') host.value = next.hostInput ?? host.value
  if (next.scene === 'edit') edit.value = next.editValue ?? edit.value
})

onMounted(() => {
  query.value = state.value.query ?? ''
  host.value = state.value.hostInput ?? state.value.host
})
onUnmounted(() => {
  stop()
  bridge.close()
})

watch(query, (value) => {
  if (state.value.scene === 'search') bridge.set('query', value)
})
watch(host, (value) => {
  if (state.value.scene === 'setup') bridge.set('host', value)
})
watch(key, (value) => {
  if (state.value.scene === 'setup') bridge.set('key', value)
})
watch(edit, (value) => {
  if (state.value.scene === 'edit') bridge.set('edit', value)
})

onKeyDown((event) => {
  const name = event.name.toLowerCase()
  if (event.ctrl && name === 'c') {
    exit()
    return
  }
  if (name === 'q' && state.value.scene === 'home') {
    exit()
    return
  }

  // Platform switch:
  // - Alt/⌥+1..5: Mac Option sets event.option; many terminals send ESC+digit as event.meta
  // - Ctrl+1..5: Windows Terminal often steals Alt+digit for tab switching
  // - Never ⌘/super+digit (iTerm/VS Code/Finder window switching)
  const digit = ['1', '2', '3', '4', '5'].includes(name)
  const altLike = !!(event.option || event.meta) && !event.super
  const platformShortcut = digit && (altLike || event.ctrl)
  if (platformShortcut || /^f[1-4]$/.test(name)) {
    bridge.key(event.name, {
      ctrl: event.ctrl,
      alt: altLike || (event.ctrl && digit),
      shift: event.shift,
    })
    event.preventDefault()
    return
  }
  if (state.value.scene === 'search') {
    if (['enter', 'return', 'escape', 'esc', 'tab'].includes(name)) {
      bridge.key(event.name, { shift: event.shift })
      event.preventDefault()
    }
    return
  }
  const inputScene =
    state.value.scene === 'setup' || state.value.scene === 'edit'
  if (inputScene) {
    if (['enter', 'return', 'escape', 'esc', 'tab'].includes(name)) {
      bridge.key(event.name, { shift: event.shift })
      event.preventDefault()
    }
    return
  }
  const forwardedName =
    event.shift && event.name.length === 1
      ? event.name.toUpperCase()
      : event.name
  bridge.key(forwardedName, {
    ctrl: event.ctrl,
    alt: event.option,
    shift: event.shift,
  })
})

// --- layout budgets -------------------------------------------------------
// Chrome is fixed height, so the body budget only depends on the terminal size
// — never on transient text. `showGap` reserves the one row between the header
// and the body that used to hold the full-width rule; the scenes' bodyH must
// not change, so the row stays (blank) instead of being given back.
const W = computed(() => Math.max(24, Math.floor(Number(width.value) || 80)))
const H = computed(() => Math.max(8, Math.floor(Number(height.value) || 24)))
const bodyW = computed(() => W.value - 2)
const showGap = computed(() => H.value >= 18)
const bodyH = computed(() => Math.max(3, H.value - (showGap.value ? 4 : 3)))

useInterval(() => {
  bridge.tickQR()
}, 1500)
watch(
  [width, height],
  () => {
    bridge.resize(Number(width.value), Number(height.value))
    bridge.tickQR()
  },
  { immediate: true },
)

useTitle(() => `GVS · ${SCENE_TITLES[state.value.scene] ?? 'GVS'}`)

const providers = computed(() => state.value.providers ?? [])
const episodes = computed(() => state.value.episodes ?? [])
const audios = computed(() => state.value.audios ?? [])
const jobs = computed(() => state.value.jobs ?? [])
const settings = computed(() => state.value.settings ?? [])
const detail = computed(() => state.value.detail)
const ws = computed(() => state.value.workspace)
const wsSections = computed(() => workspaceSections(ws.value))
const isMovie = computed(() => isMovieDetail(detail.value))

// --- status line ----------------------------------------------------------
// The scenes render the windows; the status line reports their ranges, so both
// derive them from the same helpers in `lib/view`.
const resultView = computed(() =>
  resultWindow(state.value.rows, state.value.cursor, bodyH.value),
)
const tmdbView = computed(() =>
  tmdbWindow(state.value.tmdbHits, state.value.cursor, bodyH.value),
)
const logView = computed(() =>
  logWindow(state.value.jobDetailLines, state.value.logOffset ?? 0, bodyH.value),
)

const jobStats = computed(() => {
  const list = jobs.value
  return {
    total: list.length,
    done: list.filter((j) => j.status === '完成').length,
    failed: list.filter((j) => j.status === '失败').length,
    queued: list.filter((j) => j.status === '排队').length,
    active: list.filter((j) => !['完成', '失败', '排队'].includes(j.status))
      .length,
  }
})

const busyLabel = computed(() => {
  switch (state.value.scene) {
    case 'search':
    case 'results':
      return '查询中…'
    case 'detail':
      return '取剧集…'
    case 'quality':
      return '取画质…'
    case 'setup':
      return '校验 Key…'
    default:
      return '处理中…'
  }
})

const metaText = computed(() => {
  switch (state.value.scene) {
    case 'results':
      return resultView.value.total
        ? `${resultView.value.first}-${resultView.value.last} / ${resultView.value.total}${state.value.listMore ? '+' : ''}`
        : ''
    case 'tmdb':
      return tmdbView.value.total
        ? `${tmdbView.value.first}-${tmdbView.value.last} / ${tmdbView.value.total}`
        : ''
    // The right half must not repeat what `say('已选 n 集')` already put on the
    // left, so it reports where the cursor is instead — they read together as
    // `已选 12 集 … E21 · 21 / 151`.
    case 'detail': {
      const total = episodes.value.length
      const at = Math.max(0, Math.min(state.value.cursor, total - 1))
      return total
        ? `E${String(episodes.value[at]?.number ?? at + 1).padStart(2, '0')} · ${at + 1} / ${total}`
        : ''
    }
    case 'quality':
      return audioTab(state.value)
        ? `音轨 ${state.value.audioIndex + 1} / ${audios.value.length}`
        : (state.value.qualities?.length ?? 0)
          ? `档位 ${state.value.qualityIndex + 1} / ${state.value.qualities?.length}`
          : ''
    case 'job-detail':
      return logView.value.total
        ? `${logView.value.first}-${logView.value.last} / ${logView.value.total} 行`
        : ''
    case 'jobs': {
      const s = jobStats.value
      return `${s.done} 完成 · ${s.active} 进行 · ${s.queued} 排队${s.failed ? ` · ${s.failed} 失败` : ''}`
    }
    case 'settings':
      return `${settings.value.length} 项`
    default:
      return ''
  }
})

const statusContent = computed(() => {
  const message = state.value.status
  const tone = state.value.statusKind
  if (!message) return new StyledText([])
  if (tone === 'info') return new StyledText([fg(c.dim)(message)])
  const icon = tone === 'warn' ? '!' : tone === 'err' ? '✖' : '✔'
  return new StyledText([
    fg(toneColor(tone))(bold(icon)),
    fg(toneColor(tone))(` ${message}`),
  ])
})

/** Width reserved on the right half of the status line. */
const statusRightW = computed(() =>
  state.value.busy
    ? displayWidth(busyLabel.value) + 2
    : displayWidth(metaText.value),
)
const statusLeftW = computed(() =>
  Math.max(10, bodyW.value - statusRightW.value - 1),
)

const hints = computed(() => {
  if (state.value.scene === 'quality' && !audios.value.length)
    return [
      ['⏎', '继续'],
      ['↑↓', '选档'],
      ['esc', '返回'],
    ]
  if (state.value.scene === 'detail' && isMovie.value)
    return [
      ['⏎', '下一步'],
      ['空格', '勾选'],
      ['a/c', '全选/清'],
      ['esc', '返回'],
    ]
  if (state.value.scene === 'workspace' && wsSections.value[ws.value?.sectionIndex ?? 0]?.filters?.length)
    return [...HINTS.workspace!.slice(0, -1), ['f', '筛选'], HINTS.workspace!.at(-1)!]
  return HINTS[state.value.scene] ?? []
})
const globalHints = computed(() =>
  state.value.scene === 'setup' ? GLOBAL_HINTS.slice(0, 1) : GLOBAL_HINTS,
)

// --- header ---------------------------------------------------------------
const headerProvider = computed(() => {
  const scene = state.value.scene
  const detailP = state.value.detailProvider || ''
  if (
    detailP &&
    (scene === 'detail' ||
      scene === 'quality' ||
      scene === 'confirm' ||
      scene === 'tmdb')
  ) {
    return detailP
  }
  if (scene === 'search' || scene === 'results') {
    return providers.value[state.value.providerIndex] || ''
  }
  return (
    state.value.workspace?.provider ||
    providers.value[state.value.providerIndex] ||
    ''
  )
})

/** Scenes that browse a platform: only these put the provider in the breadcrumb. */
const PROVIDER_CRUMBS = new Set([
  'workspace', 'home', 'filters', 'search', 'results', 'detail', 'quality', 'tmdb', 'confirm',
])

/** ` GVS ` chip + a space, then `› 红果 › 选集 › 画质`, or just `设置` off-flow. */
function crumbChunks(cells: number): TextChunk[] {
  const scene = state.value.scene
  const brand = chipChunks('GVS', c.bg, c.accent)
  const chunks: TextChunk[] = [
    bold(brand[0]!),
    { __isChunk: true, text: ' ' },
  ]
  let used = 6
  const push = (text: string, color: string, strong = false) => {
    if (used + displayWidth(text) > cells) return
    const chunk = fg(color)(text)
    chunks.push(strong ? bold(chunk) : chunk)
    used += displayWidth(text)
  }
  if (PROVIDER_CRUMBS.has(scene)) {
    const provider = providerName(headerProvider.value)
    push('› ', c.faint)
    push(provider, c.dim)
    push(' › ', c.faint)
  }
  const step = FLOW.indexOf(scene)
  const parts =
    step < 0
      ? [[SCENE_TITLES[scene] ?? 'GVS', c.text, true] as const]
      : FLOW.map((id, i) => [SCENE_TITLES[id]!, i === step ? c.accent : i < step ? c.dim : c.faint, i === step] as const)
  parts.forEach(([title, color, strong], i) => {
    push(`${i ? ' › ' : ''}${title}`, color, strong)
  })
  chunks.push({ __isChunk: true, text: ' '.repeat(Math.max(0, cells - used)) })
  return chunks
}

/**
 * Right-aligned chrome: `PREVIEW` chip (preview/simulated only), gateway host,
 * tunnel light. Narrow terminals drop the host first, then the PREVIEW chip —
 * the tunnel stays, it is a live connection indicator.
 */
function headerRight(cells: number): TextChunk[] {
  const preview = bridge.preview || state.value.simulated
  const host = hostLabel(state.value.host)
  const tunnel = state.value.tunnelOk ? '● 隧道' : '○ 隧道'
  const GAP = 2
  const CHIP = 9
  const tunnelW = displayWidth(tunnel)
  // The tunnel is never dropped, so the chip and the host share what is left:
  // `PREVIEW  ` + host + `  ` + `● 隧道`.
  const free = cells - tunnelW
  const keepChip = preview && free - CHIP - GAP >= 6 + GAP
  const hostRoom = Math.max(0, free - (keepChip ? CHIP + GAP : 0) - GAP)
  const showHost = hostRoom >= 6
  const hostText = showHost ? clip(host, hostRoom) : ''
  const used =
    (keepChip ? CHIP + GAP : 0) + (showHost ? displayWidth(hostText) + GAP : 0) + tunnelW
  const chunks: TextChunk[] = [{ __isChunk: true, text: ' '.repeat(Math.max(0, cells - used)) }]
  if (keepChip) chunks.push(...chipChunks('PREVIEW', c.warn), { __isChunk: true, text: '  ' })
  if (showHost) chunks.push(fg(c.faint)(hostText), { __isChunk: true, text: '  ' })
  chunks.push(fg(state.value.tunnelOk ? c.ok : c.faint)(tunnel))
  return chunks
}

/** Cells the right chrome wants, capped so the crumb always keeps some room. */
const headerRightW = computed(() => {
  const preview = bridge.preview || state.value.simulated
  const wanted =
    (preview ? 11 : 0) + displayWidth(hostLabel(state.value.host)) + 2 + displayWidth('● 隧道')
  // ` GVS  设置` plus slack is the least the crumb may keep, so the right side
  // yields (host first, then chip) instead of squeezing the breadcrumb out.
  return Math.min(wanted, Math.max(0, bodyW.value - 14))
})

const headerLine = computed(() =>
  colsLine(
    [
      { chunks: crumbChunks, grow: true },
      { chunks: () => headerRight(headerRightW.value), cells: headerRightW.value },
    ],
    bodyW.value,
  ),
)
</script>

<template>
  <Box :width="W" :height="H" flexDirection="column" :backgroundColor="c.bg">
    <!-- header -->
    <Box
      :width="W"
      :height="1"
      flexDirection="row"
      :backgroundColor="c.panel"
      :paddingLeft="1"
      :paddingRight="1"
    >
      <Text
        :content="headerLine"
        :width="bodyW"
        :height="1"
        wrapMode="none"
        :truncate="true"
      />
    </Box>
    <Text v-if="showGap" :content="' '" :width="W" :height="1" />

    <!-- body -->
    <Box
      :flexGrow="1"
      flexDirection="column"
      :width="W"
      :paddingLeft="1"
      :paddingRight="1"
    >
      <Box v-if="W < 60 || H < 18" flexDirection="column"
        ><Text
          :content="ink(c.warn, '终端太小，请扩大到至少 60×18')"
          :width="bodyW"
          :height="1"
          :truncate="true"
      /></Box>
      <!-- setup -->
      <SetupScene
        v-else-if="state.scene === 'setup'"
        ref="setupScene"
        v-model:host="host"
        v-model:api-key="key"
        :state="state"
        :width="bodyW"
      />
      <!-- platform workspace -->
      <WorkspaceScene
        v-else-if="state.scene === 'workspace' || state.scene === 'home'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
        :W="W"
      />
      <!-- filters -->
      <FiltersScene
        v-else-if="state.scene === 'filters'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- help -->
      <HelpScene
        v-else-if="state.scene === 'help'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- confirm -->
      <ConfirmScene
        v-else-if="state.scene === 'confirm'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
        :H="H"
      />
      <!-- job-detail -->
      <JobDetailScene
        v-else-if="state.scene === 'job-detail'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- search -->
      <SearchScene
        v-else-if="state.scene === 'search'"
        ref="searchScene"
        v-model:query="query"
        :state="state"
        :width="bodyW"
      />
      <!-- results -->
      <ResultsScene
        v-else-if="state.scene === 'results'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- detail -->
      <DetailScene
        v-else-if="state.scene === 'detail'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- quality + audio -->
      <QualityScene
        v-else-if="state.scene === 'quality'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- tmdb -->
      <TmdbScene
        v-else-if="state.scene === 'tmdb'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- jobs -->
      <JobsScene
        v-else-if="state.scene === 'jobs'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- settings -->
      <SettingsScene
        v-else-if="state.scene === 'settings'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
      <!-- edit -->
      <EditScene
        v-else-if="state.scene === 'edit'"
        ref="editScene"
        v-model:edit="edit"
        :state="state"
        :width="bodyW"
      />
      <!-- qr -->
      <QrScene
        v-else-if="state.scene === 'qr'"
        :state="state"
        :width="bodyW"
        :height="bodyH"
      />
    </Box>

    <!-- status -->
    <Box
      :width="W"
      :height="1"
      flexDirection="row"
      :paddingLeft="1"
      :paddingRight="1"
    >
      <Text
        :content="statusContent"
        :width="statusLeftW"
        :height="1"
        wrapMode="none"
        :truncate="true"
      />
      <Spinner v-if="state.busy" :label="busyLabel" />
      <Text
        v-else
        :content="ink(c.faint, padStart(metaText, statusRightW))"
        :width="statusRightW"
        :height="1"
      />
    </Box>

    <!-- footer -->
    <Box
      :width="W"
      :height="1"
      flexDirection="row"
      :backgroundColor="c.panel"
      :paddingLeft="1"
      :paddingRight="1"
    >
      <KeyHints :hints="hints" :extra="globalHints" :width="bodyW" />
    </Box>
  </Box>
</template>
