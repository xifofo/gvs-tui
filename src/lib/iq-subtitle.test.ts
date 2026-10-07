import {expect,test} from 'bun:test'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {gzipSync} from 'node:zlib'
import {downloadIQSubtitle} from './iq.ts'

test('HTTP-compressed IQ subtitles are validated after fetch decoding without comparing the compressed wire length',async()=>{
  const text='1\n00:00:01,000 --> 00:00:03,000\n'+('字幕内容'.repeat(100))+'\n'
  const compressed=gzipSync(Buffer.from(text)),dir=mkdtempSync(join(tmpdir(),'iq-subtitle-')),path=join(dir,'track.srt')
  const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response(compressed,{headers:{'content-type':'application/x-subrip','content-encoding':'gzip','content-length':String(compressed.length)}})})
  try{
    await downloadIQSubtitle(`http://127.0.0.1:${server.port}/subtitle.srt`,path)
    expect(readFileSync(path,'utf8')).toBe(text)
  }finally{await server.stop(true);rmSync(dir,{recursive:true,force:true})}
})
