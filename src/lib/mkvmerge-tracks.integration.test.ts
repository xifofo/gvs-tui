import {expect,test} from 'bun:test'
import {spawnSync} from 'node:child_process'
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {mkvmergeTrackFiles} from './mkvmerge.ts'
import {ensureFFmpeg,ensureMkvmerge} from './tools.ts'
import {validateVideoDecode} from './ffmpeg.ts'
const mediaTest=process.env.GVS_MEDIA_TESTS==='1'?test:test.skip
mediaTest('independent RE tracks preserve audio and subtitle language when RE produces no MKV',async()=>{
  const root=mkdtempSync(join(tmpdir(),'gvs-re-track-mux-'))
  try {
    const ff=await ensureFFmpeg(), mkv=await ensureMkvmerge()
    const video=join(root,'download.mp4'),audio=join(root,'download.en.m4a'),sub=join(root,'download.zh-Hant.copy.srt'),out=join(root,'result.mkv')
    const args=['-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=64x64:r=12:d=0.4','-f','lavfi','-i','sine=sample_rate=48000:duration=0.4','-map','0:v','-c:v','libx264',video,'-map','1:a','-c:a','aac',audio]
    const made=spawnSync(ff,args,{windowsHide:true,encoding:'utf8',timeout:10000})
    if(made.status!==0)throw new Error(made.stderr)
    writeFileSync(sub,'1\n00:00:00,000 --> 00:00:00,300\n繁體中文字幕\n')
    const seen:number[]=[]
    await mkvmergeTrackFiles(mkv,[video,audio,sub],out,(n)=>seen.push(n))
    expect(await validateVideoDecode(ff,out,undefined,{requireAudio:true})).toEqual([])
    const probe=spawnSync(mkv,['-J',out],{windowsHide:true,encoding:'utf8',timeout:10000})
    const tracks=JSON.parse(probe.stdout).tracks
    expect(tracks.map((t:any)=>t.type).sort()).toEqual(['audio','subtitles','video'])
    const subtitle=tracks.find((t:any)=>t.type==='subtitles')
    expect(subtitle.properties.language_ietf).toBe('zh-Hant')
    expect(subtitle.properties.default_track).toBe(false)
    expect(tracks.find((t:any)=>t.type==='audio').properties.language_ietf).toBe('en')
    expect(seen.some(n=>n>0)).toBe(true)
    const missing=join(root,'no-audio.mkv')
    await expect(mkvmergeTrackFiles(mkv,[video,sub],missing)).rejects.toThrow('缺少')
    expect(existsSync(missing)).toBe(false)
  } finally {rmSync(root,{recursive:true,force:true})}
},30000)
