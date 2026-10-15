import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configPath } from './config.ts'

export type TencentNativeEventCollect = 'off' | 'fixture' | 'file'
export type FixtureKind = 'watch' | 'qimei' | 'getfeature' | 'bosskv'

const DEFAULT_KINDS: FixtureKind[] = ['watch', 'qimei', 'getfeature']
const KIND_SET = new Set<string>(['watch', 'qimei', 'getfeature', 'bosskv'])

type TemplateFile = {
  kind: FixtureKind
  source?: 'android_app' | 'native_player'
  payload: Record<string, unknown>
}

export function defaultTencentNativeEventPath(): string {
  return join(dirname(configPath()), 'tencent-native-events.jsonl')
}

export function resolveTencentNativeTemplatesDir(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim()
  if (process.env.GVS_TENCENT_NATIVE_TEMPLATES?.trim()) return process.env.GVS_TENCENT_NATIVE_TEMPLATES.trim()
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'tencent-native-templates')
}

export function deviceGuidSha256(deviceGuid: string): string {
  const guid = deviceGuid.trim()
  if (!guid) throw new Error('TV device GUID required for fixture binding')
  return createHash('sha256').update(guid, 'utf8').digest('hex')
}

function loadTemplates(dir: string, kinds: FixtureKind[]): TemplateFile[] {
  if (!existsSync(dir)) throw new Error('native fixture templates directory missing')
  const out: TemplateFile[] = []
  for (const kind of kinds) {
    const path = join(dir, `${kind}.json`)
    if (!existsSync(path)) continue
    const raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as TemplateFile
    if (!KIND_SET.has(raw.kind) || raw.kind !== kind || !raw.payload || typeof raw.payload !== 'object') {
      throw new Error(`invalid fixture template: ${kind}`)
    }
    out.push(raw)
  }
  if (!out.length) throw new Error('no fixture templates selected')
  return out
}

function refreshPayload(kind: FixtureKind, payload: Record<string, unknown>, now: number, cid?: string, vid?: string): Record<string, unknown> {
  const body = structuredClone(payload)
  if (kind === 'watch') {
    const date = new Date(now)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    body.date = `${y}/${m}/${d}`
    body.update_time = now
    if (typeof body.played_time_mills !== 'number' || body.played_time_mills <= 0) body.played_time_mills = 12345
    body.filter_id = '|tv|'
    if (cid) body.cid = cid
    if (vid) body.vid = vid
  }
  if (kind === 'qimei') {
    const native = (body.native && typeof body.native === 'object' ? { ...(body.native as Record<string, unknown>) } : {})
    native.tm = String(now)
    if (typeof native.usec !== 'number') native.usec = 123456
    if (typeof native.nn !== 'string' || !native.nn) native.nn = 'fixture-nonce'
    if (typeof native.protobuf_base64 !== 'string' || !native.protobuf_base64) native.protobuf_base64 = 'CAESBHRlc3Q='
    if (native.cpt !== '1' && native.cpt !== '2') native.cpt = '2'
    body.native = native
  }
  if (kind === 'getfeature') {
    if (!body.scene) body.scene = 'start_up'
    if (!body.uuid) body.uuid = 'fixture-feature-uuid'
    if (!body.features || typeof body.features !== 'object') body.features = {}
  }
  return body
}

function eventId(kind: string): string {
  return `fixture-${kind}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
}

export type FeedFixturesOptions = {
  gateway: string
  account: string
  deviceGuid: string
  outPath?: string
  templatesDir?: string
  kinds?: FixtureKind[]
  delivery?: 'pending' | 'mirror'
  cid?: string
  vid?: string
  now?: number
}

export type FeedFixturesResult = {
  path: string
  written: number
  kinds: FixtureKind[]
  device_guid_sha256: string
}

/** Append fresh template-derived producer JSONL. Phone/adb is not used.
 * delivery defaults to pending so TUI preview/send can exercise the gateway path.
 * Templates are research-captured shapes; they are not a live Frida session. */
export function feedTencentNativeFixtures(opts: FeedFixturesOptions): FeedFixturesResult {
  const gateway = opts.gateway.replace(/\/+$/, '')
  if (!gateway) throw new Error('gateway origin required')
  const account = opts.account?.trim() || 'default'
  const guidHash = deviceGuidSha256(opts.deviceGuid)
  const kinds = (opts.kinds?.length ? opts.kinds : DEFAULT_KINDS).filter((k): k is FixtureKind => KIND_SET.has(k))
  const templates = loadTemplates(resolveTencentNativeTemplatesDir(opts.templatesDir), kinds)
  const now = opts.now ?? Date.now()
  const outPath = opts.outPath?.trim() || defaultTencentNativeEventPath()
  const absolute = isAbsolute(outPath) ? outPath : join(process.cwd(), outPath)
  mkdirSync(dirname(absolute), { recursive: true })
  const delivery = opts.delivery === 'mirror' ? 'mirror' : 'pending'
  let written = 0
  const used: FixtureKind[] = []
  for (const template of templates) {
    const payload = refreshPayload(template.kind, template.payload, now, opts.cid, opts.vid)
    const source = template.source === 'native_player' && template.kind === 'watch' ? 'native_player' : 'android_app'
    const sourceSha = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const event = {
      id: eventId(template.kind),
      kind: template.kind,
      source,
      source_sha256: sourceSha,
      device_guid_sha256: guidHash,
      observed_at: now,
      payload,
    }
    const record = { gateway, account, delivery, event }
    appendFileSync(absolute, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
    written++
    used.push(template.kind)
  }
  return { path: absolute, written, kinds: used, device_guid_sha256: guidHash }
}

export function listFixtureTemplateKinds(dir?: string): string[] {
  const root = resolveTencentNativeTemplatesDir(dir)
  if (!existsSync(root)) return []
  return readdirSync(root).filter(name => name.endsWith('.json')).map(name => name.replace(/\.json$/, '')).filter(k => KIND_SET.has(k))
}

export function resolveNativeCollectMode(cfg: { tencentNativeEventCollect?: TencentNativeEventCollect; tencentNativeEventFile?: string }): TencentNativeEventCollect {
  if (cfg.tencentNativeEventCollect === 'off' || cfg.tencentNativeEventCollect === 'fixture' || cfg.tencentNativeEventCollect === 'file') {
    return cfg.tencentNativeEventCollect
  }
  return cfg.tencentNativeEventFile?.trim() ? 'file' : 'off'
}
