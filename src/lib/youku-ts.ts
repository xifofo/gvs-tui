import { createDecipheriv } from 'node:crypto'
import { closeSync, copyFileSync, constants, openSync, readSync, statSync, unlinkSync, writeSync } from 'node:fs'
import { resolve } from 'node:path'

type Span = { offset: number; length: number }
type PES = { kind: 'audio' | 'video'; spans: Span[]; size: number; expected: number; counter: number }
export type YoukuTsStats = { audioPES: number; videoPES: number; bytes: number }

function validStart(bytes: Buffer, kind: PES['kind']): boolean {
  if (kind === 'audio') return bytes.length >= 7 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0 && ((bytes[2]! >> 2) & 15) < 13
  return bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && (bytes[2] === 1 || (bytes[2] === 0 && bytes[3] === 1))
}

/** Youku legacy TS: independently encrypted full AES blocks in each PES payload.
 * Scope is AAC + Annex-B video, not generic SAMPLE-AES or MPEG-TS scrambling.
 * Keys come from the existing authorized playback response, never derived here.
 * PAT/PMT, PES headers, PTS/DTS, packet headers and partial block tails stay intact. */
export async function decryptYoukuTs(
  source: string, dest: string, keySpec: string, signal?: AbortSignal,
  progress?: (bytes: number, total: number) => void,
): Promise<YoukuTsStats> {
  if (resolve(source) === resolve(dest)) throw new Error('TS 处理必须使用独立输出文件')
  const hex = keySpec.split(':').at(-1) || ''
  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error('优酷 TS 缺少有效的播放密钥')
  signal?.throwIfAborted()
  const size = statSync(source).size
  if (!size || size % 188) throw new Error('优酷 TS 长度不完整，拒绝处理')
  const key = Buffer.from(hex, 'hex')
  copyFileSync(source, dest, constants.COPYFILE_EXCL)
  let input: number | undefined, output: number | undefined, completed = false
  const stats: YoukuTsStats = { audioPES: 0, videoPES: 0, bytes: size }
  const pending = new Map<number, PES>()
  try {
    input = openSync(source, 'r'); output = openSync(dest, 'r+')
    function finish(pid: number): void {
      const record = pending.get(pid)
      if (!record) return
      pending.delete(pid)
      if (!record.spans.length || (record.expected > 0 && record.size < record.expected)) throw new Error('优酷 TS 的 PES 数据截断')
      const first = record.spans[0]!.offset
      const last = record.spans.at(-1)!
      const windowSize = last.offset + last.length - first
      if (windowSize > 64 * 1024 * 1024) throw new Error('优酷 TS 的 PES 窗口异常')
      const window = Buffer.allocUnsafe(windowSize)
      if (readSync(output!, window, 0, windowSize, first) !== windowSize) throw new Error('读取 TS 副本失败')
      const payload = Buffer.concat(record.spans.map(s => window.subarray(s.offset-first, s.offset-first+s.length)))
      const length = record.expected > 0 ? record.expected : payload.length
      if (length < 16) throw new Error('优酷 TS 的 PES 加密块不完整')
      if (record.expected > 0 && payload.subarray(length).some(b => b !== 0xff)) throw new Error('优酷 TS 的 PES 长度与载荷不一致')
      const encryptedLength = Math.floor(length / 16) * 16
      const cipher = createDecipheriv('aes-128-ecb', key, null)
      cipher.setAutoPadding(false)
      const clear = Buffer.concat([cipher.update(payload.subarray(0, encryptedLength)), cipher.final()])
      if (!validStart(clear, record.kind)) throw new Error('优酷 TS 密钥或格式不匹配，未通过音视频包结构检查')
      clear.copy(payload)
      let at = 0
      for (const span of record.spans) { payload.copy(window, span.offset-first, at, at+span.length);at += span.length }
      if (writeSync(output!, window, 0, windowSize, first) !== windowSize) throw new Error('写入 TS 副本失败')
      if (record.kind === 'audio') stats.audioPES++; else stats.videoPES++
    }
    const chunk = Buffer.allocUnsafe(188 * 8192)
    for (let base = 0; base < size;) {
      signal?.throwIfAborted()
      const n = readSync(input, chunk, 0, Math.min(chunk.length, size-base), base)
      if (!n || n % 188) throw new Error('优酷 TS 读取不完整')
      for (let i = 0; i < n; i += 188) {
        if (chunk[i] !== 0x47 || (chunk[i+1]! & 0x80)) throw new Error('优酷 TS 同步或传输错误')
        const pid = ((chunk[i+1]! & 31) << 8) | chunk[i+2]!
        const mode = (chunk[i+3]! >> 4) & 3
        if (!mode || chunk[i+3]! >> 6) throw new Error('不支持的 TS 传输加密或包格式')
        if (mode === 2) continue
        let offset = i + 4
        if (mode === 3) offset += 1 + chunk[i+4]!
        if (offset > i+188) throw new Error('优酷 TS adaptation 字段越界')
        if (offset === i+188) continue
        const start = !!(chunk[i+1]! & 64)
        const counter = chunk[i+3]! & 15
        if (start) {
          finish(pid)
          if (chunk[offset] !== 0 || chunk[offset+1] !== 0 || chunk[offset+2] !== 1) continue
          const stream = chunk[offset+3]!
          const kind = stream >= 0xc0 && stream <= 0xdf ? 'audio' : stream >= 0xe0 && stream <= 0xef ? 'video' : undefined
          if (!kind) throw new Error('该 TS 含尚未支持的 PES 音视频类型')
          if (offset+9 > i+188) throw new Error('PES 头跨包，当前处理不支持')
          const packetLength = chunk.readUInt16BE(offset+4)
          const headerLength = chunk[offset+8]!
          const expected = packetLength ? packetLength-3-headerLength : 0
          if (expected < 0) throw new Error('PES 头长度无效')
          offset += 9+headerLength
          if (offset > i+188) throw new Error('PES 扩展头跨包，当前处理不支持')
          pending.set(pid,{kind,spans:[],size:0,expected,counter})
        } else {
          const record = pending.get(pid)
          if (record && counter !== ((record.counter+1)&15)) throw new Error('优酷 TS 包连续性错误，拒绝静默丢帧')
          if (record) record.counter = counter
        }
        const record = pending.get(pid)
        if (record && offset < i+188) {
          const length = i+188-offset
          record.spans.push({offset:base+offset,length});record.size += length
          if (record.size > 32*1024*1024) throw new Error('优酷 TS 的单个 PES 过大')
        }
      }
      base += n;progress?.(base,size)
      await new Promise<void>(ok => setImmediate(ok))
    }
    for (const pid of pending.keys()) finish(pid)
    if (!stats.audioPES && !stats.videoPES) throw new Error('TS 未包含受支持的音视频 PES')
    signal?.throwIfAborted();completed = true
    return stats
  } finally {
    if (input !== undefined) closeSync(input)
    if (output !== undefined) closeSync(output)
    key.fill(0)
    if (!completed) { try { unlinkSync(dest) } catch { /* preserve the source and original error */ } }
  }
}
