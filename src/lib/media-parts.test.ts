import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadProgress } from './media.ts'

const SIX_MB = 6 << 20
const HALF = SIX_MB / 2

/**
 * A CDN that honours Range and counts the bytes it served. While `hang` is set,
 * any range that starts past byte 0 sends a little data and then never closes,
 * i.e. the transfer stalls until the client gives up — how an interrupted
 * download looks on the wire (a 403 is different: it is classified as "cdn
 * ignored range" and falls back to a single connection).
 */
function rangeServer(payload: Buffer) {
  const state = { served: 0, hang: true, hung: 0 }
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    fetch(req) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') || '')
      // `payload.buffer` would be the whole backing store, not this slice.
      if (!range) return new Response(new Uint8Array(payload), { headers: { 'content-length': String(payload.length) } })
      const start = Number(range[1])
      const end = range[2] ? Math.min(Number(range[2]), payload.length - 1) : payload.length - 1
      const headers = { 'Content-Range': `bytes ${start}-${end}/${payload.length}` }
      if (state.hang && start > 0) {
        state.hung++
        const chunk = payload.subarray(start, start + 4096)
        return new Response(new ReadableStream({
          start(c) { c.enqueue(new Uint8Array(chunk)) },
          cancel() { /* client gone */ },
        }), { status: 206, headers })
      }
      const body = payload.subarray(start, end + 1)
      // Do not count the one-byte Range probe as progress.
      if (body.length > 1) state.served += body.length
      return new Response(new Uint8Array(body), { status: 206, headers })
    },
  })
  return { state, url: `http://127.0.0.1:${server.port}/video.mp4`, stop: () => server.stop(true) }
}

