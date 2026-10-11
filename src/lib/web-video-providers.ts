import type { Audio, Quality } from '../types'
import { isObj } from './util'

export type WebVideoProvider = 'mgtv' | 'bilibili' | 'migu'
export const isWebVideoProvider = (p: string): p is WebVideoProvider => p === 'mgtv' || p === 'bilibili' || p === 'migu'
type Obj = Record<string, unknown>
type Invoke = (provider: string, action: string, input: Obj) => Promise<Obj>
const str = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
const num = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0
const rows = (v: unknown): Obj[] => Array.isArray(v) ? v.filter(isObj) : []
export const mgtvCapabilities = { support4k: true, supportHDR10: true, qualityPolicy: 'best' }

export function webVideoLink(input: string): { provider: WebVideoProvider; url: string } | undefined {
  if (/^tv:[0-9]{6,20}$/.test(input.trim())) return {provider:'migu',url:input.trim()}
  if (/^(BV[\da-zA-Z]{10}(?:\?p=[1-9]\d*)?|av[1-9]\d*|ep[1-9]\d*|ss[1-9]\d*)$/.test(input.trim())) return {provider:'bilibili',url:input.trim()}
  for (const raw of input.match(/https?:\/\/[^\s<>"']+/g) || []) {
    try {
      const u = new URL(raw.replace(/[，。；）)]+$/, ''))
      if (u.username || u.password || u.port) continue
      if (['mgtv.com','www.mgtv.com','m.mgtv.com'].includes(u.hostname)) return {provider:'mgtv',url:u.href}
      if (['bilibili.com','www.bilibili.com','m.bilibili.com','b23.tv'].includes(u.hostname)) return {provider:'bilibili',url:u.href}
      if (['miguvideo.com','www.miguvideo.com','m.miguvideo.com'].includes(u.hostname)) return {provider:'migu',url:u.href}
    } catch { /* Ignore unrelated pasted text. */ }
  }
}

export async function webVideoDetail(invoke: Invoke, provider: WebVideoProvider, id: string): Promise<Obj> {
  const input = id.startsWith('http') ? {url:id} : {id}
  const data = await invoke(provider,'detail',{...input,pageSize:100,...(provider === 'migu' ? miguCapabilities(id) : {})})
  if (provider === 'migu' && !id.startsWith('tv:') && data.episodesComplete !== true) throw new Error('咪咕分集列表不完整，请稍后重试')
  if (provider === 'mgtv') {
    let all = rows(data.episodes), next = str(data.nextCursor), more = data.hasMore === true
    const visited = new Set<string>()
    while (more) {
      if (!next || visited.has(next) || visited.size >= 100) throw new Error('芒果分集分页未完整，请重新读取')
      visited.add(next)
      const page = await invoke(provider,'detail',{...input,pageSize:100,cursor:next})
      if (str(page.id) !== str(data.id)) throw new Error('芒果作品分页身份发生变化')
      const known = new Set(all.map(e => str(e.vid || e.id)))
      const fresh = rows(page.episodes).filter(e => !known.has(str(e.vid || e.id)))
      if (!fresh.length && page.hasMore === true) throw new Error('芒果分集分页重复，请重新读取')
      all = [...all,...fresh];more = page.hasMore === true;next = str(page.nextCursor)
    }
    data.episodes = all.map(e => ({...e,group:e.isIntact === false ? '其他视频' : '正片'}))
    data.episode_groups = [...new Set(rows(data.episodes).map(e => e.group))]
    data.hasMore = false;data.nextCursor = ''
    const direct = /^(?:vid:)?\d+$/.test(id) || /\/\d+\.html|[?&](?:videoId|vid)=/.test(id)
    if (direct) data.focusVid = str(data.vid)
  } else if (provider === 'bilibili') {
    const eps = rows(data.episodes)
    if (!data.focusVid && /ep\d+/.test(id)) data.focusVid = eps.find(e => str(e.id) === id.match(/ep\d+/)?.[0])?.id
    else if (!data.focusVid && /(?:BV[\da-zA-Z]{10}|av\d+)/.test(id)) {
      const p = Number(id.match(/[?&]p=(\d+)/)?.[1] || '1')
      data.focusVid = eps.find(e => Number(e.number) === p)?.id
    }
    data.desc = data.description
    const group = str(data.id).startsWith('ss') ? '正片' : '分 P'
    // A short UGC page titled “预告/clip” is still an explicit downloadable page.
    // Preserve the provider's page list rather than applying long-video heuristics.
    data.episodes = eps.map(ep=>({...ep,group}))
    data.episode_groups = [group]
  } else {
    data.desc=data.description
    data.episodes=rows(data.episodes).map(ep=>({...ep,group:'正片'}))
    data.episode_groups=['正片']
  }
  return data
}

export type WebTrack = { source: Obj; url: string; headers: Record<string,string>; type: string; quality: string; codec: string; family: string; group: string; separate: boolean; segment: number }
export function webTracks(data: Obj): WebTrack[] {
  return rows(data.media).map(m => {
    const meta = isObj(m.meta) ? m.meta : {}
    const row = {...meta,...m}
    const url = str(row.url)
    const u = new URL(url)
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error('源站媒体地址无效')
    if (row.drm === true || (typeof row.drm === 'string' && !['','none','0'].includes(row.drm)) || (isObj(row.drm) && Object.keys(row.drm).length && row.drm.clear !== true && row.drm.system !== 'none')) throw new Error('该媒体受保护，当前客户端不支持此授权下载')
    const headers: Record<string,string> = {}
    if (isObj(row.headers)) for (const [k,v] of Object.entries(row.headers)) {
      if (typeof v === 'string' && !/[\r\n]/.test(k+v) && !/^(authorization|cookie)$/i.test(k)) headers[k] = v
    }
    return {source:row,url,headers,type:str(row.type)||'video',quality:str(row.quality),codec:str(row.codec),family:str(row.codecFamily),group:str(row.group),separate:row.separate === true,segment:num(row.segment)}
  })
}
export function videoChoice(t: WebTrack): string { return t.family && t.family !== 'unknown' ? [t.quality,t.family].join('|') : [t.quality,t.family,t.codec].join('|') }
export function audioChoice(t: WebTrack): string { return [t.quality,t.family,t.codec,t.group].join('|') }
export function bilibiliOptions(data: Obj): {qualities:Quality[];audios:Audio[]} {
  const tracks = webTracks(data), audios: Audio[] = [], qualities: Quality[] = []
  for (const t of tracks.filter(t => t.type === 'audio')) {
    const id = audioChoice(t)
    if (audios.some(a => a.id === id)) continue
    audios.push({id,label:str(t.source.label)||str(t.source.qualityLabel)||t.quality,codec:t.codec,lang:'原声',selected:false,isDefault:false})
  }
  const preferred = audios.find(a => /flac/i.test(a.codec)) || audios.find(a => /ec-3|eac3/i.test(a.codec)) || audios[0]
  if (preferred) {preferred.isDefault = true;preferred.selected = true}
  for (const t of tracks.filter(t => t.type === 'video')) {
    const id = videoChoice(t)
    if (qualities.some(q => q.id === id)) continue
    const range = str(t.source.dynamicRange)
    qualities.push({id,stream:id,label:str(t.source.qualityLabel)||t.quality,title:str(t.source.label),size:num(t.source.size)||num(t.source.estimatedSize),width:num(t.source.width),height:num(t.source.height),codec:t.codec,drm:'none',fps:num(t.source.fps),hdr:range === 'Dolby Vision' ? 'dolbyvision' : range.toLowerCase(),audios:t.separate ? audios : [{id:'embedded',label:'随视频内嵌',lang:'原声',codec:'',isDefault:true,selected:true,embedded:true}],tier:num(t.source.height)})
  }
  qualities.sort((a,b) => b.width-a.width || b.height-a.height || (b.fps||0)-(a.fps||0))
  if (!qualities.length) throw new Error('B 站未返回可下载画质')
  return {qualities,audios}
}
export function mgtvOptions(data: Obj): {qualities:Quality[];audios:Audio[]} {
  const qualities = rows(data.qualities).filter(q => q.selectable === true).map((q): Quality => ({id:str(q.quality),stream:str(q.quality),label:str(q.name)||str(q.standardName)||str(q.quality),title:'目录规格；实际编码和动态范围在下载后确认',size:0,width:0,height:0,tier:num(q.nominalHeight),codec:str(q.catalogCodec),drm:'unknown',fps:num(q.frameRate),hdr:'unknown',audios:[{id:'embedded',label:'随视频内嵌',lang:'原声',codec:'',isDefault:true,selected:true,embedded:true}]}))
  if (!qualities.length) throw new Error('芒果当前设备和片源没有可选画质')
  return {qualities,audios:[]}
}
export async function probeWebVideo(invoke: Invoke, provider: WebVideoProvider, id: string) {
  if (provider === 'migu') return miguOptions(await invoke(provider,'qualities',{id,...miguCapabilities(id)}))
  return provider === 'mgtv' ? mgtvOptions(await invoke(provider,'qualities',{vid:id,...mgtvCapabilities})) : bilibiliOptions(await invoke(provider,'resolve',{id}))
}
export function miguCapabilities(id: string) { return {terminal:id.startsWith('tv:') ? 'tv' : 'unified',devicePreset:'max'} }
export function miguOptions(data: Obj): {qualities:Quality[];audios:Audio[]} {
  const qualities = rows(data.qualityOptions).filter(q=>q.available === true).map((q):Quality=>({
    id:str(q.id),stream:str(q.id),label:str(q.label)||str(q.id),
    title:[str(q.rateTypeDesc),num(q.width)&&num(q.height) ? `${num(q.width)}×${num(q.height)}` : '源站画质'].filter(Boolean).join(' · '),
    size:num(q.size),width:num(q.width),height:num(q.height),tier:num(q.height),codec:str(q.codec),drm:'none',
    hdr:q.hdrType === 'CUVAHDR' ? 'vivid' : str(q.hdrType).toLowerCase(),
    audios:[{id:'embedded',label:'随视频内嵌',lang:'原声',codec:'',isDefault:true,selected:true,embedded:true}],
  }))
  qualities.sort((a,b)=>(b.id === str(data.recommendedQuality) ? 1 : 0)-(a.id === str(data.recommendedQuality) ? 1 : 0)||b.width*b.height-a.width*a.height)
  if (!qualities.length) throw new Error('咪咕没有完整且可下载的画质，请检查登录和账号权益')
  return {qualities,audios:[]}
}
export function selectedBilibiliMedia(data: Obj, choice: string, audioIds: string[]) {
  const tracks = webTracks(data)
  if (data.isPreview === true || data.preview === true || Number(data.preview) === 1) throw new Error('当前返回试看片段，请登录或选择可播放的完整内容')
  const videos = tracks.filter(t => t.type === 'video' && videoChoice(t) === choice)
  if (!videos.length) throw new Error('所选 B 站画质或编码已不可用，请重新选择')
  if (!videos[0]!.separate) {
    const count = num(videos[0]!.source.segmentCount)
    if (!count || videos.length !== count || new Set(videos.map(t => t.segment)).size !== count || videos.some(t=>!Number.isInteger(t.segment) || t.segment<1 || t.segment>count)) throw new Error('B 站分段流不完整')
    return {videos:videos.sort((a,b)=>a.segment-b.segment),audios:[] as WebTrack[]}
  }
  const audios = audioIds.map(id => {
    const track = tracks.find(t => t.type === 'audio' && audioChoice(t) === id)
    if (!track) throw new Error('所选 B 站音轨已不可用，请重新选择')
    return track
  })
  if (!audios.length) throw new Error('请至少选择一条 B 站音轨')
  return {videos:[videos[0]!],audios}
}
