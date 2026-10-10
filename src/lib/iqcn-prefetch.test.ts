import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GwClient } from './client.ts'
import { downloadIQCNLocalSegment, type IQCNLocalRuntime } from './iqcn-local.ts'
import { orderedDownload } from './ordered-download.ts'

const material = { version: 1, ticket: 'fixture', identity: 'fixture' }
const restore: IQCNLocalRuntime['restore'] = async (source, dest) => {
  copyFileSync(source, dest)
  return { version: 1, bytes: readFileSync(dest).length, restored: true, clearCandidate: false }
}
const descriptor = (index: number) => ({ transport: 'local-v1', index, bytes: 188, urls: [`https://fixture.ptqy.gitv.tv/${index}`] })

test('plan URLs let all eight CDN transfers start without per-segment gateway requests', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-parallel-'))
  let active = 0, peak = 0, calls = 0
  const pending: Array<() => void> = [], written: number[] = []
  const cli = { invoke: async () => { calls++; throw new Error('unexpected gateway round trip') } } as unknown as GwClient
  try {
    await orderedDownload({ sizes: Array(8).fill(188), threads: 8,
      pull: (index, signal) => downloadIQCNLocalSegment(cli, 'plan', index, 188, material, work, signal, {
        restore,
        fetch: async (_url, init) => new Promise<Response>((resolve, reject) => {
          active++; peak = Math.max(peak, active)
          const timer = setTimeout(() => reject(new Error('parallel downloads serialized')), 1500)
          init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) }, { once: true })
          pending.push(() => { clearTimeout(timer); active--; resolve(new Response(Buffer.alloc(188, index))) })
          if (pending.length === 8) pending.splice(0).reverse().forEach(finish => finish())
        }),
      }, descriptor(index)),
      write: (_bytes, index) => { written.push(index) },
    })
    expect(peak).toBe(8)
    expect(calls).toBe(0)
    expect(written).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('expired initial URL refreshes only the rejected segment through its original plan', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-initial-expired-'))
  const calls: unknown[] = []
  const cli = { invoke: async (_p: string, action: string, input: unknown) => {
    expect(action).toBe('download-segment'); calls.push(input)
    return { ...descriptor(2), urls: ['https://fixture.ptqy.gitv.tv/new'] }
  } } as unknown as GwClient
  try {
    const bytes = await downloadIQCNLocalSegment(cli, 'plan', 2, 188, material, work, undefined, {
      restore, fetch: async url => url.endsWith('/new') ? new Response(Buffer.alloc(188)) : new Response('', { status: 403 }),
    }, descriptor(2))
    expect(bytes.length).toBe(188)
    expect(calls).toEqual([{ planId: 'plan', index: 2, refresh: '1' }])
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('initial descriptor identity and byte count must match the selected segment', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-initial-mismatch-'))
  const cli = { invoke: async () => { throw new Error('must not fetch') } } as unknown as GwClient
  try {
    for (const wrong of [{ ...descriptor(1), bytes: 189 }, descriptor(2)]) {
      await expect(downloadIQCNLocalSegment(cli, 'plan', 1, 188, material, work, undefined, {
        restore, fetch: async () => { throw new Error('must not fetch') },
      }, wrong)).rejects.toThrow('协议')
    }
  } finally { rmSync(work, { recursive: true, force: true }) }
})
