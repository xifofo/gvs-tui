import { truncate } from './util.ts'
import type { FileConfig } from './config.ts'
import { fetchGateway } from './proxy.ts'
import { runLog, summarizeInput, summarizeResult } from './runlog.ts'
import { TencentOperations, type TencentOperation } from './tencent-operations.ts'
import { randomUUID } from 'node:crypto'
import { normalizeIQCookie } from './iq.ts'
import { tencentRisk, TencentRiskStop } from './tencent-risk.ts'
import { writeTencentDiagnostic } from './tencent-diagnostics.ts'
import { userMessage } from './user-message.ts'
import { retryAfterMillis } from './iqcn-control.ts'
export type KeyInfo = {
  id: string
  name: string
  prefix: string
  scope: string[]
  all: boolean
  qps: number
  daily: number
  usedToday: number
  expiresAt: string | null
  permanent: boolean
  daysLeft: number | null
}

type Envelope = { code: number; msg: string; data: unknown; error_code?: string; request_id?: unknown; diagnostics?: unknown }

/** 优酷登录态失效（本地 Yk-Sign 过期或被踢）。调用方应清掉本地签名并引导重新扫码。 */
export class ReloginRequired extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReloginRequired'
  }
}

const RELOGIN_RE = /requires re-login|needs_relogin|invalid Yk-Sign/i

/** Default invoke abort; Tencent catalog play (source+caption) often exceeds 45s. */
const DEFAULT_TIMEOUT_MS = 45_000
const TENCENT_PLAY_TIMEOUT_MS = 120_000

export const GW_ACCOUNT_HEADER = 'X-Gvs-Account'
export const GW_DEFAULT_ACCOUNT = 'default'
export type GatewayAccountsInfo = { multiAccount: true; providers: string[]; header: string }

