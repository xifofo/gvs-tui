import { createServer } from 'node:http'
import { GwClient } from './client.ts'
import { defaultConfig } from './config.ts'
import { probeOptions } from './quality.ts'
import { expect, test } from 'bun:test'
import { assertYoukuPlayback, assertYoukuDuration, assertYoukuCompletedMedia, YoukuPlaybackError } from './youku-playback.ts'
import { userMessage } from './user-message.ts'

test('explicit expiry overrides playable/VIP and does not trust stale credentials', () => {
  for (const flags of [{ needs_relogin: true }, { logged_in: false }, { session: { needs_relogin: true } }, { summary: { logged_in: false } }]) {
    try { assertYoukuPlayback({ can_play:true, is_vip:true, ...flags }); throw new Error('expected rejection') }
    catch (e) { expect(e).toBeInstanceOf(YoukuPlaybackError); expect((e as YoukuPlaybackError).errorCode).toBe('RELOGIN_REQUIRED'); expect(userMessage(e)).toContain('重新登录') }
  }
})

test('HTTP success with a 4K DV catalogue is still rejected when playback is preview only', () => {
  for (const flags of [{quality_gate:{has_trial:true}}, {has_trial:true}, {trial:{time:360}}]) {
    expect(() => assertYoukuPlayback({ can_play:true,is_vip:true,video:{stream_type:'cmfv5hd4_dolbyvision_hfr_hbr_hq'},...flags })).toThrow('试看')
  }
  expect(() => assertYoukuPlayback({can_play:true,is_vip:true,trial:{time:0}})).not.toThrow()
  // Expired web membership query does not prove the independent App playback session expired.
  expect(() => assertYoukuPlayback({profile:{ret:['FAIL_SYS_SESSION_EXPIRED']}})).not.toThrow()
})

test('actual EP06 evidence: 368.484 seconds is incomplete against 3093 seconds', () => {
  expect(() => assertYoukuCompletedMedia({status:'probed',durationSeconds:368.484,dynamicRange:'DV',width:3840,height:2160},3093)).toThrow('不完整')
  expect(() => assertYoukuDuration(3090,3093)).not.toThrow()
  expect(() => assertYoukuDuration(1,1)).not.toThrow()
  expect(() => assertYoukuDuration(undefined,3093)).toThrow('无法确认')
  expect(() => assertYoukuDuration(0,3093)).toThrow('无法确认')
  expect(() => assertYoukuDuration(368.484,0)).not.toThrow()
})

for (const scenario of [
  { name:'signed-out success envelope', flags:{needs_relogin:true}, message:'重新扫码' },
  { name:'preview success envelope', flags:{quality_gate:{has_trial:true}}, message:'试看' },
]) {
  test(`local HTTP gateway ${scenario.name} cannot become a downloadable DV catalogue`, async () => {
    let requests=0
    const server=createServer(async (req,res) => {
      requests++
      const body=[]
      for await (const chunk of req) body.push(chunk)
      const input=JSON.parse(Buffer.concat(body).toString())
      expect(input.provider).toBe('youku')
      expect(input.action).toBe('play')
      res.setHeader('Content-Type','application/json')
      res.end(JSON.stringify({code:0,msg:'SUCCESS',data:{can_play:true,is_vip:true,
        streams:[{stream_type:'cmfv5hd4_dolbyvision_hfr_hbr_hq',source:'frame_xiang',media_type:'video',playlist_url:'https://unused.invalid/video.m3u8'}],
        ...scenario.flags}}))
    })
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    try {
      const cfg={...defaultConfig(),host:`http://127.0.0.1:${(server.address() as {port:number}).port}`,key:'synthetic-local-login-fixture'}
      const cli=new GwClient(cfg.host,cfg.key,()=>cfg)
      await expect(probeOptions(cli,cfg,'youku','synthetic-ep06')).rejects.toThrow(scenario.message)
      expect(requests).toBe(1)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve=>server.close(()=>resolve()))
    }
  })
}
