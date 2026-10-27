import { expect, test } from 'bun:test'
import { JobUpdateBatch } from './job-updates'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('多个上传、下载及 ED2K 进度只发送一次，并按任务去重', async () => {
  const sent: Array<number[] | undefined> = []
  const batch = new JobUpdateBatch(ids => sent.push(ids), 10)
  for (let i = 0; i < 100; i++) batch.schedule([i % 3])
  expect(sent).toHaveLength(0)
  await delay(30)
  expect(sent).toEqual([[0, 1, 2]])
  batch.schedule([5])
  await delay(30)
  expect(sent).toEqual([[0, 1, 2], [5]])
  batch.dispose()
})

test('队列新增或删除的完整快照覆盖待发进度，后续进度仍可增量发送', async () => {
  const sent: Array<number[] | undefined> = []
  const batch = new JobUpdateBatch(ids => sent.push(ids), 10)
  batch.schedule([1])
  batch.schedule()
  batch.schedule([2])
  await delay(30)
  expect(sent).toEqual([undefined])
  batch.schedule([3])
  await delay(30)
  expect(sent).toEqual([undefined, [3]])
  batch.dispose()
})

test('关闭后不发送滞留进度', async () => {
  const sent: unknown[] = []
  const batch = new JobUpdateBatch(ids => sent.push(ids), 10)
  batch.schedule([1])
  batch.dispose()
  await delay(30)
  expect(sent).toEqual([])
})
