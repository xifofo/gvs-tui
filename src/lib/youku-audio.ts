import { defaultAudioIndex } from './audio-selection.ts'
import { isUnknownAudioLanguage, resolveAudioLanguage } from './audio-language.ts'
import { mp4Lang, type Mp4Track } from './mp4box.ts'

/** Youku's original-language track may carry a generic English container tag.
 * A matched Chinese original is stronger evidence; explicit dub languages win.
 */
export function youkuAudioLanguage(selected = '', matchedOriginal = ''): string {
  return isUnknownAudioLanguage(selected) && matchedOriginal ? matchedOriginal : selected
}

/** Apply the compatibility preference only after inspecting the downloaded tracks.
 * Ordinary DTS and explicit user defaults keep their existing priority.
 */
export function youkuMuxAudios<T extends { lang?: string; isDefault?: boolean }>(
  audios: readonly T[], metadata: readonly (readonly Mp4Track[])[], manualDefault = false,
): Array<T & { isDefault: boolean }> {
  let index = defaultAudioIndex(audios)
  const actual = metadata.map(list => {
    const audio = list.filter(t => t.type === 'soun')
    return audio.length === 1 ? audio[0] : undefined
  })
  const current = actual[index]
  if (!manualDefault && metadata.length === audios.length
    && current && /^dts[xy]$/.test(current.codec) && current.channels === 10) {
    const language = mp4Lang(resolveAudioLanguage(audios[index]?.lang, current.language))
    const ddp = actual.findIndex((track, i) => track?.codec === 'ec-3' && track.channels === 6
      && mp4Lang(resolveAudioLanguage(audios[i]?.lang, track.language)) === language)
    if (ddp >= 0) index = ddp
  }
  return audios.map((audio, i) => ({ ...audio, isDefault: i === index }))
}
