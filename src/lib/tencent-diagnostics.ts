import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { configPath } from './config.ts'

import type { TencentDiagnostic } from './diagnostic-types.ts'
export type { TencentDiagnostic } from './diagnostic-types.ts'
type Stored = TencentDiagnostic & { scope: string }
const token = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_.:-]{0,128}$/.test(v) ? v : ''
const statuses = new Set(['request_completed','request_error','risk_rejected','binding_invalid','rate_limited','rejected','stopped_locally','observed_locally','local_only_gateway_source_unsupported','unverified_response','delivery_unknown','preview','disabled','incomplete','transport_error','http_rejected','invalid_response','observation_error','unknown'])
const decisions = new Set(['stop_flow','reauth_required','no_automatic_resend','inspect_error','local_observation','local_only','not_acceptance_proof','continue'])
const safeStatus = (v: unknown) => typeof v === 'string' && statuses.has(v) ? v : 'unknown'
const safeDecision = (v: unknown) => typeof v === 'string' && decisions.has(v) ? v : 'inspect_error'
const scopeID = (scope: string) => createHash('sha256').update(scope).digest('hex')
export const tencentDiagnosticPath = () => process.env.GVS_TENCENT_DIAGNOSTICS_PATH || join(dirname(configPath()), 'tencent-diagnostics.jsonl')
export function writeTencentDiagnostic(scope: string, event: Omit<TencentDiagnostic, 'at'>): void {
  if (!scope) return
  const safe: Stored = { scope: scopeID(scope), at: new Date().toISOString(), flow: token(event.flow), operation: token(event.operation), job: token(event.job), action: token(event.action), phase: token(event.phase), status: safeStatus(event.status), decision: safeDecision(event.decision) }
  if (event.httpStatus && Number.isInteger(event.httpStatus) && event.httpStatus >= 100 && event.httpStatus <= 599) safe.httpStatus = event.httpStatus
  if (event.code && /^[0-9.]{1,16}$/.test(event.code)) safe.code = event.code
  try {
    const file = tencentDiagnosticPath(); mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file) && statSync(file).size > 2 * 1024 * 1024) renameSync(file, file + '.1')
    appendFileSync(file, JSON.stringify(safe) + String.fromCharCode(10), { mode: 0o600 })
  } catch { /* Diagnostics cannot change business results. */ }
}
export function readTencentDiagnostics(scope: string, job = '', limit = 100): TencentDiagnostic[] {
  if (!scope) return []
  const target = scopeID(scope); const out: TencentDiagnostic[] = []
  for (const file of [tencentDiagnosticPath() + '.1', tencentDiagnosticPath()]) {
    try {
      if (statSync(file).size > 3 * 1024 * 1024) continue
      for (const line of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
        try { const r = JSON.parse(line) as Stored; if (r.scope !== target || (job && r.job !== job)) continue; out.push({ at: String(r.at || '').slice(0,32), flow: token(r.flow), operation: token(r.operation), job: token(r.job), action: token(r.action), phase: token(r.phase), status: safeStatus(r.status), decision: safeDecision(r.decision), ...(Number.isInteger(r.httpStatus) ? { httpStatus: r.httpStatus } : {}), ...(token(r.code) ? { code: token(r.code) } : {}) }) } catch {}
      }
    } catch {}
  }
  return out.slice(-Math.max(1, Math.min(200, limit))).reverse()
}
