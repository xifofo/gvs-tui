import { expect, test } from 'bun:test'
import { iqOptions, iqPlan, normalizeIQCookie } from './iq.ts'
import { extractIQLink } from './link.ts'
import { hlsKeyArgs } from './media.ts'
import { PROVIDER_IDS, PROVIDER_LABELS } from './providers.ts'
import { needsTunnel } from './tunnel-policy.ts'

test('IQ overseas is a distinct provider and starts its scoped tunnel',()=>{
  expect(PROVIDER_IDS.includes('iq')).toBe(true)
  expect(PROVIDER_LABELS.iq).toBe('IQ 海外版')
  expect(needsTunnel(p=>p==='iq')).toBe(true)
})
test('IQ page matching does not accept domestic pages or lookalike hosts',()=>{
  expect(extractIQLink('分享：https://www.iq.com/album/27mstpb8t4t?lang=zh_cn。')).toBe('https://www.iq.com/album/27mstpb8t4t?lang=zh_cn')
  expect(extractIQLink('iq.com/play/1ewmjgipdkk')).toBe('https://iq.com/play/1ewmjgipdkk')
  for(const text of ['https://www.iqiyi.com/v_123.html','https://iq.com.evil.invalid/album/a','https://u:p@www.iq.com/album/a','https://www.iq.com/account']) expect(extractIQLink(text)).toBe('')
})
test('IQ metadata uses independent default Dolby, not embedded AAC',()=>{
  const result=iqOptions({formats:[{id:'tv:800:hevc',vid:'episode-one-rendition',label:'4K',width:3840,height:1608,codec:'hevc',drm:5}],audios:[{id:'1:1:500',label:'普通话 · 杜比 5.1',lang:'普通话',codec:'eac3',default:true},{id:'1:2:100',label:'普通话 · AAC',lang:'普通话',codec:'aac',default:false}]})
  expect(result.qualities[0]?.stream).toBe('tv:800:hevc')
  expect(result.audios[0]).toMatchObject({codec:'eac3',selected:true,isDefault:true,embedded:false})
  expect(result.audios[1]?.selected).toBe(false)
  expect(result.qualities[0]).toMatchObject({label:'4K',tier:2160,width:3840,height:1608})
})

test('IQ widescreen labels use the resolution tier while retaining actual pixel dimensions',()=>{
  const {qualities}=iqOptions({formats:[{id:'tv:800:hevc',label:'1608P',width:3840,height:1608},{id:'tv:600:hevc',label:'808P',width:1920,height:808}]})
  expect(qualities[0]).toMatchObject({label:'4K',width:3840,height:1608,tier:2160})
  expect(qualities[1]).toMatchObject({label:'1080P',width:1920,height:808,tier:1080})
})
test('IQ protected plans fail rather than use an absent or wrong-format key',()=>{
  const playlist='#EXTM3U\n#EXTINF:4,\nhttps://cdn.iq.com/first.ts\n#EXT-X-ENDLIST\n'
  expect(()=>iqPlan({video:{playlist},drm:{need_decrypt:true}})).toThrow('内容密钥')
  expect(()=>iqPlan({video:{playlist},drm:{content_key_hex:'00'.repeat(16),scheme:'unknown'}})).toThrow('未知解密算法')
  expect(()=>iqPlan({video:{playlist:playlist.replace('#EXT-X-ENDLIST','')},drm:{}})).toThrow('完整点播')
  expect(iqPlan({video:{playlist,vid:'rendition'},drm:{content_key_hex:'01'.repeat(16),scheme:'IQ_BBTS',need_decrypt:true}})).toMatchObject({rendition:'rendition'})
})
test('IQ method is native BBTS, not standard CBC or CENC',()=>{
  expect(hlsKeyArgs('01'.repeat(16),'IQ_BBTS')).toEqual(['--custom-hls-key','01'.repeat(16),'--custom-hls-method','IQ_BBTS','--custom-hls-scope','VIDEO'])
})
test('IQ Netscape cookie import preserves only the IQ domain',()=>{
  expect(normalizeIQCookie('#HttpOnly_.iq.com\tTRUE\t/\tTRUE\t0\tI00001\tOWN\n.evil.invalid\tTRUE\t/\tTRUE\t0\tsecret\tIGNORE')).toBe('I00001=OWN')
  expect(()=>normalizeIQCookie('a=b\r\nInjected: yes')).toThrow()
})
