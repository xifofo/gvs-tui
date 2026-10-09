import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { defaultConfig, configPath } from '../src/lib/config.ts'
import { GwClient } from '../src/lib/client.ts'
import { JobHub, youkuDRM } from '../src/lib/jobs.ts'
import { reexecWithoutProxy } from '../src/lib/proxy.ts'
await reexecWithoutProxy()
process.env.GVS_TUI_LOG = '0'
process.env.GVS_KEEP_INTERMEDIATES = '1'
const cfgFile = configPath()
const digest = () => createHash('sha256').update(readFileSync(cfgFile)).digest('hex')
const before = digest()
const saved = JSON.parse(readFileSync(cfgFile, 'utf8'))
const records = JSON.parse(readFileSync(join(process.env.APPDATA!, 'gvs', 'jobs.json'), 'utf8'))
const rec = records.jobs.find((r: any) => r.task.provider === 'youku' && r.task.vid === 'XNjQ3MzYyNjYzMg==' && r.task.episode === 1)
if (!rec || !saved.youkuSign || !saved.key) throw new Error('Expected task or credential absent; no request sent')
const root = resolve('tmp', 'taigu-diagnostic-' + Date.now())
mkdirSync(root, { recursive: true })
const cfg = { ...defaultConfig(), ...saved, ...rec.pin, outDir: join(root, 'output'), tmpDir: join(root, 'scratch') }
function clean(value: unknown) {
  let s = String(value ?? '')
  for (const k of ['key','youkuSign','tencentCookie','douyinCookie']) if (saved[k]) s = s.split(saved[k]).join('<redacted>')
  if (s.includes('http://') || s.includes('https://') || s.includes('--key')) return '<network/tool detail omitted>'
  return s
}
function record(event: unknown) { appendFileSync(join(root, 'events.jsonl'), JSON.stringify(event) + String.fromCharCode(10)) }
const cli = new GwClient(cfg.host, cfg.key, () => cfg)
const invoke = cli.invoke.bind(cli)
let playCalls = 0
cli.invoke = async (...args: Parameters<GwClient['invoke']>) => {
  if (args[0] !== 'youku' || args[1] !== 'play' || args[2].vid !== rec.task.vid || ++playCalls > 1) throw new Error('Diagnostic guard: one play request only')
  record({ event: 'play_start', time: new Date().toISOString(), vid: rec.task.vid, credentialPresent: true })
  const data = await invoke(...args)
  const drm = youkuDRM(data)
  record({ event: 'play_result', time: new Date().toISOString(), keys: Object.keys(data), drm: { videoEnc: drm.videoEnc, audioEnc: drm.audioEnc, keyPresent: !!drm.reKey } })
  return data
}
console.log(JSON.stringify({ root, episode: 1, quality: rec.task.quality, existingCredentials: true, newTunnel: false }))
let finish!: (v: unknown) => void
const done = new Promise(resolve => { finish = resolve })
let lastStage = ''
const hub = new JobHub(e => {
  const entry = { time: new Date().toISOString(), status: e.status, pct: e.pct, log: clean(e.log), err: clean(e.err), done: !!e.done }
  record(entry)
  if (e.status !== lastStage || e.done) { console.log(JSON.stringify(entry)); lastStage = e.status }
  if (e.done) finish(entry)
})
const deadline = setTimeout(() => { void hub.cancel(93001, 'pause') }, 180000)
hub.enqueue(cfg, cli, 93001, rec.task)
const result = await done
clearTimeout(deadline)
const report = { root, result, playCalls, configUnchanged: before === digest(), runtime: 'Bun shared source pipeline, not Electron UI' }
writeFileSync(join(root, 'result.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
process.exit(0)
