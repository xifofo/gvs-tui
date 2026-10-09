import { expect, test } from 'bun:test'
import { orderedDownload, processingQueue } from './ordered-download.ts'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

test('configured workers overlap and out-of-order completions are written in order', async () => {
  const gates = Array.from({ length: 6 }, () => deferred<number>())
  const started = deferred(), fourth = deferred()
  const issued: number[] = [], output: number[] = []
  const run = orderedDownload({ sizes: Array(6).fill(1), threads: 3,
    pull: index => {
      issued.push(index)
      if (issued.length === 3) started.resolve()
      if (issued.length === 4) fourth.resolve()
      return gates[index]!.promise
    }, write: value => { output.push(value) },
  })
  await started.promise
  expect(issued).toEqual([0, 1, 2])
  gates[2]!.resolve(2); gates[1]!.resolve(1)
  await Promise.resolve()
  expect(output).toEqual([])
  gates[0]!.resolve(0)
  await fourth.promise
  for (let i = 3; i < 6; i++) gates[i]!.resolve(i)
  await run
  expect(output).toEqual([0, 1, 2, 3, 4, 5])
})

test('byte budget bounds lookahead even with sixteen configured workers', async () => {
  const gate = deferred<number>(), began = deferred()
  const issued: number[] = []
  const run = orderedDownload({ sizes: [6, 6, 6], budget: 10, threads: 16,
    pull: index => { issued.push(index); began.resolve(); return index === 0 ? gate.promise : Promise.resolve(index) },
    write: () => {},
  })
  await began.promise
  expect(issued).toEqual([0])
  gate.resolve(0)
  await run
  expect(issued).toEqual([0, 1, 2])
})

test('worker failure aborts its peers and drains cleanup before returning', async () => {
  const ready = deferred(), fail = deferred(), cleaned = deferred()
  let running = 0, writes = 0
  const error = new Error('source failed')
  const run = orderedDownload({ sizes: [1, 1, 1, 1], threads: 2,
    pull: async (index, signal) => {
      running++
      if (running === 2) ready.resolve()
      try {
        if (index === 1) { await fail.promise; throw error }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
        return index
      } finally { running--; if (!running) cleaned.resolve() }
    }, write: () => { writes++ },
  })
  const outcome = run.catch(e => e)
  await ready.promise
  fail.resolve()
  expect(await outcome).toBe(error)
  await cleaned.promise
  expect(running).toBe(0)
  expect(writes).toBe(0)
})

test('cancelling queued CPU work starts no extra helpers', async () => {
  const process = processingQueue(2), gates = [deferred(), deferred()], started = deferred()
  const controller = new AbortController()
  let active = 0, peak = 0, entered = 0
  const tasks = Array.from({ length: 5 }, (_, index) => process(async () => {
    entered++; active++; peak = Math.max(peak, active)
    if (entered === 2) started.resolve()
    try { await gates[index]!.promise } finally { active-- }
  }, controller.signal))
  const outcome = Promise.allSettled(tasks)
  await started.promise
  controller.abort(new Error('cancel'))
  gates.forEach(gate => gate.resolve())
  const results = await outcome
  expect(peak).toBe(2)
  expect(entered).toBe(2)
  expect(results.filter(x => x.status === 'rejected')).toHaveLength(3)
})

test('single-thread setting stays serial and an invalid segment starts no requests', async () => {
  let active = 0, peak = 0
  await orderedDownload({ sizes: [1, 1, 1], threads: 1,
    pull: async index => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return index }, write: () => {},
  })
  expect(peak).toBe(1)
  let issued = false
  await expect(orderedDownload({ sizes: [NaN], threads: 8, pull: async () => { issued = true }, write: () => {} })).rejects.toThrow('无效')
  expect(issued).toBe(false)
})
