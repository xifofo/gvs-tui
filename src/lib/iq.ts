import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Audio, Quality } from '../types.ts'
import type { GwClient } from './client.ts'
import type { FileConfig } from './config.ts'
import type { DlTask } from './jobs.ts'
import { asString, isObj, sleep } from './util.ts'
import { CdnDenied, downloadPlaylist, formatSpeed, headersFor } from './media.ts'
import { ensureFFmpeg, ensureM3u8dl } from './tools.ts'
import { tierHeight } from './name.ts'
import { adoptIQResume, iqResumeIdentity, iqVideoComplete, markIQVideoComplete } from './iq-resume.ts'

export function iqOptions(data: Record<string, unknown>): { qualities: Quality[]; audios: Audio[] } {
  const formats = Array.isArray(data.formats) ? data.formats.filter(isObj) : []
  const tracks = Array.isArray(data.audios) ? data.audios.filter(isObj) : []
  const qualities = formats.map(f => {
    const width = Number(f.width) || 0, height = Number(f.height) || 0, tier = tierHeight(width,height)
    const label = tier >= 2160 ? '4K' : tier ? `${tier}P` : asString(f.label)
    return { id: asString(f.id), label, title: `IQ TV · ${asString(f.codec).toUpperCase()}`, size: Number(f.size) || 0, width, height, codec: asString(f.codec), drm: Number(f.drm) === 5 ? 'IQ BBTS' : 'none', stream: asString(f.id), fps: Number(f.fps) || 25, tier }
  }).filter(f => f.id)
  const audios = tracks.map(a => ({ id: asString(a.id), label: asString(a.label), lang: asString(a.lang), codec: asString(a.codec), isDefault: a.default === true, selected: a.default === true, embedded: false })).filter(a => a.id)
  return { qualities, audios }
}

export function iqPlan(data: Record<string, unknown>): { playlist: string; key: string; rendition: string } {
  const video = isObj(data.video) ? data.video : {}
  const drm = isObj(data.drm) ? data.drm : {}
  const playlist = asString(video.playlist)
  if (!playlist.startsWith('#EXTM3U') || !playlist.includes('#EXT-X-ENDLIST')) throw new Error('IQ 未返回完整点播清单')
  const key = asString(drm.content_key_hex)
  if (drm.need_decrypt === true && !/^[a-f\d]{32}$/i.test(key)) throw new Error('IQ 当前片源缺少可用内容密钥')
  if (key && drm.scheme !== 'IQ_BBTS') throw new Error('IQ 未知解密算法，已停止')
  return { playlist, key, rendition: asString(video.vid) }
}

export function normalizeIQCookie(text: string): string {
  if (!text.includes('\t')) {
    if (/[\r\n]/.test(text)) throw new Error('IQ Cookie Header 不应包含换行')
    return text.trim()
  }
  return text.split(/\r?\n/).flatMap(line => {
    if (line.startsWith('#') && !line.startsWith('#HttpOnly_')) return []
    const parts = line.split('\t'), host = (parts[0] || '').replace(/^#HttpOnly_/, '')
    return parts.length >= 7 && (host === 'iq.com' || host === '.iq.com' || host.endsWith('.iq.com')) ? [`${parts[5]}=${parts[6]}`] : []
  }).join('; ')
}

async function download(url: string, dest: string, signal?: AbortSignal): Promise<void> {
  const u = new URL(url)
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('IQ 媒体地址格式无效')
  const response = await fetch(url, { headers: headersFor('https://www.iq.com/'), signal })
  if (!response.ok || !response.body) throw new Error(`IQ CDN HTTP ${response.status}`)
  const expected = Number(response.headers.get('content-length')) || 0
  let count = 0
  const reader = response.body.getReader()
  try {
    async function* chunks() {
      while (true) {
        const { value: chunk, done } = await reader.read()
        if (done) break
        signal?.throwIfAborted()
        count += chunk.byteLength
        yield chunk
      }
    }
    await pipeline(Readable.from(chunks()),createWriteStream(dest),{ signal })
  } finally {
    await reader.cancel().catch(()=>{})
    reader.releaseLock()
  }
  if (expected && count !== expected) throw new Error('IQ 下载字节数不完整')
}

function ffmpeg(bin: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['-hide_banner','-loglevel','error','-nostats',...args], { windowsHide: true, stdio: ['ignore','pipe','pipe'], signal })
    let error = ''
    child.stderr.on('data', data => { error += data.toString(); if (error.length > 4096) error = error.slice(-4096) })
    child.once('error', reject)
    child.once('close', code => code === 0 && !error.trim() ? resolve() : reject(new Error(`IQ 封装或音轨验收失败 (${code}): ${error.slice(-250)}`)))
  })
}

