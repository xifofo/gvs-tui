import { describe, expect, test } from 'bun:test'
import { ProviderSessions } from './provider-session.ts'
import { summarizeInput } from './runlog.ts'

describe('shared client provider sessions', () => {
  test('IQ retains Web and TV verification separately and transmits password transiently', async () => {
    let sent: Record<string, unknown> = {}
    const s = new ProviderSessions(async (p, _a, input) => { expect(p).toBe('iq'); sent = input; return { state:'tv_ready', authenticated:true, webAuthenticated:true, tvAuthenticated:true, summary:'Web 和 TV 已完成', cookie:'PRIVATE_COOKIE' } })
    const view = await s.command({provider:'iq',op:'password',username:'example@example.invalid',password:'  PRIVATE_PASSWORD  '})
    expect(sent.password).toBe('  PRIVATE_PASSWORD  ')
    expect(view.authenticated).toBe(true); expect(view.webAuthenticated).toBe(true); expect(view.tvAuthenticated).toBe(true)
    expect(JSON.stringify(view)).not.toContain('PRIVATE_')
    expect(summarizeInput(sent)).not.toContain('example@example.invalid'); expect(summarizeInput(sent)).not.toContain('PRIVATE_PASSWORD')
  })
  test('IQ Web authentication alone does not imply a ready TV download session', async () => {
    const s = new ProviderSessions(async () => ({state:'web_ready', authenticated:true, webAuthenticated:true,tvAuthenticated:false}))
    expect((await s.command({provider:'iq',op:'status'})).authenticated).toBe(false)
  })
  test('mewatch respects poll interval and exposes no opaque tokens', async () => {
    let time=1000; const calls: unknown[]=[]
    const s = new ProviderSessions(async (_p,_a,input) => {calls.push(input);return input.op === 'start' ? {status:'pending',userCode:'ABCD',verificationUri:'https://example.test/activate',expiresIn:600,interval:5,device_code:'PRIVATE'} : {status:'authorized',access_token:'PRIVATE'}},() => time)
    const v=await s.command({provider:'mewatch',op:'start'}); expect(JSON.stringify(v)).not.toContain('PRIVATE')
    await s.command({provider:'mewatch',op:'poll'});expect(calls).toHaveLength(1)
    time+=5000;expect((await s.command({provider:'mewatch',op:'poll'})).authenticated).toBe(true)
  })
  test('SMS requires flow and explicit confirmation, preserves leading zeros', async () => {
    const calls: Record<string,unknown>[]=[]
    const s=new ProviderSessions(async (_p,_a,input) => {calls.push(input);return input.op === 'web_start' ? {flowId:'SECRET_FLOW',state:'ready'} : input.op === 'web_verify' ? {authenticated:true,state:'authenticated'} : {state:'code_pending',resendAfterSeconds:60}})
    await expect(s.command({provider:'hamivideo',op:'web_verify',code:'001234'})).rejects.toThrow('过期')
    await s.command({provider:'hamivideo',op:'web_start'})
    await expect(s.command({provider:'hamivideo',op:'web_send_code',phone:'0912345678'})).rejects.toThrow('确认')
    await s.command({provider:'hamivideo',op:'web_send_code',phone:'0912345678',confirm:true})
    await expect(s.command({provider:'hamivideo',op:'web_send_code',phone:'0912345678',confirm:true})).rejects.toThrow('冷却')
    const v=await s.command({provider:'hamivideo',op:'web_verify',code:'001234'})
    expect(calls.at(-1)!.code).toBe('001234');expect(v.authenticated).toBe(true);expect(JSON.stringify(v)).not.toContain('SECRET_FLOW')
  })
  test('switching gateway/key destroys old Web flow', async () => {
    const s=new ProviderSessions(async () => ({flowId:'old'}));s.setScope('one')
    await s.command({provider:'hamivideo',op:'web_start'});s.setScope('two')
    await expect(s.command({provider:'hamivideo',op:'web_verify',code:'123456'})).rejects.toThrow('过期')
  })
  test('TV import is not falsely reported as remotely authenticated', async () => {
    const s=new ProviderSessions(async () => ({imported:true,tokenValidLocally:true,cookie:'PRIVATE'}))
    const v=await s.command({provider:'hamivideo',op:'import',cookie:'PRIVATE'})
    expect(v.authenticated).toBe(false);expect(v.state).toBe('imported');expect(JSON.stringify(v)).not.toContain('PRIVATE')
  })
  test('same-provider commands are serialized', async () => {
    let done!:(v:Record<string,unknown>)=>void;const s=new ProviderSessions(() => new Promise(resolve => {done=resolve}))
    const first=s.command({provider:'mewatch',op:'status'})
    await expect(s.command({provider:'mewatch',op:'start'})).rejects.toThrow('进行中');done({loggedIn:true});await first
  })
  test('phone OTP flow and license inputs are redacted', () => {
    const log=summarizeInput({op:'web_verify',phone:'0912345678',code:'001234',pin:'9999',flowId:'SECRET_FLOW',challenge:'SECRET_CHALLENGE',license:'SECRET_LICENSE',cookie:'SECRET_COOKIE',report_binding:'SECRET_BINDING'})
    for(const secret of ['0912345678','001234','9999','SECRET_'])expect(log).not.toContain(secret)
    expect(log).toContain('web_verify')
  })
})
