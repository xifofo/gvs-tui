const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const profileStates = new Set(['pending', 'blocked', 'rejected', 'delivery_unknown', 'registration_response_unverified', 'http_rejected', 'invalid_response', 'binding_invalid'])

/** Compatibility with gateways that promoted an optional registration stop into
 * the authenticated binding envelope. Never apply this to business responses. */
export function tencentProfileStoppedBinding(data: Record<string, unknown>): boolean {
  if (typeof data.binding !== 'string' || !data.binding) return false
  const delivery = object(object(data.adprofile).registration_delivery)
  if (delivery.stop !== true || !profileStates.has(String(delivery.status || ''))) return false
  // A transport/auth/business error alongside profile diagnostics remains fatal.
  if (['em', 'code', 'http_status', 'httpStatus', 'error', 'raw'].some(key => data[key] !== undefined)) return false
  if (data.stop === true) return data.status === delivery.status
  return data.status === 'bound'
}
