import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GwClient } from './client.ts'
import { downloadIQCNLocalSegment, iqcnSegmentFailureReason, type IQCNLocalRuntime, type IQCNSegmentTiming } from './iqcn-local.ts'
import { iqcnSegmentDescriptor } from './iqcn-control.ts'
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
    expect(calls).toEqual([{ planId: 'plan', index: 2, refresh: '1', batch: '1' }])
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

test('eight rejected initial URLs share one fresh batch and later segments skip stale plan URLs', async () => {
  const work = mkdtempSync(join(tmpdir(), 'iqcn-batch-retry-'))
  const calls: Record<string,unknown>[] = [], timings: IQCNSegmentTiming[] = [], fetched: string[] = []
  const cli = { host:'https://fixture.invalid', key:'A', invoke: async (_p:string,_a:string,input:Record<string,unknown>) => {
    calls.push(input)
    // Keep the first request pending until all eight workers have failed their initial URL.
    await allRejected
    return { ...fresh(Number(input.index)), relatedSegments:Array.from({length:16},(_,index)=>fresh(index)) }
  } } as unknown as GwClient
  let rejected=0, finish!:()=>void
  const allRejected=new Promise<void>(resolve=>{finish=resolve})
  const fresh=(index:number)=>({...descriptor(index),urls:[`https://fixture.ptqy.gitv.tv/new/${index}`]})
  const runtime: IQCNLocalRuntime = {restore,onTiming:t=>timings.push(t),fetch:async url=>{
    fetched.push(url)
    if(!url.includes('/new/')){
      if(++rejected===8)finish()
      return new Response('',{status:405})
    }
    return new Response(Buffer.alloc(188,Number(url.split('/').at(-1))))
  }}
  try {
    const bytes=await Promise.all(Array.from({length:8},(_,index)=>downloadIQCNLocalSegment(cli,'plan',index,188,material,work,undefined,runtime,descriptor(index))))
    expect(bytes.every((b,index)=>b.equals(Buffer.alloc(188,index)))).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({planId:'plan',refresh:'1',batch:'1'})
    expect(timings.reduce((sum,t)=>sum+t.descriptorRequests,0)).toBe(1)
    expect(timings.every(t=>t.fetchAttempts===2)).toBe(true)
    for(let index=8;index<16;index++){
      expect(await downloadIQCNLocalSegment(cli,'plan',index,188,material,work,undefined,runtime,descriptor(index))).toEqual(Buffer.alloc(188,index))
    }
    expect(calls).toHaveLength(1)
    expect(rejected).toBe(8)
    expect(fetched).toHaveLength(24)
    expect(timings.slice(8).every(t=>t.descriptorRequests===0&&t.fetchAttempts===1)).toBe(true)
  } finally { rmSync(work,{recursive:true,force:true}) }
})

test('an exhausted cached URL really refreshes, and identical failed URLs retain a bounded retry budget',async()=>{
  const work=mkdtempSync(join(tmpdir(),'iqcn-cache-expired-'))
  try{
    for(const renew of [true,false]){
      let calls=0, fetches=0
      const cli={host:'https://fixture.invalid',key:'A',invoke:async(_p:string,_a:string,input:Record<string,unknown>)=>{
        calls++
        return {...descriptor(Number(input.index)),urls:[`https://fixture.ptqy.gitv.tv/${renew&&calls>1?'new':'old'}`]}
      }} as unknown as GwClient
      await iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
      const download=downloadIQCNLocalSegment(cli,'plan',0,188,material,work,undefined,{
        restore,fetch:async url=>{fetches++;return url.endsWith('/new')?new Response(Buffer.alloc(188)):new Response('',{status:403})},
      },descriptor(0))
      if(renew)expect((await download).length).toBe(188)
      else await expect(download).rejects.toThrow('HTTP 403')
      expect(calls).toBe(2)
      expect(fetches).toBe(2)
    }
  }finally{rmSync(work,{recursive:true,force:true})}
})

test('a cached batch cannot override a mismatched plan byte count',async()=>{
  const work=mkdtempSync(join(tmpdir(),'iqcn-cached-mismatch-'))
  let fetches=0
  const cli={host:'https://fixture.invalid',key:'A',invoke:async()=>({...descriptor(0),relatedSegments:[descriptor(1)]})} as unknown as GwClient
  try{
    await iqcnSegmentDescriptor(cli,{planId:'plan',index:0})
    await expect(downloadIQCNLocalSegment(cli,'plan',1,188,material,work,undefined,{
      restore,fetch:async()=>{fetches++;return new Response(Buffer.alloc(188))},
    },{...descriptor(1),bytes:189})).rejects.toThrow('协议')
    expect(fetches).toBe(0)
  }finally{rmSync(work,{recursive:true,force:true})}
})

test('first-failure diagnostics use fixed reason codes without network secrets',()=>{
  expect(iqcnSegmentFailureReason(new Error('HTTP 405'))).toBe('http_405')
  expect(iqcnSegmentFailureReason(new Error('分片下载不完整'))).toBe('incomplete')
  expect(iqcnSegmentFailureReason(new Error('分片直连超时'))).toBe('timeout')
  for(const message of ['HTTP 405 https://fixture.ptqy.gitv.tv/?ticket=secret','分片 unexpected key=secret','secret']){
    expect(iqcnSegmentFailureReason(new Error(message))).toBe('network_failed')
  }
})
