import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { ffmpegGroupArgs, groupTagsXML, releaseGroup, withMkvGroupTags } from './release-group.ts'

test('release group uses the saved task value or trimmed settings fallback', () => {
  expect(releaseGroup({ group: ' WF ' }, { releaseGroup: 'NEW' })).toBe('WF')
  expect(releaseGroup({ group: '' }, { releaseGroup: ' WF ' })).toBe('WF')
  expect(releaseGroup({ group: '' })).toBe('')
})

test('tag text is escaped without changing the chosen group or creating new tags', () => {
  const xml = groupTagsXML(' WF & <组> "发布" \'A\'\u0000 ')
  expect(xml).toContain('<Name>GROUP</Name>')
  expect(xml).toContain('<String>WF &amp; &lt;组&gt; &quot;发布&quot; &apos;A&apos;</String>')
  expect(xml.match(/<Simple>/g)).toHaveLength(1)
})

test('blank groups and MP4 do not add metadata or create tag work files', async () => {
  for (const [out, group] of [['output.mkv', ' '], ['output.mp4', 'WF']]) {
    await withMkvGroupTags(out!, group!, async args => { expect(args).toEqual([]) })
    expect(ffmpegGroupArgs(out!, group!)).toEqual([])
  }
  expect(ffmpegGroupArgs('output.MKV', ' WF ')).toEqual(['-metadata', 'GROUP=WF'])
})

test('temporary XML remains available until the mux finishes, then is removed on success or failure', async () => {
  let tagFile = ''
  const run = async (fail: boolean) => withMkvGroupTags('output.mkv', 'WF', async args => {
    expect(args[0]).toBe('--global-tags')
    tagFile = args[1]!
    expect(readFileSync(tagFile, 'utf8')).toContain('<String>WF</String>')
    await Promise.resolve()
    expect(existsSync(tagFile)).toBe(true)
    if (fail) throw new Error('mux failed')
    return 'muxed'
  })
  expect(await run(false)).toBe('muxed')
  expect(existsSync(tagFile)).toBe(false)
  await expect(run(true)).rejects.toThrow('mux failed')
  expect(existsSync(tagFile)).toBe(false)
})
