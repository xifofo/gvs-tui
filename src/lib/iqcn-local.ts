import { spawn } from 'node:child_process'
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { GwClient } from './client.ts'
import { iqcnLocalPath } from './tool-paths.ts'
import { asString, isObj } from './util.ts'
import { cachedIQCNDescriptor, iqcnSegmentDescriptor } from './iqcn-control.ts'
import { runLog } from './runlog.ts'

export type IQCNProcessing = { version: number; ticket: string; identity: string; drmType?: 1; copy?: true }
export type IQCNSegmentTiming = { index:number; bytes:number; descriptorMs:number; networkMs:number; restoreMs:number; readMs:number; totalMs:number; descriptorRequests:number; fetchAttempts:number }
type LocalResult = { version: number; bytes: number; restored: boolean; clearCandidate: boolean }
export type IQCNLocalRuntime = {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  restore: (source: string, destination: string, material: IQCNProcessing, signal?: AbortSignal) => Promise<LocalResult>
  onTiming?: (timing: IQCNSegmentTiming) => void
}
const MAX_SEGMENT = 64 * 1024 * 1024
const MAX_CDN_REDIRECTS = 4
const CDN_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** Never copy arbitrary network messages, signed URLs or processing material into logs. */
export function iqcnSegmentFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const http = /^HTTP ([1-5]\d{2})$/.exec(message)
  if (http) return `http_${http[1]}`
  const reasons: Record<string, string> = {
    '分片直连超时': 'timeout',
    '分片直连连接失败': 'connection_failed',
    '分片长度不符': 'length_mismatch',
    '分片超出声明长度': 'oversized',
    '分片下载不完整': 'incomplete',
    '分片调度发生循环跳转': 'redirect_loop',
    '分片调度跳转次数过多': 'redirect_limit',
    '分片调度未返回跳转地址': 'redirect_missing',
    '分片跳转地址不属于爱奇艺 CDN': 'redirect_rejected',
  }
  return reasons[message] ?? 'network_failed'
}

/** Only fixed messages emitted by our helper may enter diagnostics. */
export function iqcnRestoreReason(stderr: string): string {
  const reasons: Record<string, string> = {
    'invalid local processing material': 'material_invalid',
    'local segment restoration failed': 'restore_failed',
    'local segment restoration incomplete': 'restore_incomplete',
    'cannot open local segment': 'input_open_failed',
    'local segment exceeds size limit or cannot be read': 'input_read_failed',
    'cannot create local output': 'output_create_failed',
    'cannot write local output': 'output_write_failed',
  }
  return reasons[stderr.trim()] ?? 'helper_failed'
}

export function iqcnProcessing(plan: Record<string, unknown>): IQCNProcessing {
  const value = isObj(plan.localProcessing) ? plan.localProcessing : {}
  const ticket = asString(value.ticket).trim()
  const video = isObj(plan.video) ? plan.video : {}
  // Retain compatibility with gateways serializing the selected DRM type as text.
  const cleartext = video.drmType === 1 || video.drmType === '1'
  if (plan.transport !== 'local-v1' || value.version !== 1) {
    throw new Error('爱奇艺国内版网关未提供本地下载协议，请同步更新网关和 App')
  }
  // A whole-file (progressive MP4) rendition hands out plain media ranges, and
  // the local helper only accepts TS samples. Store the bytes as received, and
  // only with the gateway's explicit cleartext declaration.
  if (video.delivery === 'single-file') {
    if (!cleartext) throw new Error('爱奇艺国内版整文件投放不是明文，请更新网关后重试')
    return { version: 1, ticket, identity: asString(value.identity), copy: true }
  }
  if (!asString(value.identity) || (!ticket && !cleartext)) {
    throw new Error('爱奇艺国内版网关未提供本地下载协议，请同步更新网关和 App')
  }
  // An empty ticket is valid only with the gateway's explicit cleartext DRM type.
  return { version: 1, ticket, identity: asString(value.identity), ...(!ticket && cleartext ? { drmType: 1 as const } : {}) }
}

function mediaURL(raw: unknown): string {
  const text = asString(raw)
  let u: URL
  try { u = new URL(text) } catch { throw new Error('分片地址无效') }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || !u.hostname.endsWith('.ptqy.gitv.tv')) {
    throw new Error('分片地址不属于爱奇艺 CDN')
  }
  return text
}

/** Domestic dispatchers may redirect to a CDN edge; validate every hop before fetching it. */
async function fetchSegmentResponse(url: string, fetcher: IQCNLocalRuntime['fetch'], signal: AbortSignal): Promise<Response> {
  let current = mediaURL(url)
  const visited = new Set<string>()
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted()
    if (visited.has(current)) throw new Error('分片调度发生循环跳转')
    visited.add(current)
    const response = await fetcher(current, { redirect: 'manual', signal })
    if (!CDN_REDIRECT_STATUSES.has(response.status)) return response
    const location = response.headers.get('location')
    await response.body?.cancel()
    signal.throwIfAborted()
    if (redirects >= MAX_CDN_REDIRECTS) throw new Error('分片调度跳转次数过多')
    if (!location) throw new Error('分片调度未返回跳转地址')
    try { current = mediaURL(new URL(location, current).href) }
    catch { throw new Error('分片跳转地址不属于爱奇艺 CDN') }
  }
}

