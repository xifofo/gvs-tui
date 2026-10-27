import { expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isEac3ExponentError, isEac3CompatibilityError, isEac3CompatibilityDiagnostic, validateEac3WithAudioToolbox } from './eac3-validation.ts'
import { validateAudio } from './ffmpeg.ts'
import { firstPresentationMs, inspectMediaTiming } from './media-timing.ts'

const exponent = '[eac3 @ 0x123] expacc 126 is out-of-range\n[eac3 @ 0x123] error decoding the audio block\n'
const progress = 'out_time_us=5862464000\nprogress=end\n'
const spectral = '[eac3 @ 0x123] invalid spectral extension range (11 >= 11)\n[eac3 @ 0x123] error decoding the audio block\n'
const opening = '[eac3 @ 0x123] exponent -1 is out-of-range\n[eac3 @ 0x123] error decoding the audio block\n'
const second = opening.replace('exponent -1', 'exponent 28')
const twoFrames = opening.repeat(2) + second
const codecs = '#codec_id 0: eac3\n#codec_id 1: aac\n'
const packet = '#tb 0: 1/48000\n#media_type 0: audio\n0, 12000, 12000, 1536, 384, 0x1\n'
type Reply = { exit?: number; stdout?: string; stderr?: string; wait?: boolean }

function fixture(replies: Reply[]) {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-eac3-check-'))
  const calls = join(dir, 'calls'), counter = join(dir, 'counter'), bin = join(dir, 'ffmpeg')
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
  writeFileSync(calls, '')
  writeFileSync(counter, '0\n')
  writeFileSync(bin, `#!/bin/sh
read -r count < ${quote(counter)}
printf '%s\\n' "$*" >> ${quote(calls)}
printf '%s\\n' "$((count + 1))" > ${quote(counter)}
case "$count" in
${replies.map((r, i) => `${i})
${r.wait ? 'exec sleep 30' : `printf '%s' ${quote(r.stdout || '')}\nprintf '%s' ${quote(r.stderr || '')} >&2\nexit ${r.exit || 0}`}
;;`).join('\n')}
*) exit 99 ;;
esac
`)
  chmodSync(bin, 0o755)
  return {
    bin, calls: (): string[][] => readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split(' ')),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const hostTest = process.platform !== 'win32' ? test : test.skip
const macTest = process.platform === 'darwin' ? test : test.skip

test('two observed exponent faults have exact values and bounded probe/decode counts', () => {
  for (const text of [opening, second, twoFrames]) {
    expect(isEac3CompatibilityError(text)).toBe(true)
    expect(isEac3CompatibilityDiagnostic(text)).toBe(true)
  }
  for (const text of [opening.repeat(3), second.repeat(2), twoFrames + second, twoFrames.replace('exponent 28', 'exponent 27'),
    twoFrames + 'frame CRC mismatch\n', twoFrames + 'partial file\n', twoFrames + spectral, opening.split('\n')[0]!]) {
    expect(isEac3CompatibilityDiagnostic(text)).toBe(false)
  }
})

macTest('the original two-fault audio is fully verified without dropping packets', async () => {
  const f = fixture([{ stdout: packet, stderr: opening }, { stdout: progress, stderr: twoFrames },
    { stdout: codecs, stderr: opening }, { stdout: progress, stderr: opening }])
  try {
    expect(await firstPresentationMs(f.bin, 'wolf.ts', 'a:0')).toBe(250)
    expect(f.calls()).toHaveLength(4)
    expect(f.calls()[1]).toContain('crccheck')
    expect(f.calls()[3]).toContain('eac3_at')
    for (const args of f.calls()) expect(args.some(a => a.startsWith('noise=') || a === '-ss' || a === '-t')).toBe(false)
  } finally { f.dispose() }
})

macTest('two-fault audio still rejects CRC damage, extra errors and incomplete native decode', async () => {
  for (const bad of [twoFrames + '[eac3 @ 0x123] frame CRC mismatch\n', twoFrames + second]) {
    const f = fixture([{ stdout: progress, stderr: bad }])
    try { await expect(validateEac3WithAudioToolbox(f.bin, 'wolf.ts')).rejects.toThrow('数据复核未通过') }
    finally { f.dispose() }
  }
  for (const bad of [{ stdout: 'progress=end\n' }, { stdout: progress, stderr: second.repeat(2) }, { stdout: progress, stderr: '[eac3_at @ 0x123] decode failed' }]) {
    const f = fixture([{ stdout: progress, stderr: twoFrames }, { stdout: codecs }, bad])
    try { await expect(validateEac3WithAudioToolbox(f.bin, 'wolf.ts')).rejects.toThrow() }
    finally { f.dispose() }
  }
})

