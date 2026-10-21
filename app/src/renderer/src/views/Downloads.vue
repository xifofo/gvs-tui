<script setup lang="ts">
import UploadProgress from '../integrations/plutofish/UploadProgress.vue'
import { transferState, transferLabel, transferPercent } from '@shared/job-transfer'
import PublicationDetails from '../integrations/plutofish/PublicationDetails.vue'
import { actualVersionDetail, actualVersionSummary } from '../../../../../src/lib/actual-version'
import TencentDiagnostics from '../components/TencentDiagnostics.vue'
import { computed, reactive, ref, watch } from 'vue'
import type { JobView } from '@shared/api'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import DownloadPagination from '../components/DownloadPagination.vue'
import Icon from '../components/Icon.vue'
import PlatformLogo from '../components/PlatformLogo.vue'
import Poster from '../components/Poster.vue'
import { ago, errText, gvs, openSettings, store, toast, copyText } from '../store'
import { needsDeviceFile } from '@shared/user-message'

const diagnosticsJob = ref<number | undefined>()
const showDiagnostics = ref(false)
const page = ref<HTMLElement | null>(null)
type Filter = 'all' | 'active' | 'pending' | 'paused' | 'failed' | 'done'
const filter = computed({ get: () => store.dlFilter as Filter, set: (v: Filter) => (store.dlFilter = v) })

const count = (pred: (j: JobView) => boolean) => store.jobs.filter(pred).length
const isActive = (j: JobView) => transferState(j) === 'active'
const isDone = (j: JobView) => transferState(j) === 'done'
const counts = computed(() => ({
  all: store.jobs.length,
  active: count(isActive),
  pending: count((j) => transferState(j) === 'pending'),
  paused: count((j) => transferState(j) === 'paused'),
  failed: count((j) => transferState(j) === 'failed'),
  done: count(isDone),
}))
const TABS: Array<{ key: Filter; label: string; empty: string }> = [
  { key: 'all', label: '全部', empty: '还没有下载任务。搜一部剧，选好集数和画质就能开始。' },
  { key: 'active', label: '进行中', empty: '没有正在下载、上传或排队的任务' },
  { key: 'pending', label: '待处理', empty: '没有需要补全信息的任务' },
  { key: 'paused', label: '已暂停', empty: '没有暂停的任务' },
  { key: 'failed', label: '失败', empty: '没有失败的任务' },
  { key: 'done', label: '已完成', empty: '还没有已完成的任务' },
]

const match = (j: JobView) =>
  filter.value === 'all' || transferState(j) === filter.value

