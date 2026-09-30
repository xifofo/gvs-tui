import { describe, expect, test } from 'bun:test'
import { TencentOperations } from './tencent-operations.ts'

describe('Tencent local operation observations', () => {
  function setup() {
    const calls: Record<string, unknown>[] = []
    const logs: string[] = []
    const tracker = new TencentOperations(async input => {
      calls.push(input)
      return input.report_type === 'bind' ? { binding: 'opaque-test-binding' } : { status: 'observed_locally' }
    }, line => logs.push(line))
    return { tracker, calls, logs }
  }

  test('search detail and play share a flow without logging search text', async () => {
    const { tracker, calls, logs } = setup()
    const search = await tracker.begin('search', { q: 'PRIVATE SEARCH TEXT' })
    await tracker.finish(search, { list: [] })
    const detail = await tracker.begin('detail', { cid: 'cover1' })
    await tracker.finish(detail, { cid: 'cover1', episodes: [{ vid: 'episode1' }] })
    const play = await tracker.begin('play', { vid: 'episode1' })
    const bound = tracker.boundInput(play, { vid: 'episode1' })
    expect(bound.report_binding).toBe('opaque-test-binding')
    await tracker.finish(play, { has_url: true, em: 0 })
    const events = calls.filter(c => c.report_type === 'observe').map(c => JSON.parse(String(c.payload)))
    expect(new Set(events.map(e => e.flow_id)).size).toBe(1)
    expect(new Set(events.map(e => e.operation_id)).size).toBe(3)
    expect(calls.filter(c => c.report_type === 'bind')).toHaveLength(1)
    expect(JSON.stringify(calls)).not.toContain('PRIVATE SEARCH TEXT')
    expect(logs.join(' ')).not.toContain('opaque-test-binding')
    expect(events[0].source).toBe('tui_process')
    expect(events[0].metrics.rss_bytes).toBeGreaterThan(0)
    expect(events[0].metrics).not.toHaveProperty('played_time_mills')
  })

  test('queued job remains on old flow after another search', async () => {
    const { tracker, calls } = setup()
    const detail = await tracker.begin('detail', { cid: 'cover1' })
    await tracker.finish(detail, { episodes: [{ vid: 'episode1' }] })
    const child = tracker.fork('123', 'episode1')
    const later = await tracker.begin('search', { q: 'later' })
    await tracker.finish(later, {})
    const play = await child.begin('play', { vid: 'episode1' })
    await child.finish(play, { em: 0, has_url: true })
    child.observeTransfer(1024, 2048)
    await child.closeTransfer(true)
    const events = calls.filter(c => c.report_type === 'observe').map(c => JSON.parse(String(c.payload)))
    const job = events.filter(e => e.job_id === '123')
    expect(job.length).toBeGreaterThan(2)
    expect(job[0].flow_id).toBe(events[0].flow_id)
    expect(job.at(-1).phase).toBe('cancel')
    expect(job.some(e => e.metrics.downloaded_bytes === 1024)).toBe(true)
    expect(events.find(e => e.action === 'search').flow_id).not.toBe(job[0].flow_id)
  })

  test('rejection stops automatic requests within the same operation', async () => {
    const { tracker, calls } = setup()
    const play = await tracker.begin('play', { vid: 'episode1' })
    await tracker.finish(play, { em: 93, msg: '限制播放' })
    const count = calls.length
    await expect(tracker.begin('play', { vid: 'episode1' })).rejects.toThrow('stopped after rejection')
    expect(calls).toHaveLength(count)
  })

  test('download failure is not reported as success', async () => {
    const { tracker, calls } = setup()
    const play = await tracker.begin('play', { vid: 'episode1' })
    await tracker.finish(play, { has_url: true })
    await tracker.closeTransfer(false, true)
    const event = JSON.parse(String(calls.at(-1)?.payload))
    expect(event.action).toBe('download')
    expect(event.outcome).toBe('error')
  })

  test('unrelated actions never trigger binding or observations', async () => {
    const { tracker, calls } = setup()
    expect(await tracker.begin('account', {})).toBeUndefined()
    expect(calls).toHaveLength(0)
  })
})
