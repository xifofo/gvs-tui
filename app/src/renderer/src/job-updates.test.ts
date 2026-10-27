import { expect, test } from 'bun:test'
import { computed, reactive } from 'vue'
import type { JobView } from '@shared/api'
import { patchJobViews } from './job-updates'

const job = (id: number): JobView => ({ id, groupId: `group-${id}`, groupTitle: '任务', provider: 'youku', poster: '', label: 'S01E01', quality: '1080P', status: '下载中', pct: 0, log: '', err: '', note: '', state: 'running', output: '', createdAt: 0, finishedAt: 0 })

test('六千条历史中只更新变化任务，保持分组缓存和其它任务身份', () => {
  const jobs = reactive(Array.from({ length: 6000 }, (_, i) => job(i)))
  const index = new Map(jobs.map(j => [j.id, j]))
  const groups = computed(() => jobs.map(j => j.groupId))
  const beforeGroups = groups.value, current = jobs[4]!, unchanged = jobs[5]!
  patchJobViews(index, [{ ...job(4), pct: 0.67, state: 'done', output: '/Downloads/finished.mkv' }])
  expect(jobs[4]).toBe(current)
  expect(jobs[4]!.pct).toBe(0.67)
  expect(jobs[4]!.state).toBe('done')
  expect(jobs[5]).toBe(unchanged)
  expect(groups.value).toBe(beforeGroups)
})

test('完整任务视图会清掉旧可选字段，过期更新不会复活删除的任务', () => {
  const current: JobView = { ...job(1), ed2k: { state: 'done', pct: 1, link: 'ed2k://fixture' } }
  const index = new Map([[1, current]])
  patchJobViews(index, [job(1), job(2)])
  expect(current).not.toHaveProperty('ed2k')
  expect(index.size).toBe(1)
})
