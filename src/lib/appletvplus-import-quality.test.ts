import { expect, test } from 'bun:test'
import { ProviderSessions } from './provider-session'
import { probeOptions } from './quality'
import { appleTVImportCookie } from './appletvplus-auth'
import type { GwClient } from './client'
import type { FileConfig } from './config'

const token = '0.' + 'A'.repeat(60) + '=='
test('bare media token becomes a transient region-bound Cookie, full Cookie remains intact', async () => {
  expect(appleTVImportCookie(token, 'hk')).toBe(`itua=HK; media-user-token=${token}`)
  expect(appleTVImportCookie(token, 'us')).toContain('itua=US')
  expect(() => appleTVImportCookie(token)).toThrow('请选择')
  expect(() => appleTVImportCookie(token, 'invalid')).toThrow('请选择')
  const cookie = 'itua=JP; media-user-token=fixture'
  expect(appleTVImportCookie(cookie, 'hk')).toBe(cookie)
  const sessions = new ProviderSessions(async (p,a,input) => {
    expect(p).toBe('appletvplus'); expect(a).toBe('login')
    expect(input.cookie).toBe(`itua=HK; media-user-token=${token}`)
    return {state:'imported',authenticated:false,summary:'已导入'}
  })
  expect((await sessions.command({provider:'appletvplus',op:'import',cookie:token,country:'hk'})).state).toBe('imported')
})

test('public quality dispatcher reaches Apple TV probe and never asks for download keys', async () => {
  const cli = {invoke: async (p:string,a:string,input:Record<string,unknown>) => {
    expect(p).toBe('appletvplus');expect(a).toBe('probe');expect(input.id).toBe('umc.cmc.episode');expect(input.download).toBeUndefined()
    return {qualities:[{id:'1606|H265|PQ|23.976',label:'4K HDR',width:3840,height:1606,codec:'H265',hdr:'PQ',fps:'23.976'}]}
  }} as unknown as GwClient
  const result = await probeOptions(cli, {} as FileConfig, 'appletvplus', 'umc.cmc.episode')
  expect(result.qualities[0]).toMatchObject({id:'1606|H265|PQ|23.976',codec:'H265',height:1606,title:'4K HDR'})
  expect(result.qualities[0]?.title).not.toContain('PlayReady')
})
