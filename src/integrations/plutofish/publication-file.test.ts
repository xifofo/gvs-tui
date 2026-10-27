import { expect, test } from 'bun:test'
import { mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectPublicationFile, publicationFileIdentity, publicationFileNumbers, samePublicationFile } from './publication-file'

const media = { status: 'probed' as const, width: 1920, height: 1080, codec: 'h264' }

test('new filename reads explicit single episode including S00/E00; ranges stay manual', () => {
  expect(publicationFileNumbers('Natural.High.2023.S00E151.2160p.TX.WEB-DL-WF.mkv')).toEqual({ seasonNumber: 0, episodeNumber: 151 })
  expect(publicationFileNumbers('Show.S0E0.mkv')).toEqual({ seasonNumber: 0, episodeNumber: 0 })
  for (const name of ['Show.mkv', 'S01E01-E02.mkv', 'S01E01-03.mkv', 'S01E01E02.mkv', 'S01E01.S02E02.mkv', 'S10001E01.mkv']) expect(publicationFileNumbers(name)).toBeUndefined()
})

test('inspects renamed media without changing bytes, and refuses non-media, size mismatches and mutation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gvs-relink-file-'))
  try {
    const before = join(root, 'old.mkv'), after = join(root, 'New.Name.S00E151.mkv')
    writeFileSync(before, Buffer.alloc(1024, 7)); renameSync(before, after)
    const result = await inspectPublicationFile(after, 1024, async () => media)
    expect(result.measured.file.size).toBe(1024)
    expect(samePublicationFile(result.identity, await publicationFileIdentity(after))).toBe(true)
    await expect(inspectPublicationFile(after, 2048, async () => media)).rejects.toThrow('大小')
    await expect(inspectPublicationFile(after, 1024, async () => ({ status: 'unavailable' }))).rejects.toThrow('媒体规格')
    symlinkSync(after, join(root, 'link.mkv'))
    await expect(inspectPublicationFile(join(root, 'link.mkv'), 1024, async () => media)).rejects.toThrow('普通视频')
    await expect(inspectPublicationFile(join(root, 'no.txt'), undefined, async () => media)).rejects.toThrow('视频文件')
    await expect(inspectPublicationFile(after, 1024, async () => { writeFileSync(after, 'changed'); return media })).rejects.toThrow('发生变化')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
