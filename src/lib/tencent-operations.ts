import { randomUUID } from 'node:crypto'
import { TencentNativeEventStop } from './tencent-native-events.ts'
import { errorCode } from './user-message.ts'
import { tencentRisk, TencentRiskStop } from './tencent-risk.ts'
import { writeTencentDiagnostic } from './tencent-diagnostics.ts'

export type ReportCall = (input: Record<string, unknown>) => Promise<Record<string, unknown>>
type Root = { flow: string; pending?: Promise<string>; binding?: string; rejected?: boolean; observationSources?: string[] }
export type TencentOperation = {
  root: Root; id: string; action: string; vid?: string; cid?: string
  started: number; cpu: NodeJS.CpuUsage
}
const id = (v: unknown): string | undefined => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v) ? v : undefined
const actions = new Set(['search', 'detail', 'resolve', 'play'])

/** The gateway has no `tencent/report` action. Observation must not block search or playback. */
function reportUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return errorCode(error) === 'ACTION_UNSUPPORTED' || /INVALID_PARAM/i.test(message) && /["']report["']/i.test(message)
}

/** Local observations, not simulated Android telemetry or Tencent signatures. */
export class TencentOperations {
  private root?: Root
  private readonly byContent = new Map<string, Root>()
  private download?: TencentOperation
  private sampleBase?: { at: number; bytes: number }
  private lastSample = 0
  private transferPending: Promise<void> = Promise.resolve()
  private transferBusy = false
  private transferClosed = false
  /** `false` after this gateway rejects `tencent/report`; later calls stay local. */
  private reportSupported?: boolean

  constructor(private readonly call: ReportCall, private readonly log: (s: string) => void, private readonly jobID = '', root?: Root, private readonly scope = '', private readonly source: 'tui_process' | 'electron_process' = 'tui_process', private readonly native?: (binding: string, call: ReportCall) => Promise<void>) { this.root = root }

  fork(jobID: string, vid?: string, call: ReportCall = this.call): TencentOperations {
    const root = (vid && this.byContent.get(vid)) || this.root || { flow: randomUUID() }
    return new TencentOperations(call, this.log, jobID, root, this.scope, this.source, this.native)
  }

  async begin(action: string, input: Record<string, unknown>): Promise<TencentOperation | undefined> {
    if (!actions.has(action)) return undefined
    if (action === 'search' || !this.root) this.root = { flow: randomUUID() }
    const root = this.root
    if (root.rejected) throw new Error('Tencent operation stopped after rejection; start a new user operation')
    if (this.reportSupported === false) root.observationSources = []
    else if (!root.pending) root.pending = this.call({ session_type: 'tv', report_type: 'bind', flow_id: root.flow }).then(data => {
      if (typeof data.binding !== 'string' || !data.binding) throw new Error('Tencent report binding unavailable')
      this.reportSupported = true
      root.binding = data.binding
      root.observationSources = Array.isArray(data.observation_sources)
        ? data.observation_sources.filter((value): value is string => typeof value === 'string')
        : ['tui_process']
      this.profileDiagnostics(root, data.adprofile)
      const bindingRisk = tencentRisk(data)
      if (bindingRisk.stop) { root.rejected = true; throw new TencentRiskStop(bindingRisk) }
      return root.binding
    }).catch(error => {
      // An optional reporting outage must not become a setup requirement.
      // Account/binding/risk rejections still stop the operation.
      const httpStatus = error && typeof error === 'object' ? Number((error as Record<string, unknown>).httpStatus) : 0
      if (tencentRisk(undefined, error).stop || httpStatus === 401) { root.rejected = true; throw error }
      const unsupported = reportUnsupported(error)
      if (unsupported) this.reportSupported = false
      root.observationSources = []
      const status = unsupported ? 'local_only_gateway_action_unsupported' : 'local_only_reporting_unavailable'
      this.log(`tencent_event action=bind phase=bind flow=${root.flow} status=${status}`)
      writeTencentDiagnostic(this.scope, { flow: root.flow, operation: '', job: this.jobID, action, phase: 'binding', status, decision: 'local_observation' })
      return ''
    })
    if (root.pending) await root.pending
    const op: TencentOperation = { root, id: randomUUID(), action, vid: id(input.vid), cid: id(input.cid), started: performance.now(), cpu: process.cpuUsage() }
    await this.record(op, 'start')
    return op
  }