/** 本地账号槽位 id → 网关账号 id（^[a-z0-9][a-z0-9_-]{0,31}$） */
export function gatewayAccountId(slotId: string): string {
  let id = slotId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '')
  if (id.length > 32) id = id.slice(0, 20) + '-' + hashTail(slotId)
  if (!id || id === GW_DEFAULT_ACCOUNT) id = 'a' + hashTail(slotId)
  return id
}
function hashTail(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

export class GwClient {
  host: string
  key: string
  /** 读当前配置；给抖音请求自动带上 Dy-Cookie（调用方不用逐处传 extra）。 */
  private cfgOf?: () => FileConfig | undefined
  private proxyOf: () => string | undefined = () => undefined
  private operations?: TencentOperations
  private operationScope = ''
  private diagnosticJobID = ''
  private readonly source: 'tui_process' | 'electron_process'
  /**
   * 多账号网关（/v1/accounts multiAccount=true）：返回这次请求要用的网关账号 id。
   * 空 / 'default' = 旧行为（网关按 Key 的默认会话）。旧网关从不设置。
   */
  accountFor?: (provider: string) => string | undefined

  constructor(host: string, key: string, cfgOf?: (() => FileConfig | string | undefined) | string, source: 'tui_process' | 'electron_process' = 'tui_process') {
    this.host = host.replace(/\/+$/, '')
    this.key = key
    this.source = source
    if (typeof cfgOf !== 'function') {
      const fixed = cfgOf ?? ''
      this.proxyOf = () => fixed
      return
    }
    this.cfgOf = () => {
      const value = cfgOf()
      return value && typeof value === 'object' ? value : undefined
    }
    this.proxyOf = () => {
      const value = cfgOf()
      if (typeof value === 'string') return value
      return value?.gatewayProxy
    }
  }

  private operationTracker(): TencentOperations {
    const scope = `${this.host}\0${this.key}`
    if (!this.operations || this.operationScope !== scope) {
      this.operationScope = scope
      this.operations = new TencentOperations(async input => {
        const envelope = await this.request('POST', '/v1/invoke', { provider: 'tencent', action: 'report', input }, undefined, 5000)
        return (envelope.data ?? {}) as Record<string, unknown>
      }, runLog, this.diagnosticJobID, undefined, scope, this.source)
    }
    return this.operations
  }

  forkTencentJob(jobID: number, vid: string): GwClient {
    const child = new GwClient(this.host, this.key, this.cfgOf, this.source)
    child.proxyOf = this.proxyOf
    child.diagnosticJobID = String(jobID)
    child.accountFor = this.accountFor
    if (!this.cfgOf?.()?.tencentObservations && process.env.GVS_TENCENT_OBSERVE !== '1') return child
    child.operations = this.operationTracker().fork(String(jobID), vid, async input => {
      const envelope = await child.request('POST', '/v1/invoke', { provider: 'tencent', action: 'report', input }, undefined, 5000)
      return (envelope.data ?? {}) as Record<string, unknown>
    })
    child.operationScope = `${child.host}\0${child.key}`
    return child
  }

  /** 固定某平台用某个网关账号（下载任务入队时锁定，之后切换「当前账号」不影响它） */
  fixedAccount(provider: string, account: string | undefined): GwClient {
    if (!account || account === GW_DEFAULT_ACCOUNT) {
      if (!this.accountFor?.(provider)) return this
    }
    const child = new GwClient(this.host, this.key, this.cfgOf, this.source)
    child.proxyOf = this.proxyOf
    child.diagnosticJobID = this.diagnosticJobID
    const parent = this.accountFor
    child.accountFor = (p) => (p === provider ? account || GW_DEFAULT_ACCOUNT : parent?.(p))
    return child
  }

  /** 网关多账号能力；旧网关（没有 /v1/accounts）返回 null */
  async accountsInfo(): Promise<GatewayAccountsInfo | null> {
    try {
      const env = await this.request('GET', '/v1/accounts', undefined, undefined, 10_000)
      const d = (env.data ?? {}) as Partial<GatewayAccountsInfo>
      if (d.multiAccount !== true || !Array.isArray(d.providers)) return null
      return { multiAccount: true, providers: d.providers.filter((x): x is string => typeof x === 'string'), header: typeof d.header === 'string' ? d.header : GW_ACCOUNT_HEADER }
    } catch {
      return null
    }
  }

  /** 在网关登记账号；已存在算成功 */
  async ensureAccount(provider: string, id: string, name: string): Promise<void> {
    try {
      await this.request('POST', '/v1/accounts', { provider, id, name: name.slice(0, 64) }, undefined, 10_000)
    } catch (e) {
      if ((e as { httpStatus?: number }).httpStatus === 409 && !/LIMIT/i.test(String((e as Error).message))) return
      throw e
    }
  }

  async renameAccount(provider: string, id: string, name: string): Promise<void> {
    await this.request('PATCH', `/v1/accounts/${encodeURIComponent(id)}`, { provider, name: name.slice(0, 64) }, undefined, 10_000)
  }

  /** 网关会先注销这个账号的平台会话再删除登记 */
  async deleteAccount(provider: string, id: string): Promise<void> {
    try {
      await this.request('DELETE', `/v1/accounts/${encodeURIComponent(id)}?provider=${encodeURIComponent(provider)}`, undefined, undefined, 20_000)
    } catch (e) {
      if ((e as { httpStatus?: number }).httpStatus === 404) return
      throw e
    }
  }

  observeTencentTransfer(bytes: number, total: number): void { this.operations?.observeTransfer(bytes, total) }
  async closeTencentTransfer(cancelled = false, failed = false): Promise<void> { await this.operations?.closeTransfer(cancelled, failed) }

  allows(scope: string[] | undefined, all: boolean, name: string): boolean {
    if (all) return true
    if (!scope || scope.length === 0) return false
    return scope.includes(name)
  }

  /** 请求头。`skipSign` 只影响这一次调用 —— 不要为了降级去改用户的配置文件。 */
  extra(cfg: FileConfig, provider: string, skipSign = false): Record<string, string> {
    const h: Record<string, string> = {}
    if (provider === 'youku' && cfg.youkuSign && !skipSign) h['Yk-Sign'] = cfg.youkuSign
    if (provider === 'tencent' && (!cfg.tencentMode || cfg.tencentMode === 'cookie') && cfg.tencentCookie) h['Tx-Cookie'] = cfg.tencentCookie
    if (provider === 'douyin' && cfg.douyinCookie) h['Dy-Cookie'] = cfg.douyinCookie
    if (provider === 'iq' && cfg.iqCookie) h['Iq-Cookie'] = normalizeIQCookie(cfg.iqCookie)
    if (provider === 'iq' && cfg.iqProfile) h['Iq-Profile'] = cfg.iqProfile
    return h
  }

  async invoke(
    provider: string,
    action: string,
    input: Record<string, unknown>,
    extra?: Record<string, string>,
    opts?: { timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    let operation: TencentOperation | undefined
    let tracker: TencentOperations | undefined
    const cfg = this.cfgOf?.()
    if (provider === 'tencent' && action !== 'report' && (cfg?.tencentObservations || process.env.GVS_TENCENT_OBSERVE === '1') && (input.session_type === 'tv' || cfg?.tencentMode === 'tv')) {
      tracker = this.operationTracker()
      try { operation = await tracker.begin(action, input) } catch (error) {
        const risk = tencentRisk(undefined, error)
        writeTencentDiagnostic(this.host + String.fromCharCode(0) + this.key, { flow: '', operation: randomUUID(), job: this.diagnosticJobID, action, phase: 'binding', status: risk.status, decision: risk.decision })
        throw error
      }
      input = tracker.boundInput(operation, input)
    }
    const timeoutMs =
      opts?.timeoutMs ??
      (provider === 'tencent' && action === 'play' ? TENCENT_PLAY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
    const account = this.accountFor?.(provider)
    if (account && account !== GW_DEFAULT_ACCOUNT) {
      // 账号的凭证已经托管在网关该账号下；别再用全局配置里的 Cookie 头覆盖它
      const { 'Iq-Cookie': _iq, 'Tx-Cookie': _tx, 'Dy-Cookie': _dy, ...rest } = extra ?? {}
      extra = { ...rest, [GW_ACCOUNT_HEADER]: account }
    }
    if (provider === 'douyin' && !extra?.['Dy-Cookie'] && !(account && account !== GW_DEFAULT_ACCOUNT)) {
      const ck = this.cfgOf?.()?.douyinCookie
      if (ck) extra = { ...extra, 'Dy-Cookie': ck }
    }
    const diagnosticOperation = operation?.id || randomUUID()
    const diagnostic = (data?: Record<string, unknown>, error?: unknown) => {
      const risk = tencentRisk(data, error)
      if (provider === 'tencent') {
        writeTencentDiagnostic(this.host + String.fromCharCode(0) + this.key, { flow: operation?.root.flow || '', operation: diagnosticOperation, job: this.diagnosticJobID, action, phase: error ? 'error' : 'decision', status: risk.status, decision: risk.decision, httpStatus: risk.httpStatus, code: risk.code })
        const code = risk.code && /^[0-9.]{1,16}$/.test(risk.code) ? risk.code : '-'
        runLog(`tencent_decision action=${action} source=${this.source} observations=${cfg?.tencentObservations || process.env.GVS_TENCENT_OBSERVE === '1' ? 'on' : 'off'} job=${this.diagnosticJobID || '-'} status=${risk.status} decision=${risk.decision} code=${code} http=${risk.httpStatus || '-'}`)
      }
      return risk
    }
    const t0 = Date.now()
    const headerNote = extra
      ? Object.keys(extra)
          .map((k) => (/yk-sign|tx-cookie|cookie|authorization|token/i.test(k) ? `${k}=***` : k))
          .join(',')
      : ''
    try {
      const env = await this.request(
        'POST',
        '/v1/invoke',
        { provider, action, input },
        extra,
        timeoutMs,
      )
      const data = (env.data ?? {}) as Record<string, unknown>
      await tracker?.finish(operation, data)
      const risk = diagnostic(data)
      if (provider === 'tencent' && risk.stop) throw new TencentRiskStop(risk)
      runLog(
        `invoke ${provider}/${action} ${summarizeInput(input)}${headerNote ? ` hdr=${headerNote}` : ''} ${Date.now() - t0}ms ok ${summarizeResult({ ...data, code: env.code, msg: env.msg })}`,
      )
      return data
    } catch (e) {
      diagnostic(undefined, e)
      if (!(e instanceof TencentRiskStop)) await tracker?.finish(operation, undefined, e).catch(() => {})
      const msg = e instanceof Error ? e.message : String(e)
      const fields = e && typeof e === 'object' ? e as Record<string, unknown> : {}
      const http = typeof fields.httpStatus === 'number' && fields.httpStatus >= 100 && fields.httpStatus <= 599 ? fields.httpStatus : '-'
      const code = typeof fields.code === 'number' && Number.isFinite(fields.code) ? fields.code : '-'
      const errorCode = typeof fields.errorCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(fields.errorCode) ? fields.errorCode : '-'
      const requestId = typeof fields.requestId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(fields.requestId) ? fields.requestId : '-'
      const details = safeGatewayDiagnostics(fields.diagnostics)
      const stage = details?.stage ?? '-'
      const upstreamHttp = details?.upstream_http ?? '-'
      runLog(
        `invoke ${provider}/${action} ${summarizeInput(input)}${headerNote ? ` hdr=${headerNote}` : ''} ${Date.now() - t0}ms fail http=${http} code=${code} error_code=${errorCode} request_id=${requestId} stage=${stage} upstream_http=${upstreamHttp} ${truncate(msg, 160)}`,
      )
      throw e
    }
  }

  async keyInfo(): Promise<KeyInfo> {
    const env = await this.request('GET', '/v1/key')
    return (env.data ?? {}) as KeyInfo
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Envelope> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.key}` }
    let payload: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    if (extra) Object.assign(headers, extra)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetchGateway(`${this.host}${path}`, { method, headers, body: payload, signal: ac.signal }, this.proxyOf() ?? '')
    } catch (error) {
      if (ac.signal.aborted) throw Object.assign(new Error('请求等待超时，请检查网络后重试。'), { errorCode: 'TIMEOUT' })
      throw error
    } finally {
      clearTimeout(timer)
    }
    const text = await res.text()
    let env: Envelope
    try {
      env = JSON.parse(text) as Envelope
      if (!env || typeof env !== 'object' || typeof env.code !== 'number') throw new Error('invalid envelope')
    } catch {
      throw new Error(`http ${res.status}: ${truncate(text, 180)}`)
    }
    if (!res.ok || env.code !== 0) {
      const message = limitError(typeof env.msg === 'string' ? env.msg : '') || `http ${res.status}`
      const error = env.error_code === 'RELOGIN_REQUIRED' || RELOGIN_RE.test(message) ? new ReloginRequired(message) : new Error(message)
      const rawRequestId = env.request_id ?? res.headers.get('X-Request-ID')
      const requestId = typeof rawRequestId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(rawRequestId) ? rawRequestId : undefined
      throw Object.assign(error, { httpStatus: res.status, code: env.code, errorCode: env.error_code || '', requestId,
        diagnostics: safeGatewayDiagnostics(env.diagnostics),
        retryAfterMs: retryAfterMillis(res.headers.get('Retry-After')), userMessage: userMessage({ message, error_code: env.error_code }) })
    }
    return env
  }
}

function limitError(msg: string): string {
  if (/tui tunnel offline/i.test(msg)) return '隧道未连接（优酷/腾讯/黄果需要家宽出口）'
  switch (msg) {
    case 'IP_LIMITED':
      return '这把 Key 10 分钟内已在 2 个 IP 用过'
    default:
      return msg
  }
}

/** Retain only server-provided failure coordinates; never log arbitrary data. */
function safeGatewayDiagnostics(value: unknown): { stage: string; upstream_http?: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const row = value as Record<string, unknown>
  if (typeof row.stage !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(row.stage)) return
  const upstream = typeof row.upstream_http === 'number' && Number.isInteger(row.upstream_http)
    && row.upstream_http >= 100 && row.upstream_http <= 599 ? row.upstream_http : undefined
  return { stage: row.stage, ...(upstream ? { upstream_http: upstream } : {}) }
}
