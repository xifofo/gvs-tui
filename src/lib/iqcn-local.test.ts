import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, copyFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadIQCNLocalSegment, iqcnProcessing, restoreIQCNLocal, type IQCNLocalRuntime } from './iqcn-local.ts'
import type { GwClient } from './client.ts'

const material = { version: 1, ticket: 'fixture', identity: 'fixture' }
const copy: IQCNLocalRuntime['restore'] = async (source, destination) => {
  copyFileSync(source, destination)
  return { version: 1, bytes: readFileSync(source).length, restored: true, clearCandidate: false }
}

test('only the selected video drmType=1 permits an empty local ticket', () => {
  const plan = { transport: 'local-v1', localProcessing: { version: 1, ticket: '', identity: 'fixture' } }
  for (const drmType of [1, '1']) {
    expect(iqcnProcessing({ ...plan, video: { drmType } }))
      .toEqual({ version: 1, ticket: '', identity: 'fixture', drmType: 1 })
  }
  for (const drmType of [undefined, null, false, true, 0, 2, '2', 'unknown']) {
    expect(() => iqcnProcessing({ ...plan, video: { drmType } })).toThrow('同步更新')
  }
  expect(() => iqcnProcessing({ ...plan, drmType: 1, video: { drmType: 2 } })).toThrow('同步更新')
  expect(() => iqcnProcessing({ ...plan, formats: [{ drmType: 1, selected: false }] })).toThrow('同步更新')
  expect(iqcnProcessing({ ...plan, localProcessing: material })).toEqual(material)
  for (const invalid of [
    { ...plan, transport: 'legacy' },
    { ...plan, localProcessing: { ...plan.localProcessing, version: 2 } },
    { ...plan, localProcessing: { ...plan.localProcessing, identity: '' } },
  ]) {
    expect(() => iqcnProcessing({ ...invalid, video: { drmType: 1 } })).toThrow('同步更新')
  }
})

test('segment timing distinguishes descriptor, transfer and restoration without secrets',async()=>{
  const work=mkdtempSync(join(tmpdir(),'iqcn-timing-'))
  let observed:Record<string,unknown>|undefined
  const initial={transport:'local-v1',index:0,bytes:188,urls:['https://fixture.ptqy.gitv.tv/media?token=PRIVATE']}
  const cli={invoke:async()=>{throw new Error('prefetched URL must not refetch descriptor')}} as unknown as GwClient
  const result=await downloadIQCNLocalSegment(cli,'PRIVATE_PLAN',0,188,material,work,undefined,{
    fetch:async()=>{await Bun.sleep(12);return new Response(Buffer.alloc(188))},
    restore:async(...args)=>{await Bun.sleep(20);return copy(...args)},
    onTiming:timing=>{observed={...timing}},
  },initial)
  expect(result.length).toBe(188)
  expect(observed).toMatchObject({index:0,bytes:188,descriptorRequests:0,fetchAttempts:1})
  expect(Number(observed?.networkMs)).toBeGreaterThanOrEqual(10)
  expect(Number(observed?.restoreMs)).toBeGreaterThanOrEqual(15)
  expect(JSON.stringify(observed)).not.toContain('PRIVATE')
  expect(JSON.stringify(observed)).not.toContain(work)
})

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
  expect(requests).toEqual([{ planId: 'plan', index: 3, batch:'1' }])
  expect(JSON.stringify(requests).length).toBeLessThan(100)
  expect(readdirSync(work)).toEqual([])
})