async function inTempDir<T>(tag: string, body: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), `gvs-${tag}-`))
  try { return await body(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('an interrupted parallel download resumes from its completed .partN chunks', async () => {
  const payload = Buffer.alloc(SIX_MB, 0x47)
  const cdn = rangeServer(payload)
  await inTempDir('gvs-resume', async (dir) => {
    const dest = join(dir, 'video.mp4')
    // The first chunk finishes, the second stalls. Stop once the finished
    // chunk is fully on disk: it must survive, and the stop must surface the
    // caller's reason rather than a CDN error.
    const ctrl = new AbortController()
    const watcher = setInterval(() => {
      try { if (statSync(`${dest}.part0`).size === HALF) { clearInterval(watcher); ctrl.abort('pause') } } catch { /* not there yet */ }
    }, 5)
    await expect(downloadProgress(cdn.url, dest, '', undefined, undefined, 2, undefined, undefined, ctrl.signal))
      .rejects.toBe('pause')

    expect(readFileSync(`${dest}.part0`).length).toBe(HALF)
    expect(JSON.parse(readFileSync(`${dest}.parts.json`, 'utf8')))
      .toMatchObject({ version: 1, plan: { threads: 2, total: SIX_MB } })
    const firstPass = cdn.state.served

    // A resume with the same split keeps the finished chunk and re-fetches
    // only the second half.
    cdn.state.hang = false
    await downloadProgress(cdn.url, dest, '', undefined, undefined, 2)
    expect(readFileSync(dest).equals(payload)).toBe(true)
    // Strictly less than a full half: a restart-from-zero would be HALF+.
    expect(cdn.state.served - firstPass).toBeLessThan(HALF)
    expect(cdn.state.hung).toBeGreaterThan(0)
    expect(existsSync(`${dest}.part0`)).toBe(false)
    expect(existsSync(`${dest}.parts.json`)).toBe(false)
  })
  cdn.stop()
})

test('chunks split for a different thread count are discarded, never spliced in', async () => {
  const payload = Buffer.alloc(SIX_MB, 0x47)
  const cdn = rangeServer(payload)
  cdn.state.hang = false
  await inTempDir('gvs-mismatch', async (dir) => {
    const dest = join(dir, 'video.mp4')
    // A previous 8-thread run left oversized chunks behind.
    writeFileSync(`${dest}.part0`, Buffer.alloc(Math.ceil(SIX_MB / 8), 0x11))
    writeFileSync(`${dest}.part1`, Buffer.alloc(Math.ceil(SIX_MB / 8), 0x22))
    writeFileSync(`${dest}.parts.json`, JSON.stringify({ version: 1, plan: { threads: 8, total: SIX_MB }, headerTotal: SIX_MB }))
    await downloadProgress(cdn.url, dest, '', undefined, undefined, 2)
    // Reusing those chunks would have produced a file longer than the payload.
    expect(readFileSync(dest).length).toBe(SIX_MB)
    expect(readFileSync(dest).equals(payload)).toBe(true)
    expect(existsSync(`${dest}.part0`)).toBe(false)
    expect(existsSync(`${dest}.parts.json`)).toBe(false)
  })
  cdn.stop()
})

test('a truncated sidecar is ignored instead of trusted', async () => {
  const payload = Buffer.alloc(SIX_MB, 0x33)
  const cdn = rangeServer(payload)
  cdn.state.hang = false
  await inTempDir('gvs-torn', async (dir) => {
    const dest = join(dir, 'video.mp4')
    writeFileSync(`${dest}.parts.json`, '{"version":1,"plan":{"threads":')
    await downloadProgress(cdn.url, dest, '', undefined, undefined, 2)
    expect(readFileSync(dest).equals(payload)).toBe(true)
  })
  cdn.stop()
})

test('a single-connection download has no parts sidecar to leave behind', async () => {
  const payload = Buffer.alloc(1024, 0x5a)
  const cdn = rangeServer(payload)
  await inTempDir('gvs-single', async (dir) => {
    const dest = join(dir, 'clip.mp4')
    await downloadProgress(cdn.url, dest, '', undefined, undefined, 1)
    expect(readFileSync(dest).equals(payload)).toBe(true)
    expect(existsSync(`${dest}.parts.json`)).toBe(false)
  })
  cdn.stop()
})

test('bytes downloaded from a different source are discarded, never appended to', async () => {
  const payload = Buffer.alloc(SIX_MB, 0x99)
  const other = Buffer.alloc(SIX_MB, 0x11)
  const cdn = rangeServer(payload)
  const otherCdn = rangeServer(other)
  await inTempDir('gvs-source', async (dir) => {
    const dest = join(dir, 'video.mp4')
    const ctrl = new AbortController()
    const watcher = setInterval(() => {
      try { if (statSync(dest).size > 0) { clearInterval(watcher); ctrl.abort('pause') } } catch { /* not yet */ }
    }, 5)
    await expect(downloadProgress(cdn.url, dest, '', undefined, undefined, 1, undefined, undefined, ctrl.signal))
      .rejects.toBe('pause')
    const partial = statSync(dest).size
    expect(partial).toBeGreaterThan(0)
    expect(readFileSync(dest).subarray(0, 64).equals(Buffer.alloc(64, 0x99))).toBe(true)

    // Same size, same Range support, different URL: the old partial bytes are
    // not this source's bytes, so the transfer restarts from zero.
    await downloadProgress(otherCdn.url, dest, '', undefined, undefined, 1)
    expect(readFileSync(dest).equals(other)).toBe(true)
    expect(cdn.state.served).toBeLessThan(partial + 4096)
  })
  cdn.stop()
  otherCdn.stop()
})

test('a resumed attempt of the very same URL keeps its partial bytes', async () => {
  const payload = Buffer.alloc(SIX_MB, 0x77)
  const cdn = rangeServer(payload)
  await inTempDir('gvs-same-source', async (dir) => {
    const dest = join(dir, 'video.mp4')
    const ctrl = new AbortController()
    const watcher = setInterval(() => {
      try { if (statSync(dest).size > 0) { clearInterval(watcher); ctrl.abort('pause') } } catch { /* not yet */ }
    }, 5)
    await expect(downloadProgress(cdn.url, dest, '', undefined, undefined, 1, undefined, undefined, ctrl.signal))
      .rejects.toBe('pause')
    const partial = statSync(dest).size
    expect(partial).toBeGreaterThan(0)

    cdn.state.hang = false
    await downloadProgress(cdn.url, dest, '', undefined, undefined, 1)
    expect(readFileSync(dest).equals(payload)).toBe(true)
    // Only the missing tail was fetched.
    expect(cdn.state.served).toBeLessThan(payload.length + 4096)
  })
  cdn.stop()
})

test('the identity hashes the key instead of storing it on disk', async () => {
  const { sourceIdentity } = await import('./media.ts')
  const a = sourceIdentity('https://cdn.test/asset.mp4?sig=one', undefined, 'a'.repeat(32))
  const b = sourceIdentity('https://cdn.test/asset.mp4?sig=two', undefined, 'a'.repeat(32))
  const other = sourceIdentity('https://cdn.test/asset.mp4?sig=two', undefined, 'b'.repeat(32))
  // A rotating signature keeps the same identity; a different key does not.
  expect(a).toBe(b)
  expect(other).not.toBe(a)
  expect(other).not.toContain('b'.repeat(32))
  expect(sourceIdentity('https://cdn.test/a.ts')).not.toBe(sourceIdentity('https://cdn.test/b.ts'))
})
