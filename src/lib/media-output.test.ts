import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertCencMp4Output, youkuMediaError } from './media-output.ts'

test('CENC rejects TS without changing input bytes; a clear TS path stays allowed', () => {
  const root = mkdtempSync(join(tmpdir(), 'gvs-cenc-output-'))
  try {
    const file = join(root, 'input.mp4')
    const ts = Buffer.alloc(188 * 5)
    for (let i = 0; i < ts.length; i += 188) ts[i] = 0x47
    writeFileSync(file, ts)
    expect(() => assertCencMp4Output(file, true)).toThrow('CENC/MP4')
    expect(() => assertCencMp4Output(file, false)).not.toThrow()
    expect(readFileSync(file)).toEqual(ts)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('MP4 headers and incomplete sync coincidences are not classified as TS', () => {
  const root = mkdtempSync(join(tmpdir(), 'gvs-mp4-output-'))
  try {
    const file = join(root, 'input.mp4')
    const mp4 = Buffer.alloc(188 * 5)
    mp4.write('ftyp', 4)
    mp4[188] = 0x47
    writeFileSync(file, mp4)
    expect(() => assertCencMp4Output(file, true)).not.toThrow()
    writeFileSync(file, Buffer.from([0x47]))
    expect(() => assertCencMp4Output(file, true)).not.toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('decode error keeps its cause without claiming an account restriction', () => {
  const original = new Error('[aac] channel element 2.9 is not allocated')
  const mapped = youkuMediaError(original) as Error
  expect(mapped.cause).toBe(original)
  expect(mapped.message).toContain('不能判定')
  expect(mapped.message).not.toContain('扫码')
  expect(mapped.message).not.toContain('片源超出试看段后')
})

test('unrelated failures, cancellation and known EAC3 errors remain unchanged', () => {
  for (const text of ['HTTP 403', 'aborted', 'exponent -1 is out-of-range', 'truncated file']) {
    const error = new Error(text)
    expect(youkuMediaError(error)).toBe(error)
  }
})
