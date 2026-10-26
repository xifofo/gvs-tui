import { test, expect } from 'bun:test'
import { Runtime } from './runtime'

/** The quality screen gains a 字幕 column only when probe returned tracks, and
 *  the picker's indexes must reach resolve through DlTask.subtitleTracks. */
test('subtitle column cycles in, toggles and reaches the download task', async () => {
  const runtime = new Runtime({ simulate: true })
  try {
    await Bun.sleep(80)
    const x = runtime as any
    x.audios = [{ id: '1', label: 'English', lang: 'en', codec: '', isDefault: true, selected: true }]
    x.subtitles = [
      { id: '1', label: '繁體中文', lang: 'zh-Hant', forced: false, sdh: false, selected: false, isDefault: false },
      { id: '2', label: 'English CC', lang: 'en', forced: false, sdh: false, selected: false, isDefault: false },
    ]
    x.qualities = [{ id: 'q', label: '1080p', title: '1080p', stream: '1080', size: 0, width: 1920, height: 1080, codec: 'H264', drm: 'None' }]
    x.qIdx = 0
    x.audioIdx = 0
    x.subtitleIdx = 0
    x.optionTab = 'quality'
    x.pending = [{ provider: 'appletvplus', vid: 'umc.cmc.x', quality: '', audioTracks: [], subtitleTracks: [] }]
    x.scene = 'quality'

    x.updateQuality('right')
    expect(x.optionTab).toBe('audio')
    x.updateQuality('right')
    expect(x.optionTab).toBe('subtitle')
    x.updateQuality('left')
    expect(x.optionTab).toBe('audio')
    x.updateQuality('right')

    x.updateQuality(' ')
    expect(x.subtitles[0].selected).toBe(true)
    x.updateQuality('down')
    x.updateQuality(' ')
    x.updateQuality('a')
    x.updateQuality('c')
    expect(x.subtitles.every((s: any) => !s.selected)).toBe(true)
    x.updateQuality('up')
    x.updateQuality(' ')

    x.applyOptions()
    expect(x.pending[0].subtitleTracks).toEqual([
      { id: '1', label: '繁體中文', lang: 'zh-Hant', forced: false, sdh: false, isDefault: false },
    ])

    x.emit()
    expect(runtime.snapshot.subtitles?.map((s) => s.id)).toEqual(['1', '2'])
    expect(runtime.snapshot.subtitleIndex).toBe(0)
    expect(runtime.snapshot.optionTab).toBe('subtitle')
  } finally {
    runtime.close()
  }
})

test('a platform without subtitle tracks never exposes the column', async () => {
  const runtime = new Runtime({ simulate: true })
  try {
    await Bun.sleep(80)
    const x = runtime as any
    x.audios = [{ id: '1', label: 'English', lang: 'en', codec: '', isDefault: true, selected: true }]
    x.subtitles = []
    x.qualities = [{ id: 'q', label: '1080p', title: '1080p', stream: '1080', size: 0, width: 1920, height: 1080, codec: 'H264', drm: 'None' }]
    x.optionTab = 'quality'
    x.pending = [{ provider: 'mgtv', vid: '1', quality: '', audioTracks: [] }]
    x.scene = 'quality'
    x.updateQuality('right')
    x.updateQuality('right')
    expect(x.optionTab).toBe('quality')
    x.applyOptions()
    expect(x.pending[0].subtitleTracks).toBeUndefined()
  } finally {
    runtime.close()
  }
})
