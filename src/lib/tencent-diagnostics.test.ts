import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tencentRisk, TencentRiskStop } from './tencent-risk.ts'
import { readTencentDiagnostics, writeTencentDiagnostic, tencentDiagnosticJobID } from './tencent-diagnostics.ts'
import { TencentOperations } from './tencent-operations.ts'
import { retryCdnRefresh } from './cdn-retry.ts'

describe('Tencent diagnostic boundaries', () => {
  test('account diagnostics accept omitted or legacy null job IDs while rejecting malformed tasks', () => {
    expect(tencentDiagnosticJobID(undefined)).toBeUndefined()
    expect(tencentDiagnosticJobID(null)).toBeUndefined()
    expect(tencentDiagnosticJobID(7)).toBe(7)
    for (const value of ['', '7', 0, -1, 0.5, NaN, Infinity, {}, []]) {
      expect(() => tencentDiagnosticJobID(value)).toThrow('无效腾讯任务')
    }
  })
  test('nested codes, HTTP rejection and stale binding stop current flow', () => {
    expect(tencentRisk({raw:{em:93}}).stop).toBe(true)
    expect(tencentRisk({em:'94.1'}).stop).toBe(true)
    expect(tencentRisk(undefined,Object.assign(new Error('rejected'),{httpStatus:429})).stop).toBe(true)
    expect(tencentRisk(undefined,new Error('report_binding_stale_session')).decision).toBe('reauth_required')
  })
  test('HTTP success and local observations never claim collector acceptance', () => {
    expect(tencentRisk({status:'unverified_response',http_status:200,acknowledged:false}).decision).toBe('not_acceptance_proof')
    expect(tencentRisk({status:'observed_locally',sent:false}).decision).toBe('local_only')
    expect(tencentRisk({delivery_unknown:true}).decision).toBe('no_automatic_resend')
  })
  test('risk rejection containing 403 does not trigger five CDN refreshes', async () => {
    let calls=0, waits=0
    await expect(retryCdnRefresh(async () => {calls++;throw new TencentRiskStop({stop:true,status:'rejected',decision:'stop_flow',httpStatus:403})},undefined,async () => {waits++})).rejects.toThrow('停止')
    expect(calls).toBe(1);expect(waits).toBe(0)
  })
  test('diagnostic files are account-scoped, bounded and do not retain extra secrets', () => {
    const old=process.env.GVS_TENCENT_DIAGNOSTICS_PATH
    const file=join(mkdtempSync(join(tmpdir(),'gvs-diag-')),'events.jsonl');process.env.GVS_TENCENT_DIAGNOSTICS_PATH=file
    try {
      const event={flow:'flow-1',operation:'op-1',job:'7',action:'play',phase:'decision',status:'risk_rejected',decision:'stop_flow',code:'93',cookie:'SECRET_COOKIE',binding:'SECRET_BINDING'}
      writeTencentDiagnostic('PRIVATE_KEY_A',event);writeTencentDiagnostic('PRIVATE_KEY_B',{...event,job:'8'})
      appendFileSync(file, 'invalid-json'+String.fromCharCode(10))
      expect(readTencentDiagnostics('PRIVATE_KEY_A','7')).toHaveLength(1)
      expect(readTencentDiagnostics('PRIVATE_KEY_A','8')).toHaveLength(0)
      expect(readTencentDiagnostics('PRIVATE_KEY_C')).toHaveLength(0)
      const stored=readFileSync(file,'utf8');expect(stored).not.toContain('PRIVATE_KEY');expect(stored).not.toContain('SECRET_')
      expect(JSON.stringify(readTencentDiagnostics('PRIVATE_KEY_A'))).not.toContain('scope')
    } finally { if(old===undefined)delete process.env.GVS_TENCENT_DIAGNOSTICS_PATH;else process.env.GVS_TENCENT_DIAGNOSTICS_PATH=old }
  })
  test('Electron never mislabels local measurements as TUI observations', async () => {
    const calls:Record<string,unknown>[]=[];const logs:string[]=[]
    const tracker=new TencentOperations(async input => {calls.push(input);return {binding:'opaque'}},line=>logs.push(line),'',undefined,'','electron_process')
    const op=await tracker.begin('play',{vid:'episode1'});await tracker.finish(op,{em:0});tracker.observeTransfer(12,24);await tracker.closeTransfer()
    expect(calls.filter(c=>c.report_type==='bind')).toHaveLength(1)
    expect(calls.filter(c=>c.report_type==='observe')).toHaveLength(0)
    expect(logs.join(' ')).toContain('local_only_gateway_source_unsupported')
    expect(logs.join(' ')).not.toContain('opaque')
  })
  test('Electron sends measured events only after the gateway advertises source support', async () => {
    const calls: Record<string, unknown>[] = []
    const tracker = new TencentOperations(async input => {
      calls.push(input)
      return input.report_type === 'bind'
        ? { binding: 'opaque', observation_sources: ['tui_process', 'electron_process'] }
        : { status: 'observed_locally', sent: false }
    }, () => {}, 'job-1', undefined, '', 'electron_process')
    const op = await tracker.begin('play', { vid: 'episode1' })
    await tracker.finish(op, { em: 0 })
    tracker.observeTransfer(0.5, 1)
    await tracker.closeTransfer()
    const events = calls.filter(c => c.report_type === 'observe').map(c => JSON.parse(String(c.payload)))
    expect(events.map(e => e.phase)).toEqual(['start', 'finish', 'finish'])
    expect(events.every(e => e.source === 'electron_process')).toBe(true)
    expect(events.every(e => e.metrics.rss_bytes > 0)).toBe(true)
    expect(events.some(e => 'downloaded_bytes' in e.metrics)).toBe(false)
    expect(calls.some(c => ['bosskv', 'getfeature'].includes(String(c.report_type)))).toBe(false)
  })
  test('forked Electron downloads retain advertised capabilities and stop after rejection', async () => {
    const calls: Record<string, unknown>[] = []
    const parent = new TencentOperations(async input => {
      calls.push(input)
      return input.report_type === 'bind' ? { binding: 'opaque', observation_sources: ['electron_process'] } : { status: 'observed_locally' }
    }, () => {}, '', undefined, '', 'electron_process')
    const detail = await parent.begin('detail', { cid: 'series' })
    await parent.finish(detail, { episodes: [{ vid: 'episode1' }] })
    const child = parent.fork('job-2', 'episode1')
    const play = await child.begin('play', { vid: 'episode1' })
    const before = calls.length
    await child.finish(play, { em: 93 })
    child.observeTransfer(100, 200)
    await child.closeTransfer()
    await expect(child.begin('play', { vid: 'episode1' })).rejects.toThrow('stopped')
    expect(calls).toHaveLength(before)
    expect(calls.filter(c => c.report_type === 'bind')).toHaveLength(1)
    const events = calls.filter(c => c.report_type === 'observe').map(c => JSON.parse(String(c.payload)))
    expect(events.at(-1).job_id).toBe('job-2')
    expect(events.at(-1).source).toBe('electron_process')
  })
  test('risk results stop pending operations without further observer requests', async () => {
    const calls:unknown[]=[];const tracker=new TencentOperations(async input=>{calls.push(input);return input.report_type==='bind'?{binding:'opaque'}:{status:'observed_locally'}},()=>{})
    const op=await tracker.begin('play',{vid:'v'});const before=calls.length
    await tracker.finish(op,{raw:{em:94}})
    await expect(tracker.begin('play',{vid:'v'})).rejects.toThrow('stopped')
    expect(calls).toHaveLength(before)
  })
})
