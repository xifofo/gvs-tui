import { createHash } from 'node:crypto'
import { createWriteStream, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fetchMediaSegment } from './proxy.ts'
import { sleep } from './util.ts'

type Part = { url: string; path: string }

type TransferPolicy = {
  responseTimeoutMs: number; idleTimeoutMs: number; slowWindowMs: number
  minBytesPerSecond: number; retryDelayMs: number
}

const DEFAULT_POLICY: TransferPolicy = {
  responseTimeoutMs: 20_000, idleTimeoutMs: 30_000, slowWindowMs: 30_000,
  // Parallel parts share bandwidth. Slow but progressing whole-file GETs must
  // finish; restarting them throws away useful bytes and may never improve CDN
  // speed. Header/idle timeouts still retry connections that have stopped.
  minBytesPerSecond: 0, retryDelayMs: 700,
}

class IQAudioTransferTimeout extends Error {
  constructor(reason: string) { super(reason); this.name = 'IQAudioTransferTimeout' }
}

export class IQAudioTransferError extends Error {
  readonly errorCode = 'IQ_AUDIO_TRANSFER_FAILED'
  constructor(index: number, total: number, cause: unknown) {
    super(`IQ 音轨分段下载失败（第 ${index+1}/${total} 段）：${cause instanceof Error ? cause.message : String(cause)}`,{cause})
    this.name = 'IQAudioTransferError'
  }
}

function partIdentity(url: string, index: number, identity: string): string {
  const u = new URL(url)
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('IQ 音轨地址格式无效')
  // Signing parameters and CDN hosts may change; the physical file and byte
  // window must stay identical before mixing refreshed links with saved parts.
  return createHash('sha256').update(JSON.stringify(['iq-audio-whole-v2', identity, index, u.pathname,
    ...['m', 'qd_uri', 'start', 'end', 'contentlength'].map(k => u.searchParams.get(k))])).digest('hex')
}

/** Also stop pending headers/reads when a transport doesn't reject on abort. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener('abort', stop)
    operation.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
    if (signal.aborted) stop()
    else signal.addEventListener('abort', stop, { once: true })
  })
}

/** Keep bytes for diagnostics, but force a fresh whole GET after decode failure. */
export function invalidateIQAudioParts(paths: readonly string[]): void {
  for (const path of paths) {
    try { unlinkSync(`${path}.complete.json`) } catch { /* preserve the original validation error */ }
  }
}