// Fetch uses the local Node/Bun transport, never GwClient or the tunnel.
async function fetchSegment(url: string, destination: string, size: number, fetcher: IQCNLocalRuntime['fetch'], signal?: AbortSignal): Promise<void> {
  const timeout = AbortSignal.timeout(60_000)
  const active = signal ? AbortSignal.any([signal, timeout]) : timeout
  let fd: number | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    active.throwIfAborted()
    const response = await fetchSegmentResponse(url, fetcher, active)
    if (![200, 206].includes(response.status) || !response.body) {
      await response.body?.cancel()
      throw new Error(`HTTP ${response.status}`)
    }
    const advertised = response.headers.get('content-length')
    if (advertised !== null && Number(advertised) !== size) {
      await response.body.cancel()
      throw new Error('分片长度不符')
    }
    reader = response.body.getReader()
    fd = openSync(destination, 'w', 0o600)
    let received = 0
    while (true) {
      active.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      received += part.value.byteLength
      if (received > size) throw new Error('分片超出声明长度')
      let offset = 0
      while (offset < part.value.length) offset += writeSync(fd, part.value, offset, part.value.length - offset)
    }
    if (received !== size) throw new Error('分片下载不完整')
  } catch (error) {
    signal?.throwIfAborted()
    if (timeout.aborted) throw new Error('分片直连超时')
    // Do not expose signed URLs from network exceptions.
    const message = error instanceof Error ? error.message : ''
    throw new Error(/^(HTTP \d+|分片)/.test(message) ? message : '分片直连连接失败')
  } finally {
    await reader?.cancel().catch(() => undefined)
    reader?.releaseLock()
    if (fd !== undefined) closeSync(fd)
  }
}

export function restoreIQCNLocal(source: string, destination: string, material: IQCNProcessing, signal?: AbortSignal): Promise<LocalResult> {
  signal?.throwIfAborted()
  const binary = process.env.GVS_IQCN_LOCAL || iqcnLocalPath()
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = '', diagnostic = '', done = false
    let failure: Error | undefined
    let exited = false
    const finish = (err?: Error, value?: LocalResult) => {
      if (done) return
      if (err && !exited) {
        failure ||= err
        child.kill()
        // Wait for close before the caller removes files or frees a CPU slot.
        return
      }
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (err) reject(err)
      else resolve(value!)
    }
    const abort = () => finish(new Error('本地分片处理已取消'))
    const timer = setTimeout(() => finish(new Error('本地分片处理超时')), 60_000)
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', () => finish(new Error('无法启动爱奇艺本地处理模块，请更新完整 App 安装包')))
    child.stdin.on('error', () => finish(new Error('本地分片处理输入失败')))
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > 4096) finish(new Error('本地分片处理返回异常'))
    })
    child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(0, 4096) })
    child.on('close', code => {
      exited = true
      if (failure) return finish(failure)
      if (code !== 0) return finish(new Error(`爱奇艺国内版本地分片还原失败（${iqcnRestoreReason(diagnostic)}，exit=${code ?? 'signal'}）`))
      try {
        const value = JSON.parse(output) as LocalResult
        if (value.version !== 1 || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > MAX_SEGMENT || (!value.restored && !value.clearCandidate)) throw new Error()
        finish(undefined, value)
      } catch { finish(new Error('本地分片处理返回无效')) }
    })
    if (signal?.aborted) return abort()
    // Material is in process memory and stdin only; never in argv or a file.
    child.stdin.end(JSON.stringify({ ...material, source, destination }))
  })
}

const localRuntime: IQCNLocalRuntime = { fetch: (url, init) => fetch(url, init), restore: restoreIQCNLocal }

