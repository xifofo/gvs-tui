import { expect, test } from 'bun:test'
import { miguOptions, webVideoDetail } from './web-video-providers'

test('Migu protection is not reported as an expired login or missing membership', () => {
  expect(() => miguOptions({qualityOptions:[{id:'mobile:4',available:false,rightsGranted:true,unavailableReason:'protected_stream'},{id:'mobile:3',available:false,rightsGranted:true,unavailableReason:'protected_stream'}]})).toThrow('该媒体受保护')
  expect(() => miguOptions({qualityOptions:[{available:false,unavailableReason:'preview_only'}]})).toThrow('试看')
  expect(() => miguOptions({qualityOptions:[{available:false,rightsGranted:false}]})).toThrow('播放权益')
})

test('Migu TV catalog episodes preserve their terminal namespace', async () => {
  const d=await webVideoDetail(async()=>({id:'tv-series:968082109',title:'伟大的长征',episodesComplete:true,episodes:[{id:'tv:968181178',vid:'tv:968181178',number:1,title:'第01集'}],extras:[{id:'tv:968285588',title:'预告'}]}),'migu','tv-series:968082109')
  expect(d.episodes).toEqual([{id:'tv:968181178',vid:'tv:968181178',number:1,title:'第01集',group:'正片'}])
})
