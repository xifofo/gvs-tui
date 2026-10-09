import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lookFFmpeg } from './ffmpeg.ts'
import { runIQFFmpeg, verifyIQAudio, writeIQOutput } from './iq-output.ts'

test('IQ publishes only after acceptance and removes a failed mux without leaving a final file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'iq-output-')), dest = join(root, 'episode.mkv')
  let scratch = ''
  try {
    await expect(writeIQOutput(dest, async path => { scratch = path; writeFileSync(path, 'unverified') }, async () => {
      expect(existsSync(dest)).toBe(false)
      throw new Error('AAC acceptance failed')
    })).rejects.toThrow('AAC acceptance failed')
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(scratch)).toBe(false)
    await writeIQOutput(dest, async path => { writeFileSync(path, 'accepted') }, async () => { expect(existsSync(dest)).toBe(false) })
    expect(readFileSync(dest, 'utf8')).toBe('accepted')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('IQ preserves an existing output and never starts writing over it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'iq-existing-')), dest = join(root, 'episode.mkv')
  let writes = 0
  try {
    writeFileSync(dest, 'existing')
    await expect(writeIQOutput(dest, async () => { writes++ }, async () => {})).rejects.toThrow('已存在')
    expect(writes).toBe(0)
    expect(readFileSync(dest, 'utf8')).toBe('existing')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('IQ cancellation during acceptance leaves no completed output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'iq-output-stop-')), dest = join(root, 'episode.mkv')
  const stop = new AbortController()
  try {
    await expect(writeIQOutput(dest, async path => { writeFileSync(path, 'muxed') }, async () => { stop.abort(new Error('paused')) }, stop.signal)).rejects.toThrow('paused')
    expect(existsSync(dest)).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const mediaTest = process.env.GVS_MEDIA_TESTS === '1' ? test : test.skip
mediaTest('IQ identifies a damaged AAC track and invalidates only its reusable state', async () => {
  const bin = lookFFmpeg('ffmpeg'), root = mkdtempSync(join(tmpdir(), 'iq-aac-'))
  const good = join(root, 'good.m4a'), broken = join(root, 'broken.m4a'), part = join(root, 'bad.part'), other = join(root, 'other.part')
  try {
    await runIQFFmpeg(bin, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-c:a', 'aac', good], 'generate AAC')
    await verifyIQAudio(bin, { path: good, id: '129:2:100', title: '原声', codec: 'aac', parts: [] })
    const data = readFileSync(good)
    const mdat = data.indexOf(Buffer.from('mdat'))
    expect(mdat).toBeGreaterThan(3)
    const end = mdat - 4 + data.readUInt32BE(mdat - 4)
    data.fill(0xff, mdat + 4, end)
    writeFileSync(broken, data)
    writeFileSync(part, data)
    for (const suffix of ['.complete.json', '.resume.json', '.parts.json']) writeFileSync(part + suffix, '{}')
    writeFileSync(other + '.complete.json', 'valid-other-track')
    await expect(verifyIQAudio(bin, { path: broken, id: '129:2:100', title: '原声', codec: 'aac', parts: [part] })).rejects.toThrow('129:2:100 / AAC')
    expect(readFileSync(part).equals(data)).toBe(true)
    for (const suffix of ['.complete.json', '.resume.json', '.parts.json']) expect(existsSync(part + suffix)).toBe(false)
    expect(readFileSync(other + '.complete.json', 'utf8')).toBe('valid-other-track')
    const stop = new AbortController(); stop.abort(new Error('paused'))
    writeFileSync(part + '.complete.json', 'keep-on-pause')
    await expect(verifyIQAudio(bin, { path: broken, id: '129:2:100', title: '原声', codec: 'aac', parts: [part] }, stop.signal)).rejects.toThrow('paused')
    expect(readFileSync(part + '.complete.json', 'utf8')).toBe('keep-on-pause')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

mediaTest('IQ preserves two AAC tracks through mux and final acceptance', async () => {
  const bin = lookFFmpeg('ffmpeg'), root = mkdtempSync(join(tmpdir(), 'iq-mux-'))
  const source = join(root, 'source.mp4'), dest = join(root, 'final.mkv')
  try {
    await runIQFFmpeg(bin, ['-f', 'lavfi', '-i', 'color=size=64x64:rate=10:duration=0.4', '-f', 'lavfi', '-i', 'sine=duration=0.4', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', source], 'generate AV')
    await writeIQOutput(dest,
      path => runIQFFmpeg(bin, ['-i', source, '-i', source, '-map', '0:v:0', '-map', '0:a:0', '-map', '1:a:0', '-c', 'copy', path], 'mux'),
      path => runIQFFmpeg(bin, ['-xerror', '-err_detect', 'explode', '-i', path, '-map', '0:a', '-f', 'null', '-'], 'accept'),
    )
    expect(existsSync(dest)).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
