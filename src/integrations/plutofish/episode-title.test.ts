/** 集标题兼容修复只补缺失值，既有任务身份和上传检查点保持不变。 */
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PublicationStore, type PublicationState } from './publication-state'
import { PublicationWorker } from './publication-worker'
import { PlutoFishConnection } from './connection'

test.each(['missing', 'custom', 'movie', 'completed'])('恢复 %s 清单，保留身份和断点且迁移只执行一次', async kind => {
  const directory = mkdtempSync(join(tmpdir(), 'episode-title-'))
  const key = 'gvs-f1:' + 'a'.repeat(64)
  const draft: PublicationState['draft'] = {
    schemaVersion: 1, binding: { url: 'https://example.invalid', publisherId: 'p', sourceAccount: { id: 's', alias: 'source' } },
    workTarget: { mediaType: kind === 'movie' ? 'movie' : 'tv', tmdbId: '123', category: 'tv' },
    fileKey: key, releaseKey: 'original-release', title: '原作品', categoryLabel: '剧集', kind: 'video',
    seasonNumber: kind === 'movie' ? undefined : 1, episodeNumber: kind === 'movie' ? undefined : 0,
    episodeTitle: kind === 'custom' ? '特别篇' : undefined, output: '/unused-video.mp4', updatedAt: new Date().toISOString(),
  }
  const state: PublicationState = { draft, acknowledged: 6, checkpoint: {
    file: { size: 10, mtimeMs: 1, sha1: 'A'.repeat(40), preId: 'B'.repeat(40) },
    uploadId: 'original-upload', partSize: 5, parts: [{ number: 1, etag: 'original-etag', size: 5 }],
  }, snapshot: {
    taskKey: key, releaseKey: draft.releaseKey, sourceAccount: 'source', workTarget: draft.workTarget,
    title: draft.title, seasonNumber: draft.seasonNumber, episodeNumber: draft.episodeNumber, episodeTitle: draft.episodeTitle,
    attempt: 2, sequence: 7, stage: kind === 'completed' ? 'completed' : 'paused',
    downloadPercent: 100, uploadPercent: 10, uploadedBytes: 1, sizeBytes: 10,
  } }
  const store = new PublicationStore(directory)
  const connection = new PlutoFishConnection({ load: () => ({ url: '', key: '' }) })
  let worker: PublicationWorker | undefined
  try {
    store.save(state); store.close()
    for (let n = 0; n < 2; n++) {
      worker = new PublicationWorker(connection, () => {}, { directory, manual: true })
      worker.restored()
      const saved = JSON.parse(readFileSync(join(directory, key.replace(':', '-') + '.state.json'), 'utf8')) as PublicationState
      expect(saved.snapshot.episodeTitle).toBe(kind === 'missing' ? '第 0 集' : draft.episodeTitle)
      expect(saved.snapshot.sequence).toBe(kind === 'missing' ? 8 : 7)
      expect(saved.snapshot.attempt).toBe(2); expect(saved.acknowledged).toBe(6)
      expect(saved.checkpoint).toEqual(state.checkpoint)
      expect(saved.draft.fileKey).toBe(key); expect(saved.draft.releaseKey).toBe(draft.releaseKey)
      expect(saved.snapshot.stage).toBe(state.snapshot.stage)
      await worker.close(); worker = undefined
    }
  } finally { await worker?.close(); store.close(); connection.close(); rmSync(directory, { recursive: true, force: true }) }
})
