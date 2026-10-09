import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, copyFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadIQCNLocalSegment, iqcnProcessing, restoreIQCNLocal, type IQCNLocalRuntime } from './iqcn-local.ts'
import type { GwClient } from './client.ts'

const material = { version: 1, ticket: 'fixture', identity: 'fixture' }
const copy: IQCNLocalRuntime['restore'] = async (source, destination) => {
  copyFileSync(source, destination)
  return { version: 1, bytes: readFileSync(source).length, restored: true, clearCandidate: false }
}

test('18.8 MB segment goes directly to local disk; gateway carries only small metadata', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-local-large-'))
  const size = 18800752, bytes = Buffer.alloc(size, 0x47)
  const requests: unknown[] = []
  const cli = { invoke: async (provider: string, action: string, input: unknown) => {
    expect([provider, action]).toEqual(['iqcn', 'download-segment'])
    requests.push(input)
    return { transport: 'local-v1', index: 3, bytes: size, urls: ['https://fixture.ptqy.gitv.tv/media?private=signature'] }
  } } as unknown as GwClient
  let fetched = 0
  const result = await downloadIQCNLocalSegment(cli, 'plan', 3, size, material, work, undefined, {
    fetch: async (url, init) => {
      expect(url).toContain('fixture.ptqy.gitv.tv')
      expect(init.redirect).toBe('manual')
      fetched++
      return new Response(bytes)
    }, restore: copy,
  })
  expect(result.equals(bytes)).toBe(true)
  expect(fetched).toBe(1)
  expect(requests).toEqual([{ planId: 'plan', index: 3 }])
  expect(JSON.stringify(requests).length).toBeLessThan(100)
  expect(readdirSync(work)).toEqual([])
})

test('truncated CDN body refreshes its address once and never processes partial bytes', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-local-retry-'))
  const requests: unknown[] = []
  const cli = { invoke: async (_p: string, _a: string, input: unknown) => {
    requests.push(input)
    return { transport: 'local-v1', index: 0, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/media'] }
  } } as unknown as GwClient
  let restored = false
  await expect(downloadIQCNLocalSegment(cli, 'plan', 0, 188, material, work, undefined, {
    fetch: async () => new Response(Buffer.alloc(100)),
    restore: async () => { restored = true; throw new Error('must not run') },
  })).rejects.toThrow('不完整')
  expect(restored).toBe(false)
  expect(requests).toEqual([{ planId: 'plan', index: 0 }, { planId: 'plan', index: 0, refresh: '1' }])
  expect(readdirSync(work)).toEqual([])
})

test('expired CDN location is refreshed and the replacement is fetched locally', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-local-refresh-'))
  let requests = 0, fetches = 0
  const cli = { invoke: async (_p: string, _a: string, input: Record<string, unknown>) => {
    expect(input.refresh).toBe(requests++ ? '1' : undefined)
    return { transport: 'local-v1', index: 0, bytes: 188, urls: [`https://fixture.ptqy.gitv.tv/${requests}`] }
  } } as unknown as GwClient
  const result = await downloadIQCNLocalSegment(cli, 'plan', 0, 188, material, work, undefined, {
    fetch: async () => ++fetches === 1 ? new Response('', { status: 403 }) : new Response(Buffer.alloc(188)), restore: copy,
  })
  expect(result.length).toBe(188)
  expect(requests).toBe(2)
  expect(readdirSync(work)).toEqual([])
})

test('cancellation stops before fetching or processing another segment', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-local-abort-')), controller = new AbortController()
  const cli = { invoke: async () => {
    controller.abort()
    return { transport: 'local-v1', index: 0, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/media'] }
  } } as unknown as GwClient
  let fetched = false
  await expect(downloadIQCNLocalSegment(cli, 'plan', 0, 188, material, work, controller.signal, {
    fetch: async () => { fetched = true; return new Response('') }, restore: copy,
  })).rejects.toThrow()
  expect(fetched).toBe(false)
  expect(readdirSync(work)).toEqual([])
})

test('legacy gateway and non-CDN locations cannot silently reenable server media processing', async () => {
  expect(() => iqcnProcessing({ planId: 'old', video: {} })).toThrow('同步更新')
  const work = mkdtempSync(join(tmpdir(), 'iqcn-local-url-'))
  for (const url of ['https://example.com/media', 'http://fixture.ptqy.gitv.tv/media', 'https://user:pass@fixture.ptqy.gitv.tv/media']) {
    const cli = { invoke: async () => ({ transport: 'local-v1', index: 0, bytes: 188, urls: [url] }) } as unknown as GwClient
    await expect(downloadIQCNLocalSegment(cli, 'plan', 0, 188, material, work, undefined, {
      fetch: async () => { throw new Error('unexpected fetch') }, restore: copy,
    })).rejects.toThrow('CDN')
  }
})

test('installed local helper rejects invalid material without overwriting output', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-helper-')), source = join(work, 'in.ts'), dest = join(work, 'out.ts')
  writeFileSync(source, Buffer.alloc(188))
  writeFileSync(dest, 'existing')
  await expect(restoreIQCNLocal(source, dest, material)).rejects.toThrow('还原失败')
  expect(readFileSync(dest, 'utf8')).toBe('existing')
})
