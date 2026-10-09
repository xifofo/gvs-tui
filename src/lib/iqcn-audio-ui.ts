type AudioChoice = { id: string; lang: string; label: string; codec: string; isDefault: boolean; selected: boolean; embedded?: boolean }
export type IQCNAudioRow<T extends AudioChoice> = { audio: T; title: string; detail: string; recommended: boolean }

export function iqcnAudioGroups<T extends AudioChoice>(audios: readonly T[]): Array<{ language: string; items: IQCNAudioRow<T>[] }> {
  const groups = new Map<string, IQCNAudioRow<T>[]>()
  for (const audio of audios) {
    const language = audio.lang || '原声'
    const ct = Number(audio.id.split(':')[2])
    const codec = audio.codec.toLowerCase()
    let title = audio.label.replace(language, '').replace(/^[\s·]+|[\s·]+$/g, '') || '原声音轨'
    let detail = '保留平台提供的音轨'
    if (audio.id.startsWith('iqcn:') && codec === 'aac') {
      title = ct === 5 ? '高码率 AAC' : '标准 AAC'
      detail = ct === 5 ? '更高音频码率' : '日常观看，体积较小'
    } else if (/dolby|e-?ac-?3|ec-3|ddp/.test(codec)) {
      title = '杜比音效'
      detail = '保留平台提供的杜比音轨'
    }
    if (audio.embedded) detail = '随视频保留'
    const items = groups.get(language) || []
    items.push({ audio, title, detail, recommended: audio.isDefault })
    groups.set(language, items)
  }
  return [...groups].map(([language, items]) => ({ language, items }))
}
