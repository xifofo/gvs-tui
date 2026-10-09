// Explicit live integration: real Runtime and gateway, no demo fixtures or OS UI automation.
// Stops after ONE quality/stream probe. Never queues a download or logs in again.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Runtime } from '../src/runtime.ts'
import { GwClient } from '../src/lib/client.ts'
import { loadConfig } from '../src/lib/config.ts'
import type { Snapshot } from '../src/types.ts'

if (process.env.GVS_ALLOW_LIVE_FLOW !== '1' || process.env.GVS_PREVIEW) throw new Error('Explicit live flow opt-in required; demo/preview is not allowed')
const cfg = loadConfig()
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(cfg.host).hostname) || cfg.tencentMode !== 'tv' || !cfg.tencentObservations) throw new Error('This harness requires a local TV gateway with observations enabled')
const out = process.env.GVS_LOCAL_FLOW_OUT
if (!out) throw new Error('GVS_LOCAL_FLOW_OUT is required')
mkdirSync(out, { recursive: true })
const calls: Array<Record<string, unknown>> = []
const original = GwClient.prototype.invoke
let playCount = 0
GwClient.prototype.invoke = async function(provider, action, input, extra, opts) {
  if (provider !== 'tencent') throw new Error('Live flow is restricted to Tencent')
  if (action === 'login' || action === 'download') throw new Error('Live flow cannot log in again or enqueue downloads')
  if (action === 'play' && ++playCount > 1) throw new Error('Single playback probe budget exceeded')
  const record: Record<string, unknown> = { action, at: new Date().toISOString(), vid: input.vid, cid: input.cid }
  calls.push(record)
  try {
    const data = await original.call(this, provider, action, input, extra, opts)
    Object.assign(record, { em: data.em, code: data.code, has_url: data.has_url, network_error: data.network_error, formats: Array.isArray(data.formats) ? data.formats.length : 0 })
    return data
  } catch (error) { record.failed = true; throw error }
}

const runtime = new Runtime()
runtime.resize(120, 36)
const trace: Record<string, unknown> = { started_at: new Date().toISOString(), mode: 'live_first_party_runtime_keys', desktop_ui_automated: false, target: '兰香如故 第38集', host: cfg.host, calls }
let count = 0
function snapshot(label: string) {
  const s = runtime.snapshot
  const safe = { scene: s.scene, status: s.status, statusKind: s.statusKind, busy: s.busy, cursor: s.cursor, provider: s.detailProvider, detailTitle: s.detailTitle, episodeGroup: s.episodeGroup, probeFailed: s.probeFailed, rows: s.rows?.map(r => ({ id: r.id, title: r.title })), episodes: s.episodes?.map(e => ({ number: e.number, title: e.title, vid: e.vid, selected: e.selected, collection: e.collection })), qualities: s.qualities?.map(q => ({ id: q.id, label: q.label, width: q.width, height: q.height })), jobs: s.jobs?.length }
  writeFileSync(join(out!, `${String(++count).padStart(2,'0')}-${label}.json`), JSON.stringify(safe, null, 2))
  console.log(label, s.scene, s.status)
}
async function until(predicate: (s: Snapshot) => boolean, stage: string, timeout = 90_000) {
  const started = Date.now()
  while (!predicate(runtime.snapshot)) {
    if (Date.now() - started > timeout) throw new Error(`Timeout in ${stage}; scene=${runtime.snapshot.scene}; status=${runtime.snapshot.status}`)
    await Bun.sleep(100)
  }
  await Bun.sleep(80)
}

try {
  await until(s => s.scene === 'workspace' && !s.busy, 'local gateway bootstrap')
  snapshot('ready')
  runtime.handleKey('f2')
  runtime.set('query', '兰香如故')
  runtime.handleKey('enter')
  await until(s => s.scene === 'results' && !s.busy, 'search')
  snapshot('search-results')
  const rows = runtime.snapshot.rows || []
  let index = rows.findIndex(r => r.id === 'mzc00200803dr6b')
  if (index < 0) index = rows.findIndex(r => r.title === '兰香如故')
  if (index < 0) throw new Error('Exact target series not present in real search results')
  runtime.handleKey('home')
  for (let i = 0; i < index; i++) runtime.handleKey('down')
  runtime.handleKey('enter')
  await until(s => s.scene === 'detail' && !s.busy && !!s.episodes?.length, 'detail')
  const groups = runtime.snapshot.episodeGroups || []
  if (groups.includes('正片')) for (let i = 0; i < groups.length && runtime.snapshot.episodeGroup !== '正片'; i++) runtime.handleKey(']')
  snapshot('episode-catalog')
  const eps = runtime.snapshot.episodes || []
  index = eps.findIndex(e => /第\s*38\s*集/.test(e.title) && !/预告|采访|花絮/.test(e.title))
  if (index < 0) throw new Error('Episode 38 main feature is absent; do not substitute an extra or adjacent episode')
  trace.selected_episode = { vid: eps[index]!.vid, title: eps[index]!.title, collection: eps[index]!.collection }
  runtime.handleKey('c')
  runtime.handleKey('home')
  for (let i = 0; i < index; i++) runtime.handleKey('right')
  runtime.handleKey('space')
  snapshot('selected-ep38')
  runtime.handleKey('enter')
  await until(s => s.scene === 'quality' && !s.busy && (s.probeFailed || !!s.qualities?.length), 'single stream probe', 150_000)
  snapshot('stream-result')
  trace.outcome = runtime.snapshot.probeFailed ? 'upstream_or_probe_rejected' : 'stream_options_available'
  trace.play_invocations = playCount
  trace.download_enqueued = !!runtime.snapshot.jobs?.length
  if (playCount !== 1 || trace.download_enqueued) throw new Error('Live flow exceeded its approved probe scope')
} catch (error) {
  trace.outcome = 'incomplete'
  trace.error = error instanceof Error ? error.message : String(error)
  snapshot('incomplete')
  process.exitCode = 1
} finally {
  trace.finished_at = new Date().toISOString()
  writeFileSync(join(out, 'result.json'), JSON.stringify(trace, null, 2))
  runtime.close()
  GwClient.prototype.invoke = original
  console.log('Result:', trace.outcome, 'play calls:', playCount)
}
process.exit(process.exitCode || 0)
