import { expect,test } from 'bun:test'
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadIQParts } from './iq-transfer.ts'
import { downloadProgress } from './media.ts'
import { createHash } from 'node:crypto'

test('IQ audio uses all eight workers, preserves part order, and reuses complete parts across signed URL refresh',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-pool-'))
  let active=0,peak=0,requests=0
  const fetcher=async(url:string)=>{
    requests++;active++;peak=Math.max(peak,active)
    await new Promise(resolve=>setTimeout(resolve,15))
    active--
    return new Response(new URL(url).pathname,{headers:{'content-length':String(new URL(url).pathname.length)}})
  }
  const parts=Array.from({length:10},(_,i)=>({url:`https://cdn.iq.com/${i}.bin?key=first`,path:join(dir,`${i}.part`)}))
  const options={identity:'episode:rendition:audio-track',threads:8,headers:{},fetcher}
  try{
    await downloadIQParts(parts,options)
    expect(peak).toBe(8)
    expect(parts.map(p=>readFileSync(p.path,'utf8'))).toEqual(parts.map(p=>new URL(p.url).pathname))
    requests=0
    await downloadIQParts(parts.map(p=>({...p,url:p.url.replace('key=first','key=fresh')})),options)
    expect(requests).toBe(0)
    writeFileSync(parts[3]!.path,'truncated')
    await downloadIQParts(parts,options)
    expect(requests).toBe(1)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('a stopped IQ audio task opens no new requests',async()=>{
  const controller=new AbortController();controller.abort(new Error('pause'))
  let requests=0
  await expect(downloadIQParts([{url:'https://cdn.iq.com/file',path:'unused'}],{identity:'audio',threads:8,headers:{},signal:controller.signal,fetcher:async()=>{requests++;return new Response('x')}})).rejects.toThrow('pause')
  expect(requests).toBe(0)
})

test('the last large audio part still uses eight range connections without multiplying the thread budget',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-ranges-')), path=join(dir,'tail.part')
  const data=Buffer.alloc(8*1024*1024)
  for(let i=0;i<data.length;i++)data[i]=i%251
  let active=0,peak=0,ranges=0
  const fetcher=async(_url:string,init:RequestInit)=>{
    const range=new Headers(init.headers).get('range')!
    const match=/^bytes=(\d+)-(\d+)$/.exec(range)!
    const start=Number(match[1]),end=Number(match[2])
    if(end>0){ranges++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,20));active--}
    return new Response(data.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':String(end-start+1)}})
  }
  try{
    await downloadIQParts([{url:'https://cdn.invalid/tail.m4a',path}],{identity:'tail',threads:8,headers:{},
      downloadRanges:(url,dest,threads,received,signal)=>downloadProgress(url,dest,'https://www.iq.com/',received,undefined,threads,undefined,undefined,signal,fetcher)})
    expect(peak).toBe(8)
    expect(ranges).toBe(8)
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(createHash('sha256').update(data).digest('hex'))
  }finally{rmSync(dir,{recursive:true,force:true})}
})
