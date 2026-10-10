import { asString, isObj } from './util.ts'

/** A stream vid is episode-specific. Preserve the selected tier, never send a
 * previous episode's vid or pick arbitrarily among equal-tier renditions. */
export function iqcnEpisodeRendition(
  data: Record<string, unknown>, tvid: string, selected: Record<string, string>, codec = '',
): Record<string, string> {
  if (asString(data.tvid) && asString(data.tvid) !== tvid) throw new Error('爱奇艺国内版返回了其他集的画质信息')
  const formats = Array.isArray(data.formats) ? data.formats.filter(isObj) : []
  const candidates = formats.filter(row => ['bid', 'br', 'fr'].every(k => asString(row[k]) === selected[k]))
  const exact = selected.vid ? candidates.filter(row => asString(row.vid) === selected.vid) : []
  let picked = exact.length === 1 ? exact[0] : undefined
  if (!picked) {
    const codecCode = /^(?:HEVC|H265|HVC1|DVHE|DVH1)$/i.test(codec) ? 1 : /^(?:AVC|H264|AVC1)$/i.test(codec) ? 2 : /^AV1$/i.test(codec) ? 5 : 0
    const compatible = candidates.filter(row => !codecCode || Number(row.codec_code) === codecCode)
    if (compatible.length !== 1) throw new Error('当前集缺少所选画质，或存在多个同档版本；请单独选择该集的画质')
    picked = compatible[0]
  }
  const vid = asString(picked!.vid)
  if (!/^[A-Za-z0-9]+$/.test(vid)) throw new Error('当前集未返回有效视频标识')
  return { ...selected, vid }
}
