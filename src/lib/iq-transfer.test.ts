import { expect,test } from 'bun:test'
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadIQParts, invalidateIQAudioParts } from './iq-transfer.ts'
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

test('failed audio validation refreshes only audio completion records and leaves the finished video reusable',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-invalidated-')),audio=join(dir,'audio.part'),video=join(dir,'iq-video.ts.complete.json')
  let requests=0
  const options={identity:'audio',threads:8,headers:{},fetcher:async()=>{requests++;return new Response('valid',{headers:{'content-length':'5'}})}}
  try{
    writeFileSync(video,'video-complete')
    await downloadIQParts([{url:'https://cdn.iq.com/audio',path:audio}],options)
    invalidateIQAudioParts([audio])
    expect(readFileSync(audio,'utf8')).toBe('valid')
    expect(readFileSync(video,'utf8')).toBe('video-complete')
    await downloadIQParts([{url:'https://cdn.iq.com/audio',path:audio}],options)
    expect(requests).toBe(2)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('large IQ audio parts are whole GETs even when a CDN advertises unreliable byte ranges',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-ranges-')), path=join(dir,'tail.part')
  const data=Buffer.alloc(8*1024*1024)
  for(let i=0;i<data.length;i++)data[i]=i%251
  let requests=0
  const fetcher=async(_url:string,init:RequestInit)=>{
    requests++
    expect(new Headers(init.headers).get('range')).toBeNull()
    expect(new Headers(init.headers).get('if-range')).toBeNull()
    expect(init.cache).toBe('no-store')
    return new Response(data,{headers:{'accept-ranges':'bytes','content-length':String(data.length)}})
  }
  try{
    await downloadIQParts([{url:'https://cdn.invalid/tail.m4a',path}],{identity:'tail',threads:8,headers:{Range:'bytes=0-0','If-Range':'old'},fetcher})
    expect(requests).toBe(1)
    expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(createHash('sha256').update(data).digest('hex'))
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('IQ discards completed parts from the old nested-range downloader even if the byte count matches',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-old-ranges-')),path=join(dir,'audio.part')
  const url='https://cdn.iq.com/audio.amp4?qd_uri=audio&start=0&end=8&contentlength=8'
  const identity='episode:rendition:audio';let requests=0
  try{
    const u=new URL(url)
    const oldIdentity=createHash('sha256').update(JSON.stringify([identity,0,u.pathname,...['m','qd_uri','start','end','contentlength'].map(k=>u.searchParams.get(k))])).digest('hex')
    writeFileSync(path,'BADBYTES')
    writeFileSync(path+'.complete.json',JSON.stringify({identity:oldIdentity,bytes:8}))
    await downloadIQParts([{url,path}],{identity,threads:8,headers:{},fetcher:async()=>{requests++;return new Response('GOODDATA',{headers:{'content-length':'8'}})}})
    expect(requests).toBe(1)
    expect(readFileSync(path,'utf8')).toBe('GOODDATA')
    expect(JSON.parse(readFileSync(path+'.complete.json','utf8')).identity).not.toBe(oldIdentity)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('IQ rejects unsolicited partial bodies and does not record them as complete',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-unwanted-range-')),path=join(dir,'audio.part')
  let requests=0
  try{
    await expect(downloadIQParts([{url:'https://cdn.iq.com/audio',path}],{identity:'audio',threads:8,headers:{},fetcher:async()=>{
      requests++
      return new Response('partial',{status:206,headers:{'content-length':'7'}})
    }})).rejects.toThrow('IQ 音轨完整下载收到局部内容')
    expect(requests).toBe(3)
    expect(()=>readFileSync(path+'.complete.json')).toThrow()
  }finally{rmSync(dir,{recursive:true,force:true})}
})
