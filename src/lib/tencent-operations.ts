import { randomUUID } from 'node:crypto'
import { tencentRisk } from './tencent-risk.ts'
import { writeTencentDiagnostic } from './tencent-diagnostics.ts'

export type ReportCall = (input: Record<string, unknown>) => Promise<Record<string, unknown>>
type Root = { flow: string; pending?: Promise<string>; binding?: string; rejected?: boolean }
export type TencentOperation = {
  root: Root; id: string; action: string; vid?: string; cid?: string
  started: number; cpu: NodeJS.CpuUsage
}
const id = (v: unknown): string | undefined => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v) ? v : undefined
const actions = new Set(['search', 'detail', 'resolve', 'play'])

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

  constructor(private readonly call: ReportCall, private readonly log: (s: string) => void, private readonly jobID = '', root?: Root, private readonly scope = '', private readonly source: 'tui_process' | 'electron_process' = 'tui_process') { this.root = root }

  fork(jobID: string, vid?: string, call: ReportCall = this.call): TencentOperations {
    const root = (vid && this.byContent.get(vid)) || this.root || { flow: randomUUID() }
    return new TencentOperations(call, this.log, jobID, root, this.scope, this.source)
  }

  async begin(action: string, input: Record<string, unknown>): Promise<TencentOperation | undefined> {
    if (!actions.has(action)) return undefined
    if (action === 'search' || !this.root) this.root = { flow: randomUUID() }
    const root = this.root
    if (root.rejected) throw new Error('Tencent operation stopped after rejection; start a new user operation')
    if (!root.pending) root.pending = this.call({ session_type: 'tv', report_type: 'bind', flow_id: root.flow }).then(data => {
      if (typeof data.binding !== 'string' || !data.binding) throw new Error('Tencent report binding unavailable')
      root.binding = data.binding
      return root.binding
    })
    await root.pending
    const op: TencentOperation = { root, id: randomUUID(), action, vid: id(input.vid), cid: id(input.cid), started: performance.now(), cpu: process.cpuUsage() }
    await this.record(op, 'start')
    return op
  }

  boundInput(op: TencentOperation | undefined, input: Record<string, unknown>): Record<string, unknown> {
    return op ? { ...input, session_type: 'tv', report_binding: op.root.binding } : input
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
    if (!this.download || this.transferClosed || this.transferBusy || this.download.root.rejected || !Number.isFinite(bytes) || bytes < 0) return
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
    if (this.download && (this.sampleBase || failed || cancelled)) await this.record(this.download, cancelled ? 'cancel' : failed ? 'error' : 'finish', cancelled ? 'cancelled' : failed ? 'error' : 'success').catch(() => {})
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
      const reply = this.source === 'electron_process' || op.root.rejected
        ? { status: op.root.rejected ? 'stopped_locally' : 'local_only_gateway_source_unsupported' }
        : await this.call({ session_type: 'tv', report_type: 'observe', binding: op.root.binding, payload: JSON.stringify(event) })
      writeTencentDiagnostic(this.scope, { flow: op.root.flow, operation: op.id, job: this.jobID, action: op.action, phase, status: String(reply.status || 'unknown'), decision: 'local_observation' })
      this.log(`tencent_event action=${op.action} phase=${phase} outcome=${outcome || '-'} flow=${op.root.flow} operation=${op.id} job=${this.jobID || '-'} status=${String(reply.status || 'unknown')}`)
    } catch (error) {
      this.log(`tencent_event action=${op.action} phase=${phase} flow=${op.root.flow} status=observation_error`)
      if (error instanceof Error && /report_binding_/.test(error.message)) { op.root.rejected = true; throw error }
      // Logging failures do not change playback; the main request validates its binding.
    }
  }
}
