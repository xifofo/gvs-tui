import { expect,test } from 'bun:test'
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadIQParts } from './iq-transfer.ts'

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
