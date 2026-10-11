import { expect, test } from 'bun:test'
import { ProviderSessions } from './provider-session'
import { webVideoLink, webVideoDetail, probeWebVideo, miguOptions } from './web-video-providers'
import { needsTunnel } from './tunnel-policy'
import { sourceTag } from './name'
import { usesMeasuredNaming } from './completed-naming'

test('Migu links, TV namespaces and required tunnel',()=>{
  expect(webVideoLink('https://m.miguvideo.com/mgs/msite/prd/detail.html?cid=968181177')?.provider).toBe('migu')
  expect(webVideoLink('tv:968181178')).toEqual({provider:'migu',url:'tv:968181178'})
  expect(webVideoLink('https://miguvideo.com.evil.invalid/?cid=968181177')).toBeUndefined()
  expect(needsTunnel(p=>p==='migu')).toBe(true)
  expect(sourceTag('migu')).toBe('MIGU')
  expect(usesMeasuredNaming({provider:'migu',namingVersion:1})).toBe(true)
})

test('Migu preserves verified resolution and blocks protected catalog entries',async()=>{
  const fixture={recommendedQuality:'5',qualityOptions:[
    {id:'7',label:'原画 HDR',width:1920,height:800,hdrType:'CUVAHDR',available:false,unavailableReason:'protected_stream'},
    {id:'3',label:'720P',width:1728,height:720,available:true},
    {id:'5',label:'极清 2K',rateTypeDesc:'HDRVivid',width:2560,height:1066,hdrType:'CUVAHDR',available:true},
  ]}
  const choices=miguOptions(fixture)
  expect(choices.qualities.map(q=>q.id)).toEqual(['5','3'])
  expect(choices.qualities[0]).toMatchObject({width:2560,height:1066,hdr:'vivid'})
  const calls:unknown[]=[]
  await probeWebVideo(async(p,a,input)=>{calls.push({p,a,input});return fixture},'migu','968181177')
  await probeWebVideo(async(p,a,input)=>{calls.push({p,a,input});return fixture},'migu','tv:968181178')
  expect(calls).toEqual([
    {p:'migu',a:'qualities',input:{id:'968181177',terminal:'unified',devicePreset:'max'}},
    {p:'migu',a:'qualities',input:{id:'tv:968181178',terminal:'tv',devicePreset:'max'}},
  ])
})

test('Migu refuses incomplete episodes and retains App focus episode',async()=>{
  const fixture={id:'968082110',focusVid:'968181177',episodesComplete:true,episodes:[{id:'968181177',number:1}]}
  const data=await webVideoDetail(async(_p,_a,input)=>{expect(input.terminal).toBe('unified');return fixture},'migu','968181177')
  expect(data.focusVid).toBe('968181177');expect(data.episode_groups).toEqual(['正片'])
  await expect(webVideoDetail(async()=>({...fixture,episodesComplete:false}),'migu','968181177')).rejects.toThrow('不完整')
  const tv=await webVideoDetail(async(_p,_a,input)=>{expect(input.terminal).toBe('tv');return {id:'tv:968181178',episodesComplete:false,episodesScope:'requested-episode',episodes:[{id:'tv:968181178',number:1}]}},'migu','tv:968181178')
  expect(tv.episodesComplete).toBe(false);expect((tv.episodes as unknown[]).length).toBe(1)
})

test('Migu QR polling has terminal binding, throttle and connection-scope isolation',async()=>{
  let now=100000;const calls:Record<string,unknown>[]=[]
  const sessions=new ProviderSessions(async(_p,_a,input)=>{
    calls.push(input)
    if(input.op==='start')return {state:'pending',loginId:'flow',qrCodeUrl:'https://passport.migu.cn/qrc/official?sessionid=abc',qrCodeDataUrl:'data:image/png;base64,AA==',expiresAt:300,pollIntervalMs:3000,token:'PRIVATE'}
    return {state:'authenticated',loggedIn:true,userToken:'PRIVATE'}
  },()=>now)
  const view=await sessions.command({provider:'migu',op:'start',terminal:'tv'})
  expect(view.url).toContain('passport.migu.cn');expect(JSON.stringify(view)).not.toContain('PRIVATE')
  await sessions.command({provider:'migu',op:'poll',terminal:'tv'});expect(calls.length).toBe(1)
  now+=3100
  expect((await sessions.command({provider:'migu',op:'poll',terminal:'tv'})).authenticated).toBe(true)
  expect(calls[1]).toMatchObject({terminal:'tv',loginId:'flow'})
  await sessions.command({provider:'migu',op:'start',terminal:'mobile'})
  sessions.setScope('different-key')
  await expect(sessions.command({provider:'migu',op:'poll',terminal:'mobile'})).rejects.toThrow('过期')
})

test('Migu QR rejects offsite authorization URLs',async()=>{
  const sessions=new ProviderSessions(async()=>({state:'pending',loginId:'flow',qrCodeUrl:'https://evil.invalid/qrc/test',qrCodeDataUrl:'data:image/png;base64,AA==',expiresAt:Date.now()/1000+300}))
  await expect(sessions.command({provider:'migu',op:'start'})).rejects.toThrow('无效')
})

test('Migu default scan links both sources and merged choices keep terminal identity',async()=>{
  const sent:Record<string,unknown>[]=[]
  const sessions=new ProviderSessions(async(_p,_a,input)=>{sent.push(input);return {authenticated:true,mobileAuthenticated:true,tvAuthenticated:true}})
  const view=await sessions.command({provider:'migu',op:'status'})
  expect(sent[0]?.terminal).toBe('unified');expect(view.summary).toContain('已合并')
  const result=miguOptions({recommendedQuality:'tv:8',qualityOptions:[{id:'mobile:5',label:'App · 2K HDR Vivid',width:2560,height:1066,hdrType:'CUVAHDR',available:true},{id:'tv:8',label:'TV · 4K',width:3840,height:2160,available:true}]})
  expect(result.qualities.map(q=>q.id)).toEqual(['tv:8','mobile:5'])
})
