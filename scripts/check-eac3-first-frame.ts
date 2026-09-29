// Opt-in regression using a local E-AC-3 source with a malformed first frame.
// bun run scripts/check-eac3-first-frame.ts <source.ts>
// Media samples, signed playlists and keys must never be committed.
import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ensureFFmpeg, ensureMkvmerge } from '../src/lib/tools.ts'
import { dropFirstAudioPacket, firstPresentationMs } from '../src/lib/media-timing.ts'
import { mkvmergeMux } from '../src/lib/mkvmerge.ts'

if (!process.argv[2]) throw new Error('Provide a local E-AC-3 source with a malformed first frame')
const source = resolve(process.argv[2])
const dir = mkdtempSync(join(tmpdir(), 'gvs-eac3-repair-'))
const ff = await ensureFFmpeg()
const run = (args: string[], allowProbeError = false) => {
  const p = spawnSync(ff, ['-nostdin', '-hide_banner', '-v', 'error', ...args], { windowsHide: true })
  assert.equal(p.status, 0, p.stderr?.toString())
  if (!allowProbeError) assert.equal(p.stderr.toString(), '')
}
const video = join(dir, 'video.mp4'), output = join(dir, 'result.mkv')
run(['-f', 'lavfi', '-i', 'color=size=160x90:rate=25', '-t', '2', '-c:v', 'libx264', video])
await assert.rejects(firstPresentationMs(ff, source, 'a:0'), /exponent/)
const notes: string[] = []
await mkvmergeMux(await ensureMkvmerge(), video, [{ path: source }], output, undefined, m => notes.push(m))
assert.equal(notes.length, 1)
run(['-i', output, '-map', '0:a:0', '-f', 'null', '-'])
const original = join(dir, 'original.eac3'), repaired = join(dir, 'repaired.eac3')
run(['-i', source, '-map', '0:a:0', '-c', 'copy', '-f', 'eac3', original], true)
run(['-i', output, '-map', '0:a:0', '-c', 'copy', '-f', 'eac3', repaired])
const bytes = readFileSync(original)
assert.equal(bytes.readUInt16BE(0), 0x0b77)
const firstSize = (((bytes[2]! & 7) << 8) + bytes[3]! + 1) * 2
assert.deepEqual(readFileSync(repaired), bytes.subarray(firstSize))
const report = JSON.parse(readFileSync(`${output}.timing.json`, 'utf8'))
assert.equal(report.verified, true)
assert.equal(report.audioRepairs.length, 1)
assert.deepEqual(report.finalStartsMs, report.expectedStartsMs)
assert.equal(await firstPresentationMs(ff, output, 'a:0'), 32)
// Put a good frame before the bad one: deleting a packet must not hide later damage.
const nextSize = (((bytes[firstSize + 2]! & 7) << 8) + bytes[firstSize + 3]! + 1) * 2
const later = join(dir, 'later-corrupt.eac3')
writeFileSync(later, Buffer.concat([bytes.subarray(firstSize, firstSize + nextSize), bytes]))
await assert.rejects(dropFirstAudioPacket(ff, later, join(dir, 'rejected.mka')), /首帧修复校验失败/)
console.log(`PASS: one frame removed, remaining bytes unchanged, PTS preserved, later corruption rejected. ${dir}`)
