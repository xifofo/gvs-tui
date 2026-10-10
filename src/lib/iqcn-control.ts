import type { GwClient } from './client.ts'

/** Retry only rate/concurrency rejection of a read-only segment descriptor. */
export function iqcnRateLimited(error: unknown): boolean {
  const e = error as { httpStatus?: number; errorCode?: string }
  return e?.httpStatus === 429 && ['RATE_LIMITED', 'CONCURRENCY_LIMITED'].includes(e.errorCode ?? '')
}

export function retryAfterMillis(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined
  const seconds = Number(value)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Number.isFinite(ms) && ms >= 0 ? Math.ceil(ms) : undefined
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal!.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** One queue per client; media transfers remain concurrent and local. */
export function createIQCNControlQueue(clock = { now: () => Date.now(), wait: pause }) {
  let tail: Promise<unknown> = Promise.resolve(), next = 0
  return <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const pending = tail.then(async () => {
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted()
        const remaining = Math.max(0, next - clock.now())
        if (remaining > 30_000) throw new Error('网关要求较长等待时间，请稍后恢复下载')
        await clock.wait(remaining, signal)
        signal?.throwIfAborted()
        next = clock.now() + 300
        try { const result = await operation(); signal?.throwIfAborted(); return result }
        catch (error) {
          signal?.throwIfAborted()
          if (!iqcnRateLimited(error)) throw error
          const advertised = (error as { retryAfterMs?: number }).retryAfterMs
          const delay = Math.max(1000 * 2 ** attempt, Number.isFinite(advertised) ? advertised! : 0)
          // Never sleep past a bounded request budget, or retry earlier than requested.
          next = Math.max(next, clock.now() + delay)
          if (attempt >= 3 || delay > 30_000) throw error
        }
      }
    })
    tail = pending.catch(() => undefined)
    return pending
  }
}

const queues = new WeakMap<GwClient, { scope: string; run: ReturnType<typeof createIQCNControlQueue> }>()

export function iqcnSegmentDescriptor(cli: GwClient, input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const scope = `${cli.host}\0${cli.key}`
  let queue = queues.get(cli)
  if (!queue || queue.scope !== scope) {
    queue = { scope, run: createIQCNControlQueue() }
    queues.set(cli, queue)
  }
  return queue.run(() => {
    if (`${cli.host}\0${cli.key}` !== scope) throw new Error('网关连接已改变，请重新开始任务')
    return cli.invoke('iqcn', 'download-segment', input, {}, { timeoutMs: 150000 })
  }, signal)
}
