import { isObj } from './util.ts'

export type TitleKind = 'movie' | 'show'

function kindLabel(value: unknown): TitleKind | undefined {
  if (Array.isArray(value)) {
    for (const item of value) { const kind = kindLabel(item); if (kind) return kind }
    return
  }
  if (isObj(value)) return kindLabel(value.name) || kindLabel(value.label)
  if (typeof value !== 'string') return
  const text = value.trim().toLowerCase()
  if (/^(movie|film|电影|電影|网络电影|網絡電影)$/.test(text)) return 'movie'
  if (/^(tv|show|series|tv_series|tv series|电视剧|電視劇|剧集|劇集|综艺|綜藝|短剧)$/.test(text)) return 'show'
  // Labels can combine a content type with a genre, e.g. 电影 / 犯罪.
  if (/(^|[\s/·,，|])(?:电影|電影)(?=$|[\s/·,，|])/.test(text)) return 'movie'
  if (/(^|[\s/·,，|])(?:电视剧|電視劇|剧集|劇集|综艺|綜藝)(?=$|[\s/·,，|])/.test(text)) return 'show'
}

/** Read content metadata only. One episode or an animation genre is not proof of a movie. */
export function mediaKindFromMetadata(data: Record<string, unknown>): TitleKind | undefined {
  for (const source of [data, data.meta, data.raw, data.show]) {
    if (!isObj(source)) continue
    for (const key of ['media_type', 'mediaType', 'kind', 'type', 'content_type', 'contentType', 'category', 'channel', 'channel_name', 'type_name', 'tags']) {
      const kind = kindLabel(source[key])
      if (kind) return kind
    }
  }
}

/** A feature's own title is not an edition suffix. Keep actual language/version labels. */
export function movieEdition(title: string, featureTitle: string): string {
  return title && title !== featureTitle && title !== '正片' ? title : ''
}