export async function downloadIQCNLocalSegment(cli: GwClient, planId: string, index: number, expected: number, material: IQCNProcessing, work: string, signal?: AbortSignal, runtime = localRuntime, initial?: Record<string, unknown>): Promise<Buffer> {
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > MAX_SEGMENT) throw new Error('爱奇艺国内版分片大小无效或超过 64 MiB')
  const validate = (descriptor: Record<string, unknown>) => {
    if (descriptor.transport !== 'local-v1' || descriptor.index !== index || descriptor.bytes !== expected || !Array.isArray(descriptor.urls) || !descriptor.urls.length || descriptor.urls.length > 16) {
      throw new Error('网关分片响应不符合本地下载协议')
    }
  }
  // A cache hit must not mask a mismatch in the selected plan's segment table.
  if (initial) validate(initial)
  const id = randomUUID(), raw = join(work, `iqcn-${id}.source`), clear = join(work, `iqcn-${id}.clear`)
  let firstError = ''
  let rejected: Record<string, unknown> | undefined
  const started=performance.now()
  const timing:IQCNSegmentTiming={index,bytes:expected,descriptorMs:0,networkMs:0,restoreMs:0,readMs:0,totalMs:0,descriptorRequests:0,fetchAttempts:0}
  try {
    let downloaded = false
    for (let refresh = 0; refresh < 2 && !downloaded; refresh++) {
      signal?.throwIfAborted()
      let descriptor: Record<string, unknown>
      let source: 'initial' | 'cache' | 'gateway' = 'gateway'
      const descriptorStart=performance.now()
      try {
        // Refreshed batches take precedence over the plan's original URLs.
        const supplied = refresh === 0 ? cachedIQCNDescriptor(cli, planId, index) ?? initial : undefined
        if (supplied) {
          descriptor = supplied
          source = supplied.clientDescriptorCacheHit === true ? 'cache' : 'initial'
        } else {
          timing.descriptorRequests++
          descriptor = await iqcnSegmentDescriptor(cli, { planId, index, ...(refresh ? { refresh: '1' } : {}) }, signal, rejected)
          if (descriptor.clientDescriptorCacheHit === true) { timing.descriptorRequests--; source = 'cache' }
        }
      } catch (error) {
        // Keep the gateway code (e.g. PLAN_EXPIRED) so the caller can renew the plan.
        if (firstError) throw Object.assign(new Error(`${firstError}；刷新分片地址失败`), { errorCode: (error as { errorCode?: unknown })?.errorCode, cause: error })
        throw error
      } finally {timing.descriptorMs+=performance.now()-descriptorStart}
      signal?.throwIfAborted()
      validate(descriptor)
      const urls = (descriptor.urls as unknown[]).map(mediaURL)
      for (const url of urls) {
        const fetchStart=performance.now();timing.fetchAttempts++
        try {
          await fetchSegment(url, raw, expected, runtime.fetch, signal)
          downloaded = true
          if (firstError) runLog(`iqcn segment recovered index=${index} source=${source} descriptorRequests=${timing.descriptorRequests} fetchAttempts=${timing.fetchAttempts}`)
          break
        } catch (error) {
          signal?.throwIfAborted()
          if (!firstError) runLog(`iqcn segment retry index=${index} source=${source} reason=${iqcnSegmentFailureReason(error)}`)
          firstError ||= error instanceof Error ? error.message : '分片直连失败'
        } finally {timing.networkMs+=performance.now()-fetchStart}
      }
      if (!downloaded) rejected = descriptor
    }
    if (!downloaded) throw new Error(firstError || '爱奇艺国内版分片直连失败')
    signal?.throwIfAborted()
    if (material.copy) {
      // Whole-file ranges are the media itself, not protected TS samples: keep
      // them byte-for-byte and never route them through the TS-only helper.
      const readStart = performance.now()
      const bytes = readFileSync(raw)
      timing.readMs = performance.now() - readStart
      if (bytes.length !== expected) throw new Error('爱奇艺国内版分片长度校验失败')
      timing.totalMs = performance.now() - started
      try { runtime.onTiming?.(timing) } catch { /* Diagnostics must not interrupt a download. */ }
      return bytes
    }
    let report: LocalResult
    const restoreStart=performance.now()
    try { report = await runtime.restore(raw, clear, material, signal) }
    catch (error) {
      signal?.throwIfAborted()
      // Do not echo arbitrary runtime errors (they may contain paths or material).
      const match = /（([a-z_]+)，exit=(\d+|signal)）$/.exec(error instanceof Error ? error.message : '')
      const reason = match && ['material_invalid', 'restore_failed', 'restore_incomplete', 'input_open_failed', 'input_read_failed', 'output_create_failed', 'output_write_failed', 'helper_failed'].includes(match[1]!)
        ? `${match[1]}, exit=${match[2]}` : 'helper_failed'
      throw new Error(`爱奇艺国内版本地分片还原失败（分片 ${index + 1}，${expected} 字节，${reason}）`)
    } finally {timing.restoreMs=performance.now()-restoreStart}
    signal?.throwIfAborted()
    const readStart=performance.now()
    const bytes = readFileSync(clear)
    timing.readMs=performance.now()-readStart
    if ((!report.restored && !report.clearCandidate) || report.version !== 1 || report.bytes !== bytes.length || bytes.length !== expected) throw new Error('爱奇艺国内版本地分片还原或长度校验失败')
    timing.totalMs=performance.now()-started
    // Timing contains no URLs, account IDs, processing material or local paths.
    try {runtime.onTiming?.(timing)} catch { /* Diagnostics must not interrupt a download. */ }
    return bytes
  } finally {
    for (const path of [raw, clear]) { try { unlinkSync(path) } catch { /* absent */ } }
  }
}