test('only the observed E-AC-3 exponent failure is eligible for compatibility validation', () => {
  expect(isEac3ExponentError(exponent)).toBe(true)
  expect(isEac3ExponentError('[aac @ 0x123] channel element 2.5 is not allocated')).toBe(false)
  expect(isEac3ExponentError(exponent + 'frame CRC mismatch')).toBe(false)
  expect(isEac3ExponentError(exponent + 'partial file')).toBe(false)
})

macTest('E-AC-3 fallback validates full CRC and full system decode without changing the media', async () => {
  const f = fixture([
    { exit: 183, stderr: exponent },
    { stdout: progress, stderr: exponent.repeat(2) },
    { stdout: codecs },
    { stdout: progress },
  ])
  try {
    await validateAudio(f.bin, 'audio.mp4')
    const calls = f.calls()
    expect(calls).toHaveLength(4)
    expect(calls[1]).toContain('crccheck')
    expect(calls[1]).not.toContain('-xerror')
    expect(calls[3]).toContain('eac3_at')
    expect(calls[3]).toContain('-c:a:0')
    expect(calls[3]).not.toContain('-c:a:1')
    expect(calls[3]).toContain('-xerror')
    for (const args of [calls[0]!, calls[1]!, calls[3]!]) {
      expect(args).not.toContain('-t')
      expect(args).not.toContain('-ss')
      expect(args.slice(-3)).toEqual(['-f', 'null', '-'])
    }
  } finally { f.dispose() }
})

hostTest('CRC mismatch, repeated faults and unrelated errors cannot be hidden by system decoder concealment', async () => {
  for (const stderr of [
    exponent + '[eac3 @ 0x123] frame CRC mismatch\n',
    exponent.repeat(3),
    exponent + '[mov @ 0x123] partial file\n',
  ]) {
    const f = fixture([{ stdout: progress, stderr }, { stdout: progress }])
    try {
      await expect(validateEac3WithAudioToolbox(f.bin, 'audio.mp4')).rejects.toThrow('数据复核未通过')
      expect(f.calls()).toHaveLength(1)
    } finally { f.dispose() }
  }
})

hostTest('both decoders must finish and produce the same nonzero duration', async () => {
  for (const reply of [
    { stdout: '' },
    { stdout: 'out_time_us=1000000\nprogress=end\n' },
    { stdout: progress, stderr: 'invalid audio\n' },
    { stdout: progress, stderr: '[eac3_at @ 0x123] error decoding audio\n' },
    { stdout: progress, stderr: spectral.repeat(2) },
    { exit: 1, stderr: 'Unknown decoder eac3_at\n' },
  ]) {
    const f = fixture([{ stdout: progress, stderr: exponent.repeat(2) }, { stdout: codecs }, reply])
    try {
      await expect(validateEac3WithAudioToolbox(f.bin, 'audio.mp4')).rejects.toThrow()
      expect(f.calls()).toHaveLength(3)
    } finally { f.dispose() }
  }
  const f = fixture([{ stdout: 'progress=end\n', stderr: exponent }])
  try {
    await expect(validateEac3WithAudioToolbox(f.bin, 'audio.mp4')).rejects.toThrow('数据复核未通过')
  } finally { f.dispose() }
})

test('spectral extension compatibility is bounded to the observed E-AC-3 diagnostic', () => {
  expect(isEac3CompatibilityError(spectral)).toBe(true)
  expect(isEac3CompatibilityDiagnostic(spectral.repeat(2))).toBe(true)
  for (const stderr of [spectral.repeat(3), spectral.replace('11 >= 11', '12 >= 11'),
    spectral + 'File ended prematurely\n', spectral + '[aac @ 0x123] invalid data\n',
    spectral + '[eac3 @ 0x123] frame CRC mismatch\n']) {
    expect(isEac3CompatibilityDiagnostic(stderr)).toBe(false)
  }
  expect(isEac3CompatibilityError(spectral + 'partial file')).toBe(false)
})

macTest('spectral extension fallback preserves the original packet PTS after complete audio validation', async () => {
  const f = fixture([
    { stdout: packet, stderr: spectral },
    { stdout: progress, stderr: spectral.repeat(2) },
    { stdout: codecs, stderr: spectral },
    { stdout: progress },
  ])
  try {
    expect(await firstPresentationMs(f.bin, 'audio.ts', 'a:0')).toBe(250)
    expect(f.calls()).toHaveLength(4)
    expect(f.calls()[3]).toContain('-c:a:0')
    expect(f.calls()[3]).not.toContain('-c:a:1')
    for (const args of f.calls()) expect(args.some(value => value.startsWith('noise='))).toBe(false)
  } finally { f.dispose() }
})

