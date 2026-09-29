// 3f investigation: can `--decryption-engine FFMPEG` replace the Shaka
// whole-track decrypt? Both engines get the exact same CBCS HLS fixture and the
// same frozen playlist, so the comparison is wall-clock plus a byte-identity
// check against the clear source (and, for FFMPEG, against Shaka's own output).
//
// Read-only: it never changes the pipeline defaults. Run with:
//   bun run scripts/check-decrypt-engines.ts [seconds]
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { ensureFFmpeg, ensureM3u8dl, ensurePackager } from '../src/lib/tools.ts'
import { hlsKeyArgs, runM3u8dl } from '../src/lib/media.ts'

const SECONDS = Number(process.argv[2] ?? 30)
const REPEATS = Number(process.argv[3] ?? 2)
const KID = '11111111111111111111111111111111'
const KEY = '0123456789abcdef0123456789abcdef'
const dir = mkdtempSync(join(tmpdir(), 'gvs-decrypt-engines-'))

function run(bin: string, args: string[], cwd = dir): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', b => { out += b })
    child.stderr.on('data', b => { out += b })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve(out) : reject(new Error(out)))
  })
}

/** Byte-level identity of the decrypted payload, ignoring container metadata. */
async function payloadHash(ffmpeg: string, file: string): Promise<string> {
  const text = await run(ffmpeg, ['-v', 'error', '-copyts', '-i', file, '-map', '0:v:0', '-c', 'copy',
    '-avoid_negative_ts', 'disabled', '-f', 'framecrc', 'pipe:1'])
  return text.split('\n').filter(l => /^0,/.test(l)).map(l => l.split(',')[5]!.trim()).join('|')
}

const ffmpeg = await ensureFFmpeg()
const packager = await ensurePackager()
const re = await ensureM3u8dl()

try {
  // A fixture big enough that a whole-track rewrite is measurable.
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25',
    '-t', String(SECONDS), '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '50', 'source.mp4'])
  await run(packager, [
    'in=source.mp4,stream=video,init_segment=init.mp4,segment_template=video-$Number$.m4s,playlist_name=video.m3u8',
    '--enable_raw_key_encryption', '--keys', `label=:key_id=${KID}:key=${KEY}`,
    '--protection_scheme', 'cbcs', '--clear_lead', '0', '--segment_duration', '4',
    '--hls_master_playlist_output', 'master.m3u8',
  ])
  const playlist = readFileSync(join(dir, 'video.m3u8'), 'utf8')
  const sourceBytes = statSync(join(dir, 'source.mp4')).size
  console.log(`fixture: ${SECONDS}s 720p, source=${(sourceBytes / 1e6).toFixed(1)} MB, segments=${(playlist.match(/\.m4s/g) ?? []).length}`)

  // Freeze the playlist so both engines download identical segment bytes. The
  // playlist is relative, so the fixture files are served by path.
  const server = createServer((req, res) => {
    const name = (req.url ?? '/').replace(/^\/+/, '').replace(/\?.*$/, '')
    try {
      const file = readFileSync(join(dir, name))
      const type = name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4'
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(file.length) }).end(file)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  const clearHash = await payloadHash(ffmpeg, join(dir, 'source.mp4'))
  const engines: Array<[string, string[]]> = [
    ['SHAKA_PACKAGER', ['--decryption-engine', 'SHAKA_PACKAGER', '--decryption-binary-path', packager]],
    ['FFMPEG', ['--decryption-engine', 'FFMPEG']],
    ['MP4DECRYPT(default)', []],
  ]
  const hashes = new Map<string, string>()
  try {
    for (const [label, extra] of engines) {
      for (let repeat = 1; repeat <= REPEATS; repeat++) {
        const work = join(dir, `run-${label}-${repeat}`)
        const log = join(work, 're.log')
        // RE is spawned with `cwd: work`, so the folder must exist first.
        rmSync(work, { recursive: true, force: true })
        mkdirSync(work, { recursive: true })
        const started = Date.now()
        try {
          await runM3u8dl(re, [`${base}/video.m3u8`, '--save-dir', work, '--tmp-dir', work, '--save-name', 'out',
            '--select-video', 'best', '--binary-merge', '--del-after-done', 'true', '--no-ansi-color', '--force-ansi-console',
            '--disable-update-check', '--log-file-path', log, '--download-retry-count', '0', '--thread-count', '4',
            '--ffmpeg-binary-path', ffmpeg, ...hlsKeyArgs(`${KID}:${KEY}`), ...extra], log, undefined, undefined, work)
          const produced = readdirSync(work).filter(n => n.endsWith('.mp4') || n.endsWith('.mkv'))
          const out = produced.length ? join(work, produced[0]!) : ''
          const ms = Date.now() - started
          if (!out) { console.log(`${label} #${repeat}: no output file`); continue }
          const hash = await payloadHash(ffmpeg, out)
          hashes.set(`${label}-${repeat}`, hash)
          console.log(`${label} #${repeat}: ${ms} ms, ${(statSync(out).size / 1e6).toFixed(1)} MB, payload ${hash === clearHash ? 'IDENTICAL to source' : 'DIFFERS'}`)
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          console.log(`${label} #${repeat}: FAILED in ${Date.now() - started} ms — ${detail.slice(-2000)}`)
        }
      }
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  const distinct = new Set(hashes.values())
  console.log(distinct.size === 1
    ? 'RESULT: every engine produced byte-identical video payloads'
    : `RESULT: payloads differ between engines (${distinct.size} distinct hashes)`)
} finally {
  console.log(`Fixture: ${dir}`)
}
