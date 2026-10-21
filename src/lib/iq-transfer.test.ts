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

const quickPolicy={responseTimeoutMs:30,idleTimeoutMs:30,slowWindowMs:40,minBytesPerSecond:0,retryDelayMs:0}

test('IQ header stalls refresh one plan for concurrent workers and preserve completed parts',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-refresh-'))
  const parts=Array.from({length:3},(_,i)=>({url:`https://old.iq.com/${i}.m4a?token=old`,path:join(dir,`${i}.part`)}))
  let refreshes=0
  const requests:string[]=[],reasons:string[]=[]
  try{
    await downloadIQParts([parts[0]!],{identity:'track',threads:1,headers:{},fetcher:async()=>new Response('kept')})
    await downloadIQParts(parts,{identity:'track',threads:3,headers:{},policy:quickPolicy,
      fetcher:async url=>{
        requests.push(new URL(url).host+new URL(url).pathname)
        return new URL(url).host==='old.iq.com' ? new Promise<Response>(()=>{}) : new Response(new URL(url).pathname)
      },
      refreshParts:async()=>{
        refreshes++
        await new Promise(resolve=>setTimeout(resolve,10))
        return parts.map(p=>({url:p.url.replace('old.iq.com','new.iq.com').replace('token=old','token=fresh')}))
      },onRetry:(_i,_a,reason)=>reasons.push(reason),
    })
    expect(refreshes).toBe(1)
    expect(requests).toHaveLength(4)
    expect(requests.some(url=>url.endsWith('/0.m4a'))).toBe(false)
    expect(readFileSync(parts[0]!.path,'utf8')).toBe('kept')
    expect(parts.slice(1).map(p=>readFileSync(p.path,'utf8'))).toEqual(['/1.m4a','/2.m4a'])
    expect(reasons).toEqual(['音轨分段等待响应超时','音轨分段等待响应超时'])
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('IQ refreshes a stalled response body and replaces the whole incomplete part',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-body-stall-')),path=join(dir,'audio.part')
  let cancelled=0,refreshes=0
  try{
    await downloadIQParts([{url:'https://old.iq.com/file?token=old',path}],{identity:'track',threads:1,headers:{},policy:quickPolicy,
      fetcher:async url=>new URL(url).host==='old.iq.com' ? new Response(new ReadableStream({
        start(controller){controller.enqueue(new TextEncoder().encode('BAD'))},cancel(){cancelled++},
      })) : new Response('GOOD'),
      refreshParts:async()=>{refreshes++;return [{url:'https://new.iq.com/file?token=fresh'}]},
    })
    expect(refreshes).toBe(1)
    expect(cancelled).toBe(1)
    expect(readFileSync(path,'utf8')).toBe('GOOD')
    expect(JSON.parse(readFileSync(path+'.complete.json','utf8')).bytes).toBe(4)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('IQ default policy completes slowly progressing parallel parts without refreshing or discarding bytes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-slow-progress-'))
  const parts=Array.from({length:3},(_,i)=>({url:`https://cdn.iq.com/${i}.m4a`,path:join(dir,`${i}.part`)}))
  const expected=Buffer.alloc(12*128,7)
  let requests=0,refreshes=0,retries=0
  try{
    // Keep the production speed floor, shortening only the time windows. The
    // previous 64 KiB/s default repeatedly aborted these ~8 KiB/s transfers.
    const options={identity:'slow-track',threads:3,headers:{},
      policy:{responseTimeoutMs:500,idleTimeoutMs:250,slowWindowMs:40,retryDelayMs:0},
      fetcher:async()=>{
        requests++
        let offset=0,timer:ReturnType<typeof setInterval>
        return new Response(new ReadableStream({
          start(controller){timer=setInterval(()=>{
            controller.enqueue(expected.subarray(offset,offset+128));offset+=128
            if(offset===expected.length){clearInterval(timer);controller.close()}
          },15)},cancel(){clearInterval(timer)},
        }),{headers:{'content-length':String(expected.length)}})
      },
      refreshParts:async()=>{refreshes++;return parts.map(p=>({url:p.url}))},
      onRetry:()=>{retries++},
    }
    await downloadIQParts(parts,options)
    expect(requests).toBe(3)
    expect(refreshes).toBe(0)
    expect(retries).toBe(0)
    for(const part of parts){
      expect(readFileSync(part.path)).toEqual(expected)
      expect(JSON.parse(readFileSync(part.path+'.complete.json','utf8')).bytes).toBe(expected.length)
    }
    await downloadIQParts(parts,options)
    expect(requests).toBe(3)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('IQ explicitly enabled low-speed policy refreshes at most twice and then stops without a completion record',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-low-speed-')),path=join(dir,'audio.part')
  let refreshes=0,requests=0,cancelled=0
  const reasons:string[]=[]
  try{
    await expect(downloadIQParts([{url:'https://cdn.iq.com/file?token=0',path}],{
      identity:'track',threads:1,headers:{},policy:{...quickPolicy,minBytesPerSecond:10_000},
      fetcher:async()=>{
        requests++
        let timer:ReturnType<typeof setInterval>
        return new Response(new ReadableStream({start(controller){timer=setInterval(()=>controller.enqueue(new Uint8Array([1])),5)},cancel(){clearInterval(timer);cancelled++}}))
      },
      refreshParts:async()=>{refreshes++;return [{url:`https://cdn.iq.com/file?token=${refreshes}`}]},
      onRetry:(_i,_a,reason)=>reasons.push(reason),
    })).rejects.toThrow('音轨分段持续低速')
    expect(requests).toBe(3)
    expect(refreshes).toBe(2)
    expect(cancelled).toBe(3)
    expect(reasons).toEqual(['音轨分段持续低速','音轨分段持续低速'])
    expect(()=>readFileSync(path+'.complete.json')).toThrow()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('IQ fresh links must describe the same physical parts before any replacement request',async()=>{
  for(const change of ['file','window','count']){
    const dir=mkdtempSync(join(tmpdir(),'iq-audio-changed-plan-')),path=join(dir,'audio.part')
    let requests=0
    try{
      await expect(downloadIQParts([{url:'https://cdn.iq.com/file?start=0&end=10',path}],{
        identity:'track',threads:1,headers:{},policy:quickPolicy,
        fetcher:async()=>{requests++;throw new Error('connection closed')},
        refreshParts:async()=>change==='count'?[]:[{url:change==='file'?'https://cdn.iq.com/other?start=0&end=10':'https://cdn.iq.com/file?start=1&end=10'}],
      })).rejects.toThrow('IQ 重新取链后音轨分段改变')
      expect(requests).toBe(1)
      expect(()=>readFileSync(path+'.complete.json')).toThrow()
    }finally{rmSync(dir,{recursive:true,force:true})}
  }
})

test('IQ can pause while refreshing links without waiting for the gateway or opening another request',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-pause-refresh-')),path=join(dir,'audio.part')
  const controller=new AbortController()
  let requests=0
  try{
    await expect(downloadIQParts([{url:'https://cdn.iq.com/file',path}],{
      identity:'track',threads:1,headers:{},signal:controller.signal,policy:quickPolicy,
      fetcher:async()=>{requests++;throw new Error('connection closed')},
      refreshParts:async()=>{setTimeout(()=>controller.abort(new Error('pause')),10);return new Promise(()=>{})},
    })).rejects.toThrow('pause')
    expect(requests).toBe(1)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('IQ removes stale completion records before retrying a truncated cached file',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-stale-marker-')),path=join(dir,'audio.part')
  const parts=[{url:'https://cdn.iq.com/file',path}],options={identity:'track',threads:1,headers:{},policy:quickPolicy}
  try{
    await downloadIQParts(parts,{...options,fetcher:async()=>new Response('GOOD')})
    writeFileSync(path,'truncated')
    await expect(downloadIQParts(parts,{...options,fetcher:async()=>new Response(new ReadableStream({
      start(controller){controller.enqueue(new TextEncoder().encode('BAD!'))},
    }))})).rejects.toThrow('音轨分段传输停滞')
    expect(()=>readFileSync(path+'.complete.json')).toThrow()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('IQ audio downloads an IP URL with port and reuses it after a signed domain refresh', async () => {
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-ip-')), path=join(dir,'part.amp4')
  const payload=Buffer.from('whole audio bytes from the local IP fixture')
  let requests=0
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(req){
    requests++
    const url=new URL(req.url)
    expect(url.pathname).toBe('/videos/v0/audio.amp4')
    expect(url.searchParams.get('key')).toBe('signed+value')
    expect(req.headers.get('range')).toBeNull()
    return new Response(payload,{headers:{'content-length':String(payload.length)}})
  }})
  try {
    await downloadIQParts([{url:`http://127.0.0.1:${server.port}/videos/v0/audio.amp4?key=signed%2Bvalue`,path}],{identity:'episode:6:1:500',threads:1,headers:{}})
    expect(readFileSync(path)).toEqual(payload)
    await downloadIQParts([{url:'https://audio.inter.iqiyi.com/videos/v0/audio.amp4?key=fresh',path}],{identity:'episode:6:1:500',threads:1,headers:{},fetcher:async()=>{throw new Error('completed file must be reused')}})
    expect(requests).toBe(1)
  }finally{server.stop(true);rmSync(dir,{recursive:true,force:true})}
})

test('IQ audio preserves bracketed IPv6 URLs and refreshed signing parameters', async () => {
  const dir=mkdtempSync(join(tmpdir(),'iq-audio-ipv6-')),path=join(dir,'part.amp4')
  const url='http://[2001:db8::1]:8080/videos/v0/audio.amp4?key=signed%2Bvalue'
  try {
    await downloadIQParts([{url,path}],{identity:'ipv6-audio',threads:1,headers:{},fetcher:async received=>{
      expect(received).toBe(url)
      return new Response('audio',{headers:{'content-length':'5'}})
    }})
    expect(readFileSync(path,'utf8')).toBe('audio')
  }finally{rmSync(dir,{recursive:true,force:true})}
})