export async function downloadIQ(cli: GwClient, cfg: FileConfig, task: DlTask, dest: string, work: string, emit: (status: string, pct: number, log: string) => void, signal?: AbortSignal): Promise<void> {
  const re = await ensureM3u8dl()
  const version = spawnSync(re,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000})
  if (version.status !== 0 || !/gvs-iq\./i.test(version.stdout+version.stderr)) throw new Error('IQ 需要 GVS 自维护 RE，请更新内置工具或运行 build-managed-re')
  const play = () => cli.invoke('iq','play',{vid:task.vid,quality:task.quality},cli.extra(cfg,'iq'),{timeoutMs:150000})
  let data = await play()
  let plan = iqPlan(data)
  mkdirSync(work,{recursive:true})
  const manifest = join(work,'iq-video.m3u8'), video = join(work,'iq-video.ts')
  adoptIQResume(work,manifest,plan)
  const identity = iqResumeIdentity(plan)
  const videoStarted = Date.now()
  for (let retry=0; !iqVideoComplete(video,identity); retry++) {
    signal?.throwIfAborted()
    writeFileSync(manifest,plan.playlist,{mode:0o600})
    emit('视频下载',0.02,'校验片源后续传，保留已完成分片')
    try {
      await downloadPlaylist({src:manifest,dest:video,ref:'https://www.iq.com/',key:plan.key,keyMethod:'IQ_BBTS',select:'video',threads:cfg.threads,workDir:work,workTag:'iq-video',resumeIdentity:identity,signal,cb:(n,total,info)=>emit(info?.phase==='decrypt'?'视频解密':info?.phase==='merge'?'视频合并':'视频下载',0.02+0.66*(total>1?n/total:n),formatSpeed(n,total,(Date.now()-videoStarted)/1000,info))})
      markIQVideoComplete(video,identity)
    } catch (error) {
      signal?.throwIfAborted()
      const transient = error instanceof CdnDenied && [403,408,410,429,500,502,503,504].includes(error.status) ||
        error instanceof Error && /ResponseEnded|premature|timed?\s*out|connection.*(?:reset|closed)|unexpected.*end/i.test(error.message)
      if (!transient || retry >= 2) throw error
      emit('重试',0.02,`CDN 中断，刷新链接并续传 ${retry+1}/2`)
      await sleep(2000*(retry+1),signal)
      data = await play()
      plan = iqPlan(data)
      if (iqResumeIdentity(plan) !== identity) throw new Error('IQ 重新取链后片源或密钥改变，原分片已保留，请重新探测')
    }
  }
  const available = Array.isArray(data.audios) ? data.audios.filter(isObj) : []
  const requested = task.audioTracks?.length ? task.audioTracks.map(t => t.id) : available.filter(a => a.default === true).map(a => asString(a.id))
  if (!requested.length) throw new Error('IQ 没有返回默认独立音轨，请重新探测')
  const audioFiles: Array<{path:string;language:string;title:string}> = []
  for (const [index,id] of requested.entries()) {
    signal?.throwIfAborted()
    emit('音轨下载',0.70+0.12*index/requested.length,`独立音轨 ${index+1}/${requested.length}`)
    const audio = await cli.invoke('iq','audio',{vid:task.vid,audioId:id,renditionVid:plan.rendition},cli.extra(cfg,'iq'),{timeoutMs:150000})
    if (audio.clear !== true) throw new Error('IQ 独立音轨没有明确标记明文，已停止')
    const parts = Array.isArray(audio.parts) ? audio.parts.filter(isObj) : []
    if (!parts.length) throw new Error('IQ 独立音轨分段为空')
    const paths: string[] = []
    for (const [pi,part] of parts.entries()) {
      const path = join(work,`iq-audio-${index}-${pi}.part`)
      await download(asString(part.url),path,signal)
      paths.push(path)
    }
    const joined = join(work,`iq-audio-${index}.m4a`)
    function* audioChunks() {
      for (const [pi,path] of paths.entries()) {
        let bytes = readFileSync(path)
        if (pi===0 && bytes[0]===0x1f && bytes[1]===0x8b) bytes=gunzipSync(bytes)
        yield bytes
      }
    }
    await pipeline(Readable.from(audioChunks()),createWriteStream(joined),{ signal })
    audioFiles.push({path:joined,language:asString(audio.language)||'und',title:asString(audio.title)||'原声'})
  }
  const subs = Array.isArray(data.subtitles) ? data.subtitles.filter(isObj) : []
  const subtitleFiles: Array<{path:string;language:string;title:string}> = []
  emit('字幕下载',0.84,`${subs.length} 条源字幕`)
  for (const [index,sub] of subs.entries()) {
    const path = join(work,`iq-sub-${index}.${asString(sub.format)==='vtt'?'vtt':'srt'}`)
    await download(asString(sub.url),path,signal)
    const bytes = readFileSync(path)
    if (bytes[0]===0x1f && bytes[1]===0x8b) writeFileSync(path,gunzipSync(bytes))
    subtitleFiles.push({path,language:asString(sub.lang)||'und',title:asString(sub.label)+(sub.ai===true?' (AI)':'')})
  }
  emit('封装',0.9,'保留原始视频、独立音轨和字幕')
  mkdirSync(dirname(dest),{recursive:true})
  const args=['-i',video,...audioFiles.flatMap(a=>['-i',a.path]),...subtitleFiles.flatMap(s=>['-i',s.path]),'-map','0:v:0']
  for (let i=0;i<audioFiles.length;i++) args.push('-map',`${i+1}:a:0`)
  for (let i=0;i<subtitleFiles.length;i++) args.push('-map',`${1+audioFiles.length+i}:s:0`)
  args.push('-c','copy','-metadata:s:v:0','language=zho')
  audioFiles.forEach((a,i)=>args.push(`-metadata:s:a:${i}`,`language=${a.language}`,`-metadata:s:a:${i}`,`title=${a.title}`,`-disposition:a:${i}`,i===0?'default':'0'))
  subtitleFiles.forEach((s,i)=>args.push(`-metadata:s:s:${i}`,`language=${s.language}`,`-metadata:s:s:${i}`,`title=${s.title}`,`-disposition:s:${i}`,'0'))
  args.push('-n',dest)
  const executable=await ensureFFmpeg()
  await ffmpeg(executable,args,signal)
  emit('音轨验收',0.97,'检查所有合流音轨')
  await ffmpeg(executable,['-i',dest,'-map','0:a','-f','null','-'],signal)
}
