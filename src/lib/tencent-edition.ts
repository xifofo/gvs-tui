import type { TencentPlayParams } from '../types.ts'
import { asString, isObj } from './util.ts'

/** Only stable, known edition fields may survive into tasks. VID is supplied
 * by the selected episode, never copied from another episode's play_params. */
export function tencentEpisodePlayParams(row: Record<string, unknown>, detail: Record<string, unknown> = {}): TencentPlayParams | undefined {
  const params = isObj(row.play_params) ? row.play_params : {}
  const edition = asString(row.edition) || asString(params.edition) || asString(detail.edition)
  if (edition.toLowerCase() !== 'imax') return undefined
  const cid = asString(row.cid) || asString(params.cid) || asString(detail.cid)
  return { edition: 'imax', defn: 'imax', session_type: 'tv', ...(/^[a-z0-9]{15}$/.test(cid) ? { cid } : {}) }
}
