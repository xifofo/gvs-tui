import { asString } from './util.ts'

// IQ's audio IDs are not subtitle IDs. The official audioInfoList identifies
// 6 as Japanese; some gateway responses incorrectly label it as French.
const AUDIO_LANGUAGES: Record<number, { language: string; name: string }> = {
  6: { language: 'jpn', name: '日语' },
}

/** Correct known source audio IDs without changing the requested track identity. */
export function normalizeIQAudioLanguage(row: Record<string, unknown>): Record<string, unknown> {
  const id = asString(row.id)
  const lid = Number(row.lid ?? (/^\d+:\d+:\d+$/.test(id) ? id.split(':')[0] : NaN))
  const known = AUDIO_LANGUAGES[lid]
  if (!known) return row
  const label = asString(row.label).replace(/^(?:法语|法語|French)(?=$|[\s·])/i, known.name)
  const title = asString(row.title).replace(/^(?:法语|法語|French)(?=$|[\s·])/i, known.name)
  return { ...row, lang: known.name, language: known.language,
    ...(label ? { label } : {}), ...(title ? { title } : {}) }
}
