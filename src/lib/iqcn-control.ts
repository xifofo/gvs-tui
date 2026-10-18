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
type CachedDescriptor = { expires: number; value: Record<string, unknown> }
type PlanDescriptors = { segments: Map<number, CachedDescriptor> }
const descriptorCaches = new WeakMap<GwClient, { scope: string; plans: Map<string, PlanDescriptors> }>()
const DESCRIPTOR_TTL_MS = 60_000
const MAX_CACHED_PLANS = 16
const MAX_CACHED_SEGMENTS = 512

const descriptorScope = (cli: GwClient) => `${cli.host}\0${cli.key}\0${cli.accountFor?.('iqcn') || 'default'}`

function descriptorValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return
  const row = value as Record<string, unknown>
  if (row.transport !== 'local-v1' || !Number.isSafeInteger(row.index) || Number(row.index) < 0 ||
      !Number.isSafeInteger(row.bytes) || Number(row.bytes) <= 0 || Number(row.bytes) > 64 * 1024 * 1024 ||
      !Array.isArray(row.urls) || !row.urls.length || row.urls.length > 16 ||
      !row.urls.every(url => typeof url === 'string' && url.length > 0 && url.length < 16384)) return
  return { transport: 'local-v1', index: row.index, bytes: row.bytes, urls: [...row.urls] }
}

function sameDescriptorURLs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (!Array.isArray(a.urls) || !Array.isArray(b.urls)) return false
  const left = new Set(a.urls), right = new Set(b.urls)
  return left.size === right.size && [...left].every(url => right.has(url))
}

/** Reading a cached address never extends its lifetime or makes a gateway call. */
export function cachedIQCNDescriptor(cli: GwClient, planId: string, index: number): Record<string, unknown> | undefined {
  const cache = descriptorCaches.get(cli)
  if (cache?.scope !== descriptorScope(cli)) return
  const segments = cache.plans.get(planId)?.segments
  const entry = segments?.get(index)
  if (!entry) return
  if (entry.expires <= Date.now()) { segments!.delete(index); return }
  // Bound memory by recent use, without renewing the source URL's expiry.
  segments!.delete(index)
  segments!.set(index, entry)
  return { ...entry.value, urls: [...(entry.value.urls as string[])], clientDescriptorCacheHit: true }
}

export function clearIQCNDescriptors(cli:GwClient,planId:string):void {
  descriptorCaches.get(cli)?.plans.delete(planId)
}

export function iqcnSegmentDescriptor(cli: GwClient, input: Record<string, unknown>, signal?: AbortSignal,
  rejected?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const scope = descriptorScope(cli)
  const planId = String(input.planId || ''), index = Number(input.index)
  const reusable = () => {
    const ready = cachedIQCNDescriptor(cli, planId, index)
    // A concurrent worker may already have refreshed this batch. Never reuse
    // the same addresses that the caller just exhausted.
    return ready && (input.refresh !== '1' || rejected && !sameDescriptorURLs(ready, rejected)) ? ready : undefined
  }
  signal?.throwIfAborted()
  const ready = reusable()
  if (ready) return Promise.resolve(ready)
  let queue = queues.get(cli)
  if (!queue || queue.scope !== scope) {
    queue = { scope, run: createIQCNControlQueue() }
    queues.set(cli, queue)
  }
  return queue.run(() => {
    if (descriptorScope(cli) !== scope) throw new Error('网关连接已改变，请重新开始任务')
    const updated = reusable()
    if (updated) return Promise.resolve(updated)
    let cache = descriptorCaches.get(cli)
    if (!cache || cache.scope !== scope) { cache = { scope, plans: new Map() }; descriptorCaches.set(cli, cache) }
    let plan = cache.plans.get(planId)
    if (!plan) {
      if (cache.plans.size >= MAX_CACHED_PLANS) cache.plans.delete(cache.plans.keys().next().value!)
      plan = { segments: new Map() }
      cache.plans.set(planId, plan)
    }
    if (input.refresh === '1') plan.segments.delete(index)
    const target = plan
    return cli.invoke('iqcn', 'download-segment', {...input,batch:'1'}, {}, { timeoutMs: 150000 }).then(result=>{
      if (descriptorScope(cli) !== scope) throw new Error('网关连接已改变，请重新开始任务')
      // A released/renewed plan must not be resurrected by an in-flight reply.
      if (cache!.plans.get(planId) !== target) return result
      const now = Date.now()
      for (const [key, entry] of target.segments) if (entry.expires <= now) target.segments.delete(key)
      const remember = (value: unknown) => {
        const row = descriptorValue(value)
        if (!row) return
        const key = Number(row.index)
        const previous = target.segments.get(key)
        // A sibling refresh can repeat an existing signed URL. It does not
        // prove that URL's lifetime was renewed by the CDN.
        const expires = previous && previous.value.bytes === row.bytes && sameDescriptorURLs(previous.value, row)
          ? previous.expires : now + DESCRIPTOR_TTL_MS
        target.segments.delete(key)
        target.segments.set(key, { expires, value: row })
      }
      if (Array.isArray(result.relatedSegments) && result.relatedSegments.length <= 128) result.relatedSegments.forEach(remember)
      // The requested row takes precedence over a conflicting related entry.
      if (result.index === index) remember(result)
      while (target.segments.size > MAX_CACHED_SEGMENTS) target.segments.delete(target.segments.keys().next().value!)
      return result
    })
  }, signal)
}