const groups = computed(() => {
  const map = new Map<string, { id: string; title: string; provider: JobView['provider']; poster: string; quality: string; jobs: JobView[] }>()
  for (const j of store.jobs) {
    let g = map.get(j.groupId)
    if (!g) {
      g = { id: j.groupId, title: j.groupTitle, provider: j.provider, poster: j.poster, quality: j.quality, jobs: [] }
      map.set(j.groupId, g)
    }
    g.jobs.push(j)
  }
  return [...map.values()].reverse()
})
const jobsOf = (g: { jobs: JobView[] }) => g.jobs.filter(match)
const shown = computed(() => groups.value.filter((g) => g.jobs.some(match)))
const currentPage = ref(1)
const pageSize = ref(10)
const totalPages = computed(() => Math.max(1, Math.ceil(shown.value.length / pageSize.value)))
const pagedGroups = computed(() => shown.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

watch([filter, pageSize], () => { currentPage.value = 1 })
watch(totalPages, (total) => { currentPage.value = Math.min(currentPage.value, total) })
watch(
  () => groups.value.map((g) => g.id),
  (current, previous) => {
    const known = new Set(previous)
    if (current.some((id) => !known.has(id))) currentPage.value = 1
  },
)
watch([filter, pageSize, currentPage], () => page.value?.scrollTo({ top: 0, behavior: 'instant' }), { flush: 'post' })

const hasJobs = computed(() => store.jobs.length > 0)
/** 折叠态按分组 id 记；整组完成的默认折叠，其余默认展开 */
const folds = reactive<Record<string, boolean>>({})

const barClass = (j: JobView) =>
  j.state === 'done' ? 'done' : j.state === 'failed' ? 'fail' : j.state === 'paused' ? 'pause' : /封装|合并|mux|remux/i.test(j.status) ? 'mux' : ''
const pct = (j: JobView) => Math.round((j.state === 'done' ? 1 : j.pct) * 100)
const doneCount = (jobs: JobView[]) => jobs.filter(isDone).length

const groupPct = (jobs: JobView[]) => jobs.length ? Math.round(jobs.reduce((s, j) => s + transferPercent(j), 0) / jobs.length) : 0
const groupBar = (jobs: JobView[]) =>
  jobs.every(isDone) ? 'done' : jobs.some(isActive) ? '' : jobs.some((j) => transferState(j) === 'failed') ? 'fail' : 'pause'
const groupStatus = transferLabel
const base = (p: string) => p.split(/[\\/]/).pop() || p
const sub = (j: JobView) =>
  j.state === 'failed' ? j.err
  : j.state === 'done' ? base(j.output)
  : j.state === 'paused' ? '已暂停 · 继续后从断点接着下'
  : j.log || j.status
const subTitle = (j: JobView) => (j.state === 'done' ? j.output : sub(j))
const mediaSummary = (j: JobView) => {
  const record = j.completedMedia || j.actualVersion
  return record ? actualVersionSummary(record) : ''
}
const mediaDetail = (j: JobView) => {
  const record = j.completedMedia || j.actualVersion
  return record ? actualVersionDetail(record) : ''
}

const isFolded = (g: { id: string; jobs: JobView[] }) =>
  folds[g.id] ?? (filter.value === 'all' && g.jobs.every(isDone))
const toggleFold = (g: { id: string; jobs: JobView[] }) => (folds[g.id] = !isFolded(g))

/** 整组完成并自动收起后回到页首，避免停在缩短后的列表中间。 */
watch(
  () => pagedGroups.value.map((g) => ({ id: g.id, done: g.jobs.every(isDone), folded: isFolded(g) })),
  (current, previous) => {
    const before = new Map(previous.map((g) => [g.id, g]))
    const autoFolded = current.some((g) => {
      const old = before.get(g.id)
      return old && !old.done && !old.folded && g.done && g.folded && folds[g.id] === undefined
    })
    if (autoFolded) page.value?.scrollTo({ top: 0, behavior: 'instant' })
  },
  { flush: 'post' },
)

/** 按下的按钮先禁用，等主进程推新状态回来 */
const busy = reactive(new Set<number>())
const anyBusy = (ids: number[]) => ids.some((id) => busy.has(id))

async function call(fn: () => Promise<unknown>, ids: number[] = []) {
  ids.forEach((id) => busy.add(id))
  try {
    await fn()
  } catch (e) {
    toast(errText(e), 'err')
  } finally {
    ids.forEach((id) => busy.delete(id))
  }
}
const idsOf = (jobs: JobView[]) => jobs.map((j) => j.id)
const activeIds = (g: { jobs: JobView[] }) => idsOf(g.jobs.filter(isActive))
const pausedIds = (g: { jobs: JobView[] }) => idsOf(g.jobs.filter((j) => transferState(j) === 'paused'))
const pauseTask = (id: number) => store.jobs.find(j => j.id === id)?.state === 'done' ? gvs('controlPublication', id, 'pause') : gvs('pauseJob', id)
const resumeTask = (id: number) => store.jobs.find(j => j.id === id)?.state === 'done' ? gvs('controlPublication', id, 'resume') : gvs('resumeJob', id)
const runEach = async (fn: (id: number) => Promise<unknown>, ids: number[]) => {
  for (const id of ids) await fn(id)
}

const pendingConfirm = ref<{ kind: 'job' | 'group'; job: JobView | null; group: { title: string; ids: number[] } | null } | null>(null)

function removeJob(j: JobView, deleteFiles: boolean) {
  void call(() => gvs('removeJob', j.id, deleteFiles), [j.id])
}
function removeGroup(ids: number[], deleteFiles: boolean) {
  void call(() => runEach((id) => gvs('removeJob', id, deleteFiles), ids), ids)
}
const HOOK_STATE: Record<string, string> = { running: '运行中', ok: '成功', failed: '失败', timeout: '超时' }
</script>

<template>
  <div class="downloads">
    <div ref="page" class="page downloads-content">
      <div class="head">
        <h1 class="h1">下载</h1>
        <div class="stats">
          <div class="stat"><b class="run">{{ counts.active }}</b><span>进行中</span></div>
          <div class="stat"><b class="run">{{ counts.pending }}</b><span>待处理</span></div>
          <div class="stat"><b>{{ counts.paused }}</b><span>已暂停</span></div>
          <div class="stat"><b class="bad">{{ counts.failed }}</b><span>失败</span></div>
          <div class="stat"><b class="good">{{ counts.done }}</b><span>已完成</span></div>
        </div>
        <div class="acts">
          <button type="button" class="btn" :disabled="!counts.active" @click="call(() => runEach(pauseTask, idsOf(store.jobs.filter(isActive))))"><Icon name="pause" :size="15" />全部暂停</button>
          <button type="button" class="btn" :disabled="!counts.paused" @click="call(() => runEach(resumeTask, idsOf(store.jobs.filter(j => transferState(j) === 'paused'))))"><Icon name="play" :size="15" />全部继续</button>
          <button type="button" class="btn" :disabled="!counts.done" @click="call(() => gvs('clearFinished'))"><Icon name="trash" :size="16" />清除已完成</button>
          <button type="button" class="btn" @click="call(() => gvs('openPath', ''))"><Icon name="folder" :size="16" />打开下载目录</button>
        </div>
      </div>

      <div v-if="hasJobs" class="filters">
        <button v-for="t in TABS" :key="t.key" type="button" class="pill" :class="{ on: filter === t.key }" :disabled="!counts[t.key] && t.key !== 'all'" @click="filter = t.key">
          {{ t.label }}<span class="count">{{ counts[t.key] }}</span>
        </button>
      </div>

      <div v-if="!shown.length" class="empty card">
        <Icon name="download" :size="28" />
        <span>{{ TABS.find((t) => t.key === filter)!.empty }}</span>
      </div>

      <section v-for="g in pagedGroups" :key="g.id" class="card grp">
        <div class="gh">
          <Poster :url="g.poster" :provider="g.provider" style="width: 34px; height: 48px; padding: 0" />
          <div class="gt">
            <div class="gtt"><PlatformLogo :provider="g.provider" :size="16" /><span class="gname">{{ g.title }}</span></div>
            <span class="muted small">{{ g.jobs.length }} 个任务 · {{ g.quality }}</span>
          </div>
          <div class="gbar">
            <div class="progress" :class="groupBar(g.jobs)"><div :style="{ width: groupPct(g.jobs) + '%' }" /></div>
            <span class="mono small dim">{{ doneCount(g.jobs) }} / {{ g.jobs.length }} 完成</span>
          </div>
          <div class="ga">
            <button
              v-if="activeIds(g).length"
              type="button" class="btn sm" :disabled="anyBusy(activeIds(g))"
              @click="call(() => runEach(pauseTask, activeIds(g)), activeIds(g))"
            >暂停组</button>
            <button
              v-else-if="pausedIds(g).length"
              type="button" class="btn sm outline" :disabled="anyBusy(pausedIds(g))"
              @click="call(() => runEach(resumeTask, pausedIds(g)), pausedIds(g))"
            ><Icon name="play" :size="14" />继续组</button>
            <button type="button" class="btn sm icon" aria-label="删除整组" title="删除整组" @click="pendingConfirm = { kind: 'group', job: null, group: { title: g.title, ids: idsOf(g.jobs) } }"><Icon name="trash" :size="15" /></button>
            <button type="button" class="btn sm icon fold" :aria-expanded="!isFolded(g)" :aria-label="isFolded(g) ? '展开' : '折叠'" @click="toggleFold(g)"><Icon name="chevron" :size="16" /></button>
          </div>
        </div>

        <div v-if="!isFolded(g)" class="jobs">
          <div v-for="j in jobsOf(g)" :key="j.id" class="job">
            <span class="mono lbl">{{ j.label }}</span>
            <div class="st">
              <div class="status-line">
                <span class="stt" :class="transferState(j)">{{ groupStatus(j) }}</span>
                <span v-if="j.state === 'done'" class="muted completed-at">· 下载于 {{ ago(j.finishedAt) || '刚刚' }}</span>
              </div>
              <span v-if="sub(j)" class="muted sub" :title="subTitle(j)">{{ sub(j) }}</span>
              <span v-if="mediaSummary(j)" class="muted sub" :title="mediaDetail(j)">{{ mediaSummary(j) }}</span>
              <UploadProgress v-if="j.state === 'done' && j.publication" :job="j" />
              <PublicationDetails :draft="j.publication" />
              <span v-if="j.state === 'done' && j.note" class="sub job-note" :title="j.note">{{ j.note }}</span>
              <span v-if="j.hooks?.length || j.ed2k" class="hooks">
                <span v-for="h in j.hooks" :key="h.event + h.startedAt" class="chip tiny" :class="{ ok: h.state === 'ok', warn: h.state === 'failed' || h.state === 'timeout' }" :title="`${h.command}\n${h.message || ''}\n日志：${h.log}`">
                  <Icon name="terminal" :size="12" />{{ h.event === 'start' ? '开始命令' : '完成命令' }} · {{ HOOK_STATE[h.state] }}
                </span>
                <span v-if="j.ed2k?.state === 'running'" class="chip tiny"><span class="spin" style="width: 9px; height: 9px" />ed2k {{ Math.round(j.ed2k.pct * 100) }}%</span>
                <span v-else-if="j.ed2k?.state === 'failed'" class="chip tiny warn" :title="j.ed2k.message">ed2k 失败</span>
              </span>
            </div>
            <div class="bar">
              <span class="small dim">下载</span>
              <div class="progress" :class="barClass(j)"><div :style="{ width: pct(j) + '%' }" /></div>
              <span class="mono small dim pc">{{ pct(j) }}%</span>
            </div>
            <div class="ja">
              <button v-if="j.provider === 'tencent'" type="button" class="btn sm diag" title="腾讯诊断" @click="diagnosticsJob = j.id; showDiagnostics = true"><Icon name="info" :size="14" /><span class="diag-t">腾讯诊断</span></button>
              <template v-if="j.state === 'failed'">
                <button v-if="needsDeviceFile(j.err)" type="button" class="btn sm outline" @click="openSettings('devices')">去设置上传</button>
                <button type="button" class="btn sm" :disabled="busy.has(j.id)" @click="call(() => gvs('retryJob', j.id), [j.id])">
                  <span v-if="busy.has(j.id)" class="spin" /><Icon v-else name="retry" :size="15" />重试
                </button>
              </template>
              <template v-else-if="j.state === 'paused'">
                <button type="button" class="btn sm outline" :disabled="busy.has(j.id)" @click="call(() => gvs('resumeJob', j.id), [j.id])">
                  <span v-if="busy.has(j.id)" class="spin" /><Icon v-else name="play" :size="14" />继续
                </button>
              </template>
              <template v-else-if="j.state === 'done'">
                <button v-if="j.output" type="button" class="btn sm icon" aria-label="打开所在文件夹" title="打开所在文件夹" @click="call(() => gvs('showItem', j.output))"><Icon name="folder" :size="16" /></button>
                <button v-if="j.ed2k?.link" type="button" class="btn sm icon" aria-label="复制 ed2k 链接" title="复制 ed2k 链接" @click="copyText(j.ed2k.link, '已复制 ed2k 链接')"><Icon name="copy" :size="15" /></button>
                <button v-else-if="j.historyId && j.ed2k?.state !== 'running'" type="button" class="btn sm icon" aria-label="计算 ed2k" title="计算 ed2k 链接" @click="call(() => gvs('computeEd2k', j.historyId!, j.id).then(() => {}))"><Icon name="hash" :size="15" /></button>
              </template>
              <template v-else>
                <button type="button" class="btn sm icon" aria-label="暂停" title="暂停" :disabled="busy.has(j.id)" @click="call(() => gvs('pauseJob', j.id), [j.id])">
                  <span v-if="busy.has(j.id)" class="spin" /><Icon v-else name="pause" :size="15" />
                </button>
              </template>
              <button type="button" class="btn sm icon del" :aria-label="`删除 ${j.label}`" title="删除" :disabled="busy.has(j.id)" @click="pendingConfirm = { kind: 'job', job: j, group: null }">
                <span v-if="busy.has(j.id)" class="spin" /><Icon v-else name="x" :size="15" />
              </button>
            </div>
          </div>
        </div>
      </section>

    </div>

    <footer v-if="hasJobs" class="downloads-footer">
      <DownloadPagination v-model:page="currentPage" v-model:page-size="pageSize" :total-pages="totalPages" :group-count="shown.length" />
    </footer>

    <Transition name="drawer">
      <div v-if="showDiagnostics" class="diag-layer" @click.self="showDiagnostics = false" @keydown.esc="showDiagnostics = false">
        <TencentDiagnostics class="diag-drawer" :job-id="diagnosticsJob" @close="showDiagnostics = false" />
      </div>
    </Transition>
    <ConfirmDialog
      v-if="pendingConfirm?.job"
      title="删除这个任务？"
      :message="`${pendingConfirm.job.groupTitle} · ${pendingConfirm.job.label}`"
      confirm-text="删除"
      danger
      :checkbox="pendingConfirm.job.state === 'done' ? '同时删除视频文件' : ''"
      @confirm="(checked) => { removeJob(pendingConfirm!.job!, checked); pendingConfirm = null }"
      @cancel="pendingConfirm = null"
    />
    <ConfirmDialog
      v-else-if="pendingConfirm?.group"
      title="删除整组任务？"
      :message="`${pendingConfirm.group.title} · ${pendingConfirm.group.ids.length} 个任务`"
      confirm-text="删除整组"
      danger
      checkbox="同时删除已下载的文件"
      @confirm="(checked) => { removeGroup(pendingConfirm!.group!.ids, checked); pendingConfirm = null }"
      @cancel="pendingConfirm = null"
    />
  </div>
</template>

<style scoped>
.downloads { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.downloads-content { flex: 1; min-height: 0; height: auto; }
.downloads-footer { flex-shrink: 0; padding: 12px 32px; border-top: 1px solid var(--line); background: var(--paper); }
.head { display: flex; align-items: flex-end; gap: 32px; flex-wrap: wrap; }
.stats { display: flex; gap: 28px; }
.stat { display: flex; flex-direction: column; gap: 2px; }
.stat b { font-family: var(--font-display); font-size: 28px; font-weight: 800; line-height: 1; }
.stat span { font-size: 13px; color: var(--ink-3); }
.run { color: var(--orange-text); }
.bad { color: var(--err); }
.good { color: var(--ok); }
.acts { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.small { font-size: 13px; }
.grp { overflow: hidden; }
.gh { min-height: 64px; padding: 10px 18px; display: flex; align-items: center; gap: 14px; }
.gt { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.gtt { display: flex; align-items: center; gap: 8px; font-size: 16px; font-weight: 700; min-width: 0; }
.gname { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gbar { margin-left: auto; display: flex; flex-shrink: 0; align-items: center; gap: 12px; width: min(280px, 32%); }
.gbar .progress { flex-grow: 1; }
.gbar span { flex-shrink: 0; }
.ga { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.fold { transition: transform .12s; }
.fold[aria-expanded="false"] { transform: rotate(-90deg); }
.jobs { border-top: 1px solid var(--line); }
.job {
  min-height: 58px; padding: 8px 18px; display: grid; grid-template-columns: minmax(72px, max-content) minmax(0, 1fr) minmax(140px, 240px) max-content;
  grid-template-areas: "lbl st bar ja"; align-items: center; column-gap: 18px; row-gap: 6px; border-top: 1px solid var(--line);
}
.job:first-child { border-top: 0; }
/* 日期集号等长编号按内容扩列，超长编号在列内换行，避免侵入状态栏。 */
.lbl { grid-area: lbl; min-width: 0; max-width: 16ch; overflow-wrap: anywhere; font-size: 14px; font-weight: 500; }
.st { grid-area: st; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.status-line { display: flex; align-items: baseline; gap: 8px; }
.completed-at { font-size: 12px; white-space: nowrap; }
.stt { font-size: 14px; font-weight: 700; }
.stt.done { color: var(--ok); }
.stt.failed { color: var(--err); }
.stt.paused { color: var(--ink-3); }
.stt.pending, .stt.active { color: var(--orange-text); }
.stt.queued { color: var(--ink-3); font-weight: 500; }
.sub { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.job-note { color: var(--orange-text); }
.bar { grid-area: bar; min-width: 0; display: flex; align-items: center; gap: 10px; }
.bar .progress { flex: 1; min-width: 0; }
.progress.pause > div { background: var(--ink-3); }
.pc { width: 38px; flex-shrink: 0; text-align: right; }
.ja { grid-area: ja; display: flex; flex-wrap: nowrap; gap: 6px; justify-content: flex-end; min-width: 104px; }
.diag { white-space: nowrap; }
.del:hover:not(:disabled) { border-color: var(--err); color: var(--err); }
@media (max-width: 1200px) {
  .gbar { width: 200px; }
  .job { grid-template-columns: minmax(66px, max-content) minmax(0, 1fr) minmax(120px, 180px) max-content; column-gap: 12px; }
}
/* 窄窗：进度条换到第二行，按钮列永远不和进度/百分比重叠 */
@media (max-width: 1080px) {
  .job { grid-template-columns: minmax(66px, max-content) minmax(0, 1fr) max-content; grid-template-areas: "lbl st ja" ". bar bar"; }
  .gbar { width: 160px; }
}
@media (max-width: 900px) { .diag-t { display: none; } }
/* 发布详情需要可读宽度，小窗把状态与详情放到独立整行。 */
@media (max-width: 600px) {
  .gh { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; padding: 12px; }
  .ga { grid-column: 3; grid-row: 1; }
  .gbar { grid-column: 1 / -1; width: 100%; }
  .job { padding: 12px; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "lbl ja" "st st" "bar bar"; row-gap: 10px; }
}
.diag-layer { position: fixed; inset: 0; z-index: 60; background: rgb(0 0 0 / 38%); display: flex; justify-content: flex-end; }
.diag-drawer { width: min(520px, 92vw); height: 100%; margin: 0 !important; border-radius: 16px 0 0 16px; overflow: auto; box-shadow: var(--ui-shadow-surface); }
.drawer-enter-active, .drawer-leave-active { transition: opacity var(--ui-duration-base, .2s) var(--ui-ease-out, ease); }
.drawer-enter-active .diag-drawer, .drawer-leave-active .diag-drawer { transition: transform var(--ui-duration-base, .2s) var(--ui-ease-out, ease); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .diag-drawer, .drawer-leave-to .diag-drawer { transform: translateX(32px); }
.hooks { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.hooks .chip { gap: 4px; }
.hooks .tiny { height: 20px; padding: 0 7px; font-size: 11px; }
</style>
