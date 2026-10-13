import { join } from 'node:path'
import type { DlTask } from './jobs'
import type { FileConfig } from './config'
import type { GwClient } from './client'
import { downloadPlaylist, downloadProgress, playlistStatus } from './media'
import { ensureFFmpeg, ensureMkvmerge } from './tools'
import { ffmpegConcat, validateAudio, validateVideoDecode } from './ffmpeg'
import { mkvmergeMux, mkvmergeRemux } from './mkvmerge'
import { mgtvCapabilities, miguCapabilities, selectedBilibiliMedia, webTracks, audioChoice, type WebTrack } from './web-video-providers'
import { probeFinishedMedia } from './gvs-record'
import { verifyMiguManifest } from './migu-manifest'
import { mgtvDurationCovers, mgtvExpectedDuration, verifyMgtvManifest } from './mgtv-manifest'

type Emit = (status: string, pct: number, log: string) => void
async function verifyCoverage(path: string, expected: number | undefined, signal?: AbortSignal, strict = false) {
  signal?.throwIfAborted()
  const media = await probeFinishedMedia(path,signal)
  if (media.status !== 'probed' || !media.durationSeconds) throw new Error('未能验证媒体时长，已保留下载文件，请检查媒体工具')
  if (expected && (strict ? !mgtvDurationCovers(media.durationSeconds, expected) : expected > 30 && media.durationSeconds < expected - Math.max(10,expected*.05))) throw new Error('实际视频明显短于分集时长，可能是试看；已停止生成成品')
}
export async function downloadWebVideo(cli: Pick<GwClient,'invoke'>, cfg: FileConfig, task: DlTask, dest: string, work: string, emit: Emit, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (task.provider === 'migu') {
    const data = await cli.invoke('migu','resolve',{id:task.vid,quality:task.quality,...miguCapabilities(task.vid)})
    if (String(data.id) !== task.vid.replace(/^tv:/,'')) throw new Error('咪咕返回了不同分集，已停止下载')
    if (String(data.actualQuality) !== task.quality) throw new Error('咪咕所选画质已不可用，请重新选档')
    if (data.trial === true || Number(data.trialDuration)>0) throw new Error('咪咕返回试看片段，已停止下载')
    const source = webTracks(data).find(t=>t.type === 'video')
    if (!source || source.source.trial === true) throw new Error('咪咕没有返回完整可下载媒体')
    if (source.source.upstreamNeedClothHat === true || source.source.needClothHat === true) {
      emit('校验', .03, '本机核对咪咕清单的加密声明')
      await verifyMiguManifest(source.url, source.headers, signal)
    }
    await downloadPlaylist({src:source.url,dest,ref:'https://www.miguvideo.com/',headers:source.headers,threads:cfg.threads,select:'muxed',muxTracks:true,transport:'re',workDir:work,workTag:'migu',signal,cb:(n,total,info)=>emit(playlistStatus('下载',info?.phase||'download'),.05+.85*(total>1?n/total:n),info?.log||'咪咕 CDN → 本机')})
    // Existing queued tasks may contain the old minute-prefix duration (45:25 → 45).
    const resolvedDuration = Number(source.source.duration)
    const expected = Math.max(task.duration || 0, Number.isFinite(resolvedDuration) ? resolvedDuration : 0)
    await verifyCoverage(dest,expected || undefined,signal)
    return
  }
  if (task.provider === 'mgtv') {
    const data = await cli.invoke('mgtv','play',{vid:task.vid,quality:task.quality,...mgtvCapabilities})
    if (String(data.vid || data.id) !== task.vid) throw new Error('芒果取流返回了不同分集，已停止下载')
    if (String(data.actualQuality) !== task.quality) throw new Error('芒果返回了不同画质，已停止下载')
    const source = webTracks(data).find(t => t.type === 'video')
    if (!source) throw new Error('芒果没有返回可用播放地址')
    emit('校验', .03, data.preview === true || Number(data.preview) === 1 ? '核对芒果播放清单是否为完整内容' : '核对芒果播放清单')
    const expected = mgtvExpectedDuration(task.duration, data.duration, source.source.duration)
    const headers = new Headers(source.headers)
    if (!headers.has('Referer')) headers.set('Referer', 'https://www.mgtv.com/')
    const checked = await verifyMgtvManifest(source.url, Object.fromEntries(headers), expected, signal)
    await downloadPlaylist({src:checked.url,dest,ref:'https://www.mgtv.com/',headers:source.headers,threads:cfg.threads,select:'muxed',muxTracks:true,transport:'re',workDir:work,workTag:'mgtv',signal,cb:(n,total,info)=>emit(playlistStatus('下载',info?.phase || 'download'),.05+.85*(total>1?n/total:n),info?.log || '芒果 CDN → 本机')})
    // A changed CDN playlist must not silently produce a short output after preflight.
    await verifyCoverage(dest,Math.max(expected || 0, checked.durationSeconds),signal,true)
    return
  }
  const [qn,family] = task.quality.split('|')
  const data = await cli.invoke('bilibili','resolve',{id:task.vid,quality:qn,...(['avc','hevc','av1'].includes(family || '') ? {codec:family} : {})})
  if (String(data.id) !== task.vid) throw new Error('B 站取流返回了不同分集，已停止下载')
  const audioIds = (task.audioTracks || []).filter(a=>a.id !== 'embedded').map(a=>a.id)
  const plan = selectedBilibiliMedia(data,task.quality,audioIds)
  const ffmpeg = await ensureFFmpeg(), mkvmerge = await ensureMkvmerge()
  const inputs = [...plan.videos,...plan.audios], paths: string[] = []
  for (let i=0;i<inputs.length;i++) {
    signal?.throwIfAborted()
    const track = inputs[i]!, path = join(work,`bili-${i}.mp4`)
    const urls = [track.url,...(Array.isArray(track.source.backupUrls) ? track.source.backupUrls.filter((v):v is string=>{
      if (typeof v !== 'string') return false
      try {const u=new URL(v);return ['http:','https:'].includes(u.protocol) && !u.username && !u.password}catch{return false}
    }) : [])]
    let successful = false
    for (const url of urls) {
      try {
        await downloadProgress(url,path,'https://www.bilibili.com/',(bytes,total)=>emit('下载',.05+.75*(i+(total>0?bytes/total:0))/inputs.length,`${track.type === 'audio' ? '音频' : '视频'} ${i+1}/${inputs.length}`),undefined,cfg.threads,undefined,track.headers,signal)
        successful=true;break
      } catch (error) { signal?.throwIfAborted(); if (url === urls.at(-1)) throw error }
    }
    if (!successful) throw new Error('B 站轨道下载失败')
    paths.push(path)
  }
  emit('校验',.82,'检查媒体轨道')
  for (const path of paths.slice(0,plan.videos.length)) {
    const errors = await validateVideoDecode(ffmpeg,path,signal)
    if (errors.length) throw new Error('B 站视频解码校验失败，已停止封装')
  }
  for (const path of paths.slice(plan.videos.length)) await validateAudio(ffmpeg,path,signal)
  emit('封装',.9,'本机合并视频和音频')
  if (!plan.videos[0]!.separate) {
    if (paths.length===1) await mkvmergeRemux(mkvmerge,paths[0]!,dest,undefined,signal)
    else {
      const combined = join(work,'bili-combined.mkv')
      await ffmpegConcat(ffmpeg,paths,combined,signal)
      await mkvmergeRemux(mkvmerge,combined,dest,undefined,signal)
    }
  } else {
    const audios = plan.audios.map((track:WebTrack,i:number) => ({path:paths[plan.videos.length+i]!,lang:'und',isDefault:task.audioTracks?.find(a=>a.id === audioChoice(track))?.isDefault}))
    await mkvmergeMux(mkvmerge,paths[0]!,audios,dest,undefined,signal)
  }
  await verifyCoverage(dest,task.duration,signal)
}