export async function downloadIQParts(parts: Part[], options: {
  identity: string; threads: number; headers: Record<string,string>; signal?: AbortSignal
  progress?: (bytes: number, completed: number, total: number) => void
  fetcher?: (url: string, init: RequestInit) => Promise<Response>
  refreshParts?: (signal: AbortSignal) => Promise<readonly { url: string }[]>
  onRetry?: (index: number, attempt: number, reason: string) => void
  policy?: Partial<TransferPolicy>
}): Promise<void> {
  options.signal?.throwIfAborted()
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal,controller.signal]) : controller.signal
  const bytes = parts.map(()=>0), complete = parts.map(()=>false)
  const identities = parts.map((part,index) => partIdentity(part.url,index,options.identity))
  const policy = { ...DEFAULT_POLICY, ...options.policy }
  let urls = parts.map(part => part.url), generation = 0
  let refreshing: Promise<void> | undefined
  const refresh = async (usedGeneration: number) => {
    if (!options.refreshParts || generation !== usedGeneration || generation >= 2) return
    // Several stalled workers share one gateway request, then only retry their
    // own incomplete files. A finished file is never requested again.
    if (!refreshing) {
      refreshing = (async () => {
        const fresh = await abortable(options.refreshParts!(signal),signal)
        if (fresh.length !== parts.length || fresh.some((part,index) => partIdentity(part.url,index,options.identity) !== identities[index])) {
          throw new Error('IQ 重新取链后音轨分段改变，已完成分段保留，请重新探测')
        }
        urls = fresh.map(part => part.url)
        generation++
      })().finally(() => { refreshing = undefined })
    }
    await refreshing
  }
  const report = () => options.progress?.(bytes.reduce((a,b)=>a+b,0),complete.filter(Boolean).length,parts.length)
  parts.forEach((part,index)=>{
    try {
      const old=JSON.parse(readFileSync(`${part.path}.complete.json`,'utf8'))
      if(old.identity===identities[index] && old.bytes>0 && statSync(part.path).size===old.bytes){bytes[index]=old.bytes;complete[index]=true}
    } catch { /* incomplete or older transfers are not trusted */ }
  })
  report()
  let next=0
  const worker = async () => {
    while(next<parts.length){
      signal.throwIfAborted()
      const index=next++, part=parts[index]!
      if(complete[index])continue
      try { unlinkSync(`${part.path}.complete.json`) } catch { /* no trusted completion remains */ }
      for(let attempt=0;;attempt++){
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        const usedGeneration = generation, attemptAbort = new AbortController()
        const attemptSignal = AbortSignal.any([signal,attemptAbort.signal])
        let idleTimer: ReturnType<typeof setTimeout> | undefined
        let slowTimer: ReturnType<typeof setInterval> | undefined
        const responseTimer = setTimeout(() => attemptAbort.abort(new IQAudioTransferTimeout('音轨分段等待响应超时')),policy.responseTimeoutMs)
        const resetIdle = () => {
          clearTimeout(idleTimer)
          idleTimer = setTimeout(() => attemptAbort.abort(new IQAudioTransferTimeout('音轨分段传输停滞')),policy.idleTimeoutMs)
        }
        try {
          bytes[index]=0
          // IQ already splits the audio into physical files. Some CDN/cache
          // combinations return misleading partial data; fetch each whole file
          // and parallelize between files instead of splitting it again.
          const headers = new Headers(options.headers)
          headers.delete('range')
          headers.delete('if-range')
          const response=await abortable((options.fetcher??fetchMediaSegment)(urls[index]!,{headers,signal:attemptSignal,cache:'no-store'}),attemptSignal)
          clearTimeout(responseTimer)
          if(!response.ok||!response.body){void response.body?.cancel().catch(()=>{});throw new Error(`IQ CDN HTTP ${response.status}`)}
          if(response.status===206){void response.body.cancel().catch(()=>{});throw new Error('IQ 音轨完整下载收到局部内容')}
          const expected=Number(response.headers.get('content-length'))||0
          reader=response.body.getReader()
          resetIdle()
          let windowStart = Date.now(), windowBytes = 0
          if (policy.minBytesPerSecond > 0) slowTimer = setInterval(() => {
            const now = Date.now(), elapsed = now-windowStart
            if (elapsed < policy.slowWindowMs) return
            if ((bytes[index]!-windowBytes)*1000/elapsed < policy.minBytesPerSecond) {
              attemptAbort.abort(new IQAudioTransferTimeout('音轨分段持续低速'))
            }
            windowStart=now;windowBytes=bytes[index]!
          },Math.max(1,Math.min(1000,policy.slowWindowMs/4)))
          async function* chunks(){
            while(true){const {value,done}=await abortable(reader!.read(),attemptSignal);if(done)break;attemptSignal.throwIfAborted();if(value.byteLength)resetIdle();bytes[index]!+=value.byteLength;report();yield value}
          }
          await pipeline(Readable.from(chunks()),createWriteStream(part.path),{signal:attemptSignal})
          if(!bytes[index] || expected && bytes[index]!==expected)throw new Error('IQ 音轨下载字节数不完整')
          writeFileSync(`${part.path}.complete.json`,JSON.stringify({identity:identities[index],bytes:bytes[index]}))
          complete[index]=true;report();break
        } catch(error){
          signal.throwIfAborted()
          const failure = attemptAbort.signal.aborted ? attemptAbort.signal.reason : error
          if(attempt>=2)throw new IQAudioTransferError(index,parts.length,failure)
          options.onRetry?.(index,attempt+1,failure instanceof IQAudioTransferTimeout ? failure.message : '音轨分段响应异常')
          // Stop the old stream before asking for another address. Its pending
          // read/cancel must not keep a paused task or retry waiting forever.
          attemptAbort.abort(failure)
          if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined}
          clearTimeout(responseTimer);clearTimeout(idleTimer);clearInterval(slowTimer)
          await refresh(usedGeneration)
          await sleep(policy.retryDelayMs*(attempt+1),signal)
        } finally {
          clearTimeout(responseTimer);clearTimeout(idleTimer);clearInterval(slowTimer)
          attemptAbort.abort()
          if(reader){void reader.cancel().catch(()=>{});reader.releaseLock()}
        }
      }
    }
  }
  const count=Math.min(parts.length,Math.max(1,Math.min(16,Math.floor(options.threads)||1)))
  const workers=Array.from({length:count},worker)
  try {await Promise.all(workers)}
  catch(error){controller.abort(error);await Promise.allSettled(workers);throw error}
}