  /** The gateway generates profiles while binding. Keep only typed status;
   * never copy profile values, protobuf, credentials or ciphertext to logs. */
  private profileDiagnostics(root: Root, value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const profile = value as Record<string, unknown>
    const status = profile.generated === true
      ? profile.complete === true ? 'profile_generated' : 'profile_generated_incomplete'
      : profile.status === 'observed_profile_retained' ? 'profile_observed_retained' : 'profile_generation_unavailable'
    writeTencentDiagnostic(this.scope, { flow: root.flow, operation: '', job: this.jobID, action: 'adprofile', phase: 'generation', status, decision: 'local_only' })
    this.log(`tencent_profile action=adprofile flow=${root.flow} status=${status}`)
    const registration = profile.qimei_registration
    if (!registration || typeof registration !== 'object' || Array.isArray(registration)) return
    const draft = registration as Record<string, unknown>
    // A cached issued identity is distinct from collector acceptance. Typed
    // status is the only data kept; unknown/new server values stay unverified.
    const registered = draft.identity_registered === true && draft.status === 'identity_registered' && draft.acceptance_scope === 'qimei_identity_only'
    const generated = draft.generated === true
    const complete = generated && draft.complete === true
    const prepared = complete && draft.payload_generated === true && draft.cipher_generated === true && draft.ready_to_send === true
    const qimeiStatus = registered ? 'qimei_identity_registered'
      : prepared ? 'qimei_profile_prepared'
      : complete ? 'qimei_profile_generated'
      : generated ? 'qimei_profile_incomplete' : 'qimei_profile_unavailable'
    writeTencentDiagnostic(this.scope, { flow: root.flow, operation: '', job: this.jobID, action: 'qimei', phase: 'generation', status: qimeiStatus, decision: registered ? 'local_only' : 'not_acceptance_proof' })
    this.log(`tencent_profile action=qimei flow=${root.flow} status=${qimeiStatus}`)
    const delivery = profile.registration_delivery
    if (delivery && typeof delivery === 'object' && !Array.isArray(delivery)) {
      const result = delivery as Record<string, unknown>
      if (result.stop === true) {
        const uncertain = result.delivery_unknown === true
        const unverified = result.status === 'registration_response_unverified'
          || result.status === 'blocked' && String(result.service_code) === '0'
        const response = result.response_diagnostics
        const diagnostic = response && typeof response === 'object' && !Array.isArray(response)
          ? response as Record<string, unknown> : undefined
        const responseStatuses: Record<string, string> = {
          invalid_envelope_or_payload: 'qimei_response_invalid',
          decryption_failed: 'qimei_response_decryption_failed',
          identity_not_issued: 'qimei_identity_not_issued',
          identity_ambiguous: 'qimei_identity_ambiguous',
        }
        const responseStatus = typeof diagnostic?.failure === 'string' ? responseStatuses[diagnostic.failure] : undefined
        writeTencentDiagnostic(this.scope, {
          flow: root.flow, operation: '', job: this.jobID, action: 'qimei', phase: 'delivery',
          status: uncertain ? 'delivery_unknown' : unverified ? 'qimei_registration_unverified' : 'rejected',
          decision: uncertain || unverified ? 'no_automatic_resend' : 'stop_flow',
          ...(typeof result.http_status === 'number' ? { httpStatus: result.http_status } : {}),
          ...(String(result.service_code ?? '').match(/^[0-9.]{1,16}$/) ? { code: String(result.service_code) } : {}),
        })
        if (unverified && responseStatus) writeTencentDiagnostic(this.scope, {
          flow: root.flow, operation: '', job: this.jobID, action: 'qimei', phase: 'response',
          status: responseStatus, decision: 'no_automatic_resend',
        })
      }
    }
  }

  boundInput(op: TencentOperation | undefined, input: Record<string, unknown>): Record<string, unknown> {
    return op?.root.binding ? { ...input, session_type: 'tv', report_binding: op.root.binding } : input
  }

  async finish(op: TencentOperation | undefined, data?: Record<string, unknown>, error?: unknown): Promise<void> {
    if (!op) return
    const risk = tencentRisk(data, error)
    const rejected = risk.stop
    writeTencentDiagnostic(this.scope, { flow: op.root.flow, operation: op.id, job: this.jobID, action: op.action, phase: 'decision', status: risk.status, decision: risk.decision, httpStatus: risk.httpStatus, code: risk.code })
    if (rejected) op.root.rejected = true
    const failed = !!error || data?.network_error === true
    if (data) this.remember(op.root, data)
    await this.record(op, failed ? 'error' : 'finish', rejected ? 'rejected' : failed ? 'error' : 'success')
    if (rejected || (error instanceof Error && /report_binding_/.test(error.message))) op.root.rejected = true
    if (op.action === 'play' && !failed && !rejected) {
      this.download = { ...op, id: randomUUID(), action: 'download', started: performance.now(), cpu: process.cpuUsage() }
    }
  }