test('domestic CDN redirects preserve direct local transfer and exact restored bytes', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-local-redirect-'))
  const bytes = Buffer.alloc(188, 0x47)
  try {
    for (const status of [301, 302, 303, 307, 308]) {
      const requests: string[] = []
      const initial = { transport: 'local-v1', index: 4, bytes: bytes.length, urls: ['https://data.video.ptqy.gitv.tv/media?signature=PRIVATE'] }
      const cli = { invoke: async () => { throw new Error('valid redirect must not refresh the descriptor') } } as unknown as GwClient
      const result = await downloadIQCNLocalSegment(cli, 'plan', 4, bytes.length, material, work, undefined, {
        fetch: async (url, init) => {
          requests.push(url)
          expect(init.redirect).toBe('manual')
          return requests.length === 1
            ? new Response('dispatch', { status, headers: { location: 'https://hscdnct.inter.ptqy.gitv.tv/media?signature=EDGE' } })
            : new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
        }, restore: copy,
      }, initial)
      expect(result.equals(bytes)).toBe(true)
      expect(requests.map(url => new URL(url).hostname)).toEqual(['data.video.ptqy.gitv.tv', 'hscdnct.inter.ptqy.gitv.tv'])
      expect(readdirSync(work)).toEqual([])
    }
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('relative CDN redirects work and the final response still requires the declared length', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-relative-redirect-'))
  const initial = { transport: 'local-v1', index: 0, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/dispatch'] }
  const cli = { invoke: async () => initial } as unknown as GwClient
  let restored = false
  try {
    const requests: string[] = []
    await expect(downloadIQCNLocalSegment(cli, 'plan', 0, 188, material, work, undefined, {
      fetch: async url => {
        requests.push(url)
        return new URL(url).pathname === '/dispatch'
          ? new Response(null, { status: 302, headers: { location: '/edge' } })
          : new Response(Buffer.alloc(100), { headers: { 'content-length': '100' } })
      },
      restore: async () => { restored = true; throw new Error('partial response must not be restored') },
    }, initial)).rejects.toThrow('分片长度不符')
    expect(requests).toEqual(Array(2).fill(['https://fixture.ptqy.gitv.tv/dispatch', 'https://fixture.ptqy.gitv.tv/edge']).flat())
    expect(restored).toBe(false)
    expect(readdirSync(work)).toEqual([])
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('CDN redirect validation blocks foreign hosts, credentials, downgrade, ports and missing locations', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-invalid-redirect-'))
  const initial = { transport: 'local-v1', index: 0, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/dispatch'] }
  const cli = { invoke: async () => initial } as unknown as GwClient
  try {
    for (const location of [undefined, 'https://example.com/media', 'https://127.0.0.1/media', 'https://ptqy.gitv.tv.evil.example/media',
      'http://fixture.ptqy.gitv.tv/media', 'https://user:pass@fixture.ptqy.gitv.tv/media', 'https://fixture.ptqy.gitv.tv:8443/media',
      'https://fixture.ptqy.gitv.tv/media#fragment', 'http://[']) {
      let restored = false
      const requests: string[] = []
      await expect(downloadIQCNLocalSegment(cli, 'plan', 0, 188, material, work, undefined, {
        fetch: async url => {
          requests.push(url)
          return new Response(null, { status: 302, headers: location === undefined ? {} : { location } })
        },
        restore: async () => { restored = true; throw new Error('unsafe response must not be restored') },
      }, initial)).rejects.toThrow(location === undefined ? '未返回跳转地址' : '不属于爱奇艺 CDN')
      expect(requests.every(url => url === initial.urls[0])).toBe(true)
      expect(requests.length).toBe(2)
      expect(restored).toBe(false)
      expect(readdirSync(work)).toEqual([])
    }
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('CDN redirect cycles and long chains stop without restoring or leaving scratch files', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-redirect-budget-'))
  const initial = { transport: 'local-v1', index: 0, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/0'] }
  const cli = { invoke: async () => initial } as unknown as GwClient
  try {
    for (const cycle of [true, false]) {
      let requests = 0
      await expect(downloadIQCNLocalSegment(cli, 'plan', 0, 188, material, work, undefined, {
        fetch: async url => {
          requests++
          return new Response(null, { status: 302, headers: { location: cycle ? '/0' : '/' + (Number(new URL(url).pathname.slice(1)) + 1) } })
        }, restore: async () => { throw new Error('redirect must not be restored') },
      }, initial)).rejects.toThrow(cycle ? '循环跳转' : '跳转次数过多')
      expect(requests).toBe(cycle ? 2 : 10)
      expect(readdirSync(work)).toEqual([])
    }
  } finally { rmSync(work, { recursive: true, force: true }) }
})

test('cancellation at a CDN redirect prevents the next request and restoration', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-redirect-abort-'))
  const initial = { transport: 'local-v1', index: 0, bytes: 188, urls: ['https://fixture.ptqy.gitv.tv/dispatch'] }
  const cli = { invoke: async () => initial } as unknown as GwClient
  const controller = new AbortController()
  let requests = 0
  try {
    await expect(downloadIQCNLocalSegment(cli, 'plan', 0, 188, material, work, controller.signal, {
      fetch: async () => {
        requests++
        controller.abort()
        return new Response(null, { status: 302, headers: { location: '/edge' } })
      }, restore: async () => { throw new Error('cancelled download must not be restored') },
    }, initial)).rejects.toThrow()
    expect(requests).toBe(1)
    expect(readdirSync(work)).toEqual([])
  } finally { rmSync(work, { recursive: true, force: true }) }
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
  expect(requests).toEqual([{ planId: 'plan', index: 0, batch:'1' }, { planId: 'plan', index: 0, refresh: '1', batch:'1' }])
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


test('explicit cleartext plans allow empty tickets; protected and unknown streams still require material', () => {
  const plan = { transport: 'local-v1', localProcessing: { version: 1, ticket: '', identity: 'fixture' }, video: { drmType: 1 } }
  expect(iqcnProcessing(plan)).toEqual({ version: 1, ticket: '', identity: 'fixture', drmType: 1 })
  expect(iqcnProcessing({ ...plan, localProcessing: material, video: { drmType: 5 } })).toEqual(material)
  expect(iqcnProcessing({ ...plan, localProcessing: material })).toEqual(material)
  expect(iqcnProcessing({ ...plan, localProcessing: { ...material, ticket: '  ' } })).toEqual({ version: 1, ticket: '', identity: 'fixture', drmType: 1 })
  for (const drmType of [undefined, 0, 5, 99, '2', null]) {
    expect(() => iqcnProcessing({ ...plan, video: { drmType } })).toThrow('同步更新')
  }
  for (const override of [
    { transport: 'legacy' },
    { localProcessing: { ...plan.localProcessing, version: 2 } },
    { localProcessing: { ...plan.localProcessing, identity: '' } },
    { localProcessing: undefined },
  ]) expect(() => iqcnProcessing({ ...plan, ...override })).toThrow('同步更新')
})

test('ticketless cleartext plan downloads through the installed helper and removes temporary files', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-cleartext-'))
  try {
    const bytes = Buffer.alloc(188 * 2)
    for (let i = 0; i < bytes.length; i += 188) { bytes[i] = 0x47; bytes[i + 3] = 0x10 }
    const processing = iqcnProcessing({ transport: 'local-v1', localProcessing: { version: 1, ticket: '', identity: 'fixture' }, video: { drmType: 1 } })
    const cli = { invoke: async () => ({ transport: 'local-v1', index: 0, bytes: bytes.length, urls: ['https://fixture.ptqy.gitv.tv/media'] }) } as unknown as GwClient
    const result = await downloadIQCNLocalSegment(cli, 'plan', 0, bytes.length, processing, work, undefined, {
      fetch: async () => new Response(bytes), restore: restoreIQCNLocal,
    })
    expect(result.equals(bytes)).toBe(true)
    expect(readdirSync(work)).toEqual([])
  } finally { rmSync(work, { recursive: true, force: true }) }
})
