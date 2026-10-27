import { expect, test } from 'bun:test'
import { transferState, transferLabel } from './job-transfer'
import type { JobView } from './api'

test('下载完成不能隐藏待补全、上传、暂停和失败任务', () => {
  const job = { state: 'done', publication: { binding: { sourceAccount: { id: 'source', alias: 'main' } }, workTarget: { tmdbId: '123', category: '' }, output: '/existing.mp4' } } as JobView
  expect(transferState(job)).toBe('pending')
  expect(transferLabel(job)).toBe('待补全资源分类')
  job.publication!.workTarget.category = 'tv'
  expect(transferState(job)).toBe('active')
  for (const [stage, expected] of [['processing', 'active'], ['uploading', 'active'], ['failed', 'failed'], ['paused', 'paused'], ['completed', 'done']] as const) {
    job.publication!.progress = { stage: stage!, downloadPercent: 100, uploadPercent: 30, uploadedBytes: 100, error: '', synced: true }
    expect(transferState(job)).toBe(expected)
  }
  job.publication = undefined
  expect(transferState(job)).toBe('done')
})

test('a completed download waiting for a manual upload belongs in pending', () => {
  const job = { state: 'done', publication: {
    binding: { sourceAccount: { id: 'source', alias: 'main' } }, workTarget: { tmdbId: '123', category: 'tv' }, output: '/existing.mp4',
    progress: { stage: 'processing', awaitingManual: true, downloadPercent: 100, uploadPercent: 0, uploadedBytes: 0, error: '', synced: true },
  } } as JobView
  expect(transferState(job)).toBe('pending')
  expect(transferLabel(job)).toBe('等待手动上传')
  job.publication!.progress!.awaitingManual = false
  expect(transferState(job)).toBe('active')
})