  private remember(root: Root, data: Record<string, unknown>): void {
    for (const v of [data.vid, data.cid]) { const key = id(v); if (key) this.byContent.set(key, root) }
    if (Array.isArray(data.episodes)) for (const row of data.episodes) {
      if (row && typeof row === 'object') { const key = id((row as Record<string, unknown>).vid); if (key) this.byContent.set(key, root) }
    }
    while (this.byContent.size > 2000) this.byContent.delete(this.byContent.keys().next().value!)
  }

  observeTransfer(bytes: number, total: number): void {
    // HLS callbacks also carry a 0–1 ratio; it is not a byte measurement.
    if (!this.download || this.transferClosed || this.transferBusy || this.download.root.rejected || !Number.isFinite(bytes) || bytes < 0 || total === 1) return
    const now = performance.now()
    if (!this.sampleBase || bytes < this.sampleBase.bytes) this.sampleBase = { at: now, bytes }
    if (this.lastSample && now - this.lastSample < 5000 && (total <= 0 || bytes < total)) return
    this.lastSample = now
    const metrics: Record<string, number> = { downloaded_bytes: bytes }
    if (Number.isFinite(total) && total >= 0) metrics.total_bytes = total
    const elapsed = (now - this.sampleBase.at) / 1000
    if (elapsed > 0.2) metrics.rate_bytes_per_second = Math.max(0, bytes - this.sampleBase.bytes) / elapsed
    this.transferBusy = true
    this.transferPending = this.record(this.download, 'progress', undefined, metrics).catch(() => {}).finally(() => { this.transferBusy = false })
  }

  async closeTransfer(cancelled = false, failed = false): Promise<void> {
    this.transferClosed = true
    await this.transferPending
    if (this.download) await this.record(this.download, cancelled ? 'cancel' : failed ? 'error' : 'finish', cancelled ? 'cancelled' : failed ? 'error' : 'success').catch(() => {})
  }

  private async record(op: TencentOperation, phase: string, outcome?: string, extra?: Record<string, number>): Promise<void> {
    const cpu = process.cpuUsage(op.cpu)
    const mem = process.memoryUsage()
    const event = {
      flow_id: op.root.flow, operation_id: op.id, ...(this.jobID ? { job_id: this.jobID } : {}),
      action: op.action, phase, ...(outcome ? { outcome } : {}), ...(op.vid ? { vid: op.vid } : {}), ...(op.cid ? { cid: op.cid } : {}),
      at_ms: Date.now(), source: this.source,
      metrics: { elapsed_ms: Math.max(0, performance.now() - op.started), process_cpu_user_us: cpu.user, process_cpu_system_us: cpu.system, rss_bytes: mem.rss, heap_used_bytes: mem.heapUsed, ...extra },
    }
    try {
      const reply = !op.root.observationSources?.includes(this.source) || op.root.rejected
        ? { status: op.root.rejected ? 'stopped_locally' : 'local_only_gateway_source_unsupported' }
        : await this.call({ session_type: 'tv', report_type: 'observe', binding: op.root.binding, payload: JSON.stringify(event) })
      writeTencentDiagnostic(this.scope, { flow: op.root.flow, operation: op.id, job: this.jobID, action: op.action, phase, status: String(reply.status || 'unknown'), decision: 'local_observation' })
      this.log(`tencent_event action=${op.action} phase=${phase} outcome=${outcome || '-'} flow=${op.root.flow} operation=${op.id} job=${this.jobID || '-'} status=${String(reply.status || 'unknown')}`)
    } catch (error) {
      this.log(`tencent_event action=${op.action} phase=${phase} flow=${op.root.flow} status=observation_error`)
      if (errorCode(error) === 'ACCOUNT_BINDING_INVALID' || error instanceof Error && /report_binding_/.test(error.message)) { op.root.rejected = true; throw error }
      // Logging failures do not change playback; the main request validates its binding.
    }
    if (this.native && op.root.binding && !op.root.rejected) {
      try { await this.native(op.root.binding, this.call) }
      catch (error) {
        if (error instanceof TencentNativeEventStop) op.root.rejected = true
        throw error
      }
    }
  }
}
