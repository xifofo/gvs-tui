export type RiskDecision = { stop: boolean; status: string; decision: string; httpStatus?: number; code?: string }
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export class TencentRiskStop extends Error {
  constructor(readonly risk: RiskDecision) { super(`腾讯请求已停止（${risk.code || risk.httpStatus || risk.status}）；请检查账号状态或按官方提示处理，不会自动重试`); this.name = 'TencentRiskStop' }
}
export function tencentRisk(data?: Record<string, unknown>, error?: unknown): RiskDecision {
  const root = data || {}; const raw = object(root.raw); const rows = [root,raw,object(root.error),object(error)]
  const message = [error instanceof Error ? error.message : '', ...rows.map(r => String(r.msg || r.message || ''))].join(' ')
  if (/report_binding_(invalid|expired|owner_mismatch|stale_session)/.test(message)) return { stop: true, status: 'binding_invalid', decision: 'reauth_required' }
  for (const row of rows) {
    const code = String(row.em ?? row.code ?? ''); const httpStatus = Number(row.http_status || row.httpStatus || 0)
    if (/^9[34]([.]|$)/.test(code)) return { stop: true, status: 'risk_rejected', decision: 'stop_flow', code }
    if (row.stop === true || httpStatus === 403 || httpStatus === 429) return { stop: true, status: httpStatus === 429 ? 'rate_limited' : 'rejected', decision: 'stop_flow', ...(httpStatus ? { httpStatus } : {}) }
    if (row.delivery_unknown === true) return { stop: false, status: 'delivery_unknown', decision: 'no_automatic_resend' }
  }
  if (/限制播放|多地登录|(?:HTTP|http|status)[ :]*429/.test(message)) return { stop: true, status: 'risk_rejected', decision: 'stop_flow' }
  if (error instanceof TencentRiskStop) return error.risk
  if (error) return { stop: false, status: 'request_error', decision: 'inspect_error' }
  const state = String(root.status || '')
  if (['preview','disabled','incomplete','unverified_response','observed_locally','transport_error','http_rejected','rejected','invalid_response'].includes(state)) return { stop: false, status: state, decision: state === 'observed_locally' ? 'local_only' : 'not_acceptance_proof' }
  return { stop: false, status: 'request_completed', decision: 'continue' }
}
