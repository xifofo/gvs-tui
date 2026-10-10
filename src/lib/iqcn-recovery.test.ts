import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GwClient } from './client.ts'
import { downloadIQCNLocalSegment, iqcnRestoreReason } from './iqcn-local.ts'
import { downloadIQCN } from './iqcn.ts'
import type { DlTask } from './jobs.ts'

test('segment 429 retains plan/index and does not refresh CDN or process incomplete media', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-rate-fixture-'))
  const calls: unknown[] = []
  let fetched = 0, restored = 0
  const cli = { invoke: async (_p: string, action: string, input: Record<string, unknown>) => {
    expect(action).toBe('download-segment')
    calls.push(input)
    if (calls.length === 1) throw Object.assign(new Error('limited'), { httpStatus: 429, errorCode: 'RATE_LIMITED', retryAfterMs: 1 })
    return { transport: 'local-v1', index: 8, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/8'] }
  } } as unknown as GwClient
  try {
    const data = await downloadIQCNLocalSegment(cli, 'same-plan', 8, 188, { version: 1, ticket: 'secret', identity: 'secret' }, work, undefined, {
      fetch: async () => { fetched++; return new Response(Buffer.alloc(188)) },
      restore: async (source, dest) => { restored++; copyFileSync(source, dest); return { version: 1, bytes: readFileSync(dest).length, restored: true, clearCandidate: false } },
    })
    expect(data.length).toBe(188)
    expect(calls).toEqual([{ planId: 'same-plan', index: 8 }, { planId: 'same-plan', index: 8 }])
    expect([fetched, restored]).toEqual([1, 1])
    expect(readdirSync(work)).toEqual([])
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('real job flow re-probes before streams and never submits the old episode hash', async () => {
  const calls: string[] = []
  const stop = new Error('stop before plan/media')
  const cli = { invoke: async (_p: string, action: string, input: Record<string, unknown>) => {
    calls.push(action)
    if (action === 'probe') {
      expect(input).toEqual({ tvid: 'episode2' })
      return { tvid: 'episode2', formats: [{ bid: 800, br: 200, fr: 60, vid: 'newHash', codec_code: 1 }] }
    }
    expect(input).toEqual({ tvid: 'episode2', bid: '800', br: '200', fr: '60', vid: 'newHash', transport: 'local-v1' })
    throw stop
  } } as unknown as GwClient
  await expect(downloadIQCN(cli, { vid: 'episode2', quality: '800|200|60|oldHash', codec: 'H265' } as DlTask, '', '', () => {})).rejects.toThrow(stop.message)
  expect(calls).toEqual(['probe', 'streams'])
})

test('restore diagnostics only accept fixed helper messages and never leak material', async () => {
  expect(iqcnRestoreReason('local segment restoration incomplete\n')).toBe('restore_incomplete')
  expect(iqcnRestoreReason('invalid local processing material')).toBe('material_invalid')
  expect(iqcnRestoreReason('secret ticket contents')).toBe('helper_failed')
  const work = mkdtempSync(join(tmpdir(), 'iqcn-restore-error-'))
  const cli = { invoke: async () => ({ transport: 'local-v1', index: 83, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/media'] }) } as unknown as GwClient
  try {
    await expect(downloadIQCNLocalSegment(cli, 'plan', 83, 188, { version: 1, ticket: 'secret', identity: 'secret' }, work, undefined, {
      fetch: async () => new Response(Buffer.alloc(188)), restore: async () => { throw new Error('ticket=secret key=secret') },
    })).rejects.toThrow('分片 84，188 字节，helper_failed')
    expect(readdirSync(work)).toEqual([])
  } finally { rmSync(work, { recursive: true, force: true }) }
})
