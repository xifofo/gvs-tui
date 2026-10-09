import { clampThreads } from './config.ts'

/** Bounded lookahead: even if segment zero stalls, completed later segments
 * cannot grow without limit. A single writer preserves source order. */
export async function orderedDownload<T>(options: {
  sizes: number[]
  threads: number
  pull: (index: number, signal: AbortSignal) => Promise<T>
  write: (value: T, index: number) => Promise<void> | void
  signal?: AbortSignal
  budget?: number
}): Promise<void> {
  const { sizes, pull, write } = options
  const limit = clampThreads(options.threads)
  const budget = options.budget ?? 128 * 1024 * 1024
  if (!Number.isSafeInteger(budget) || budget <= 0 || sizes.some(n => !Number.isSafeInteger(n) || n <= 0 || n > budget)) throw new Error('无效的分片大小或缓冲预算')
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
  type Outcome = { ok: true; value: T } | { ok: false; error: unknown }
  const pending = new Map<number, Promise<Outcome>>()
  let next = 0, reserved = 0
  const fill = () => {
    while (next < sizes.length && pending.size < limit && reserved + sizes[next]! <= budget && !signal.aborted) {
      const index = next++
      reserved += sizes[index]!
      // Attach rejection handling immediately, including out-of-order failures.
      const task = Promise.resolve().then(() => { signal.throwIfAborted(); return pull(index, signal) }).then<Outcome, Outcome>(
        value => ({ ok: true, value }),
        error => { controller.abort(error); return { ok: false, error } },
      )
      pending.set(index, task)
    }
  }
  try {
    signal.throwIfAborted()
    fill()
    for (let index = 0; index < sizes.length; index++) {
      signal.throwIfAborted()
      const result = await pending.get(index)!
      if (!result.ok) throw result.error
      signal.throwIfAborted()
      await write(result.value, index)
      pending.delete(index)
      reserved -= sizes[index]!
      fill()
    }
  } finally {
    controller.abort()
    // Never release the plan or remove scratch files while workers still run.
    await Promise.allSettled(pending.values())
    pending.clear()
  }
}

/** Limit CPU-heavy local helpers independently from network concurrency. */
export function processingQueue(limit: number): <T>(work: () => Promise<T>, signal?: AbortSignal) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []
  const acquire = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const start = () => {
      signal?.removeEventListener('abort', abort)
      active++
      resolve()
    }
    const abort = () => {
      const index = waiting.indexOf(start)
      if (index >= 0) waiting.splice(index, 1)
      reject(signal!.reason)
    }
    if (active < limit) start()
    else { waiting.push(start); signal?.addEventListener('abort', abort, { once: true }) }
  })
  return async <T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    await acquire(signal)
    try { signal?.throwIfAborted(); return await work() }
    finally { active--; waiting.shift()?.() }
  }
}
