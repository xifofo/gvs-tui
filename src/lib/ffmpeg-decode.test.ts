import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { validateVideoDecode } from './ffmpeg.ts'

const mediaTest = process.platform === 'win32' && process.arch === 'x64' ? test : test.skip

mediaTest('subtitle tracks do not fail audio/video decode validation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gvs-decode-subs-'))
  const ff = resolve('bin/ffmpeg.exe')
  const out = join(dir, 'with-sub.mkv')
  try {
    writeFileSync(join(dir, 'cap.srt'), '1\n00:00:00,000 --> 00:00:00,200\nhi\n')
    const mux = spawnSync(ff, [
      '-nostdin', '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=12:d=0.2',
      '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=0.2',
      '-i', join(dir, 'cap.srt'),
      '-map', '0:v', '-map', '1:a', '-map', '2:s',
      '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'srt',
      out,
    ], { windowsHide: true, encoding: 'utf8' })
    if (mux.status !== 0) throw new Error(mux.stderr)
    const mapped = spawnSync(ff, ['-nostdin', '-v', 'error', '-i', out, '-map', '0', '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' })
    expect(mapped.status).not.toBe(0)
    expect(mapped.stderr).toMatch(/Encoder not found|sost/i)
    expect(await validateVideoDecode(ff, out)).toEqual([])
    const progress: number[] = []
    expect(await validateVideoDecode(ff, out, undefined, {requireAudio:true,onProgress:seconds=>progress.push(seconds)})).toEqual([])
    expect(progress.some(seconds=>seconds>0)).toBe(true)
    const silent = join(dir, 'silent.mkv')
    const silentResult=spawnSync(ff,['-nostdin','-v','error','-y','-i',out,'-map','0:v','-c','copy',silent],{windowsHide:true,encoding:'utf8'})
    expect(silentResult.status).toBe(0)
    expect((await validateVideoDecode(ff,silent,undefined,{requireAudio:true})).join(' ')).toContain('matches no streams')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