macTest('completed packet coverage uses the same independently validated spectral compatibility', async () => {
  const f = fixture([
    { stdout: packet, stderr: spectral },
    { stdout: progress, stderr: spectral.repeat(2) },
    { stdout: codecs },
    { stdout: progress },
  ])
  try {
    const tracks = await inspectMediaTiming(f.bin, 'mixed.mkv')
    expect(tracks[0]!.firstMs).toBe(250)
    expect(f.calls()[3]).toContain('-c:a:0')
  } finally { f.dispose() }
})

hostTest('timestamp errors, missing PTS, repeated diagnostics and actual corruption still fail', async () => {
  for (const reply of [
    { stdout: packet, stderr: spectral, exit: 1 },
    { stderr: spectral },
    { stdout: packet, stderr: spectral.repeat(3) },
    { stdout: packet, stderr: spectral + 'File ended prematurely\n' },
    { stdout: packet, stderr: '[eac3 @ 0x123] frame CRC mismatch\n' },
    { stdout: packet, stderr: '[mov @ 0x123] partial file\n' + spectral.repeat(100) },
  ]) {
    const f = fixture([reply])
    try {
      await expect(firstPresentationMs(f.bin, 'audio.ts', 'a:0')).rejects.toThrow()
      expect(f.calls()).toHaveLength(1)
    } finally { f.dispose() }
  }
  const f = fixture([
    { stdout: packet, stderr: spectral },
    { stdout: progress, stderr: spectral + '[eac3 @ 0x123] frame CRC mismatch\n' },
  ])
  try {
    await expect(firstPresentationMs(f.bin, 'audio.ts', 'a:0')).rejects.toThrow()
    expect(f.calls()).toHaveLength(process.platform === 'darwin' ? 2 : 1)
  } finally { f.dispose() }
})

macTest('spectral extension audio validation also checks AAC tracks with their own decoder', async () => {
  const f = fixture([
    { stderr: spectral, exit: 183 },
    { stdout: progress, stderr: spectral.repeat(2) },
    { stdout: '#codec_id 0: aac\n#codec_id 1: eac3\n' },
    { stdout: progress },
  ])
  try {
    await validateAudio(f.bin, 'mixed.mkv')
    const last = f.calls()[3]!
    expect(last).toContain('-c:a:1')
    expect(last).not.toContain('-c:a:0')
  } finally { f.dispose() }
})

hostTest('unconfirmed codecs cannot activate the system decoder fallback', async () => {
  for (const stdout of ['', '#codec_id 0: aac\n', '#codec_id 1: eac3\n']) {
    const f = fixture([{ stdout: progress, stderr: spectral }, { stdout }])
    try {
      await expect(validateEac3WithAudioToolbox(f.bin, 'audio.ts')).rejects.toThrow('无法确认音频轨道编码')
      expect(f.calls()).toHaveLength(2)
    } finally { f.dispose() }
  }
})

macTest('indexed system decoder may retain only the bounded software probe diagnostic', async () => {
  const f = fixture([
    { stdout: progress, stderr: spectral.repeat(2) },
    { stdout: codecs, stderr: spectral },
    { stdout: progress, stderr: spectral },
  ])
  try {
    await validateEac3WithAudioToolbox(f.bin, 'mixed.mkv')
    expect(f.calls()).toHaveLength(3)
  } finally { f.dispose() }
})

hostTest('normal audio succeeds once and unrelated codec failures still stop', async () => {
  for (const reply of [{}, { exit: 183, stderr: '[aac @ 0x123] channel element 2.5 is not allocated' }]) {
    const f = fixture([reply])
    try {
      if (reply.exit) await expect(validateAudio(f.bin, 'audio.mp4')).rejects.toThrow('音轨解码校验失败')
      else await validateAudio(f.bin, 'audio.mp4')
      expect(f.calls()).toHaveLength(1)
    } finally { f.dispose() }
  }
})

hostTest('pausing during compatibility validation stops without accepting the file', async () => {
  const f = fixture([{ wait: true }]), stop = new AbortController()
  const timer = setInterval(() => {
    if (f.calls().length) stop.abort(new Error('paused'))
  }, 10)
  const deadline = setTimeout(() => stop.abort(new Error('fixture did not start')), 3000)
  try {
    await expect(validateEac3WithAudioToolbox(f.bin, 'audio.mp4', stop.signal)).rejects.toThrow('paused')
    expect(f.calls()).toHaveLength(1)
  } finally { clearInterval(timer); clearTimeout(deadline); f.dispose() }
})
