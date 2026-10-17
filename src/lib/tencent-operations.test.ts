import { describe, expect, test } from 'bun:test'
import { TencentOperations } from './tencent-operations.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTencentDiagnostics } from './tencent-diagnostics.ts'

describe('Tencent local operation observations', () => {
  function setup() {
    const calls: Record<string, unknown>[] = []
    const logs: string[] = []
    const tracker = new TencentOperations(async input => {
      calls.push(input)
      return input.report_type === 'bind' ? { binding: 'opaque-test-binding' } : { status: 'observed_locally' }
    }, line => logs.push(line))
    return { tracker, calls, logs }
  }

  test('search detail and play share a flow without logging search text', async () => {
    const { tracker, calls, logs } = setup()
    const search = await tracker.begin('search', { q: 'PRIVATE SEARCH TEXT' })
    await tracker.finish(search, { list: [] })
    const detail = await tracker.begin('detail', { cid: 'cover1' })
    await tracker.finish(detail, { cid: 'cover1', episodes: [{ vid: 'episode1' }] })
    const play = await tracker.begin('play', { vid: 'episode1' })
    const bound = tracker.boundInput(play, { vid: 'episode1' })
    expect(bound.report_binding).toBe('opaque-test-binding')
    await tracker.finish(play, { has_url: true, em: 0 })
    const events = calls.filter(c => c.report_type === 'observe').map(c => JSON.parse(String(c.payload)))
    expect(new Set(events.map(e => e.flow_id)).size).toBe(1)
    expect(new Set(events.map(e => e.operation_id)).size).toBe(3)
    expect(calls.filter(c => c.report_type === 'bind')).toHaveLength(1)
    expect(JSON.stringify(calls)).not.toContain('PRIVATE SEARCH TEXT')
    expect(logs.join(' ')).not.toContain('opaque-test-binding')
    expect(events[0].source).toBe('tui_process')
    expect(events[0].metrics.rss_bytes).toBeGreaterThan(0)
    expect(events[0].metrics).not.toHaveProperty('played_time_mills')
  })

  test('queued job remains on old flow after another search', async () => {
    const { tracker, calls } = setup()
    const detail = await tracker.begin('detail', { cid: 'cover1' })
    await tracker.finish(detail, { episodes: [{ vid: 'episode1' }] })
    const child = tracker.fork('123', 'episode1')
    const later = await tracker.begin('search', { q: 'later' })
    await tracker.finish(later, {})
    const play = await child.begin('play', { vid: 'episode1' })
    await child.finish(play, { em: 0, has_url: true })
    child.observeTransfer(1024, 2048)
    await child.closeTransfer(true)
    const events = calls.filter(c => c.report_type === 'observe').map(c => JSON.parse(String(c.payload)))
    const job = events.filter(e => e.job_id === '123')
    expect(job.length).toBeGreaterThan(2)
    expect(job[0].flow_id).toBe(events[0].flow_id)
    expect(job.at(-1).phase).toBe('cancel')
    expect(job.some(e => e.metrics.downloaded_bytes === 1024)).toBe(true)
    expect(events.find(e => e.action === 'search').flow_id).not.toBe(job[0].flow_id)
  })

  test('rejection stops automatic requests within the same operation', async () => {
    const { tracker, calls } = setup()
    const play = await tracker.begin('play', { vid: 'episode1' })
    await tracker.finish(play, { em: 93, msg: '限制播放' })
    const count = calls.length
    await expect(tracker.begin('play', { vid: 'episode1' })).rejects.toThrow('stopped after rejection')
    expect(calls).toHaveLength(count)
  })

  test('download failure is not reported as success', async () => {
    const { tracker, calls } = setup()
    const play = await tracker.begin('play', { vid: 'episode1' })
    await tracker.finish(play, { has_url: true })
    await tracker.closeTransfer(false, true)
    const event = JSON.parse(String(calls.at(-1)?.payload))
    expect(event.action).toBe('download')
    expect(event.outcome).toBe('error')
  })

  test('a gateway without the report action keeps the search local and does not bind again', async () => {
    const calls: Record<string, unknown>[] = []
    const tracker = new TencentOperations(async () => {
      calls.push({ report_type: 'bind' })
      throw new Error('INVALID_PARAM: tencent action "report" (see capabilities)')
    }, () => {})
    const search = await tracker.begin('search', { q: '剧名' })
    expect(tracker.boundInput(search, { q: '剧名' })).toEqual({ q: '剧名' })
    await tracker.finish(search, { list: [] })
    await tracker.begin('detail', { cid: 'cover1' })
    expect(calls).toHaveLength(1)
  })

  test('unrelated actions never trigger binding or observations', async () => {
    const { tracker, calls } = setup()
    expect(await tracker.begin('account', {})).toBeUndefined()
    expect(calls).toHaveLength(0)
  })
})


test('temporary report binding failures remain local and retry on a new search', async () => {
  let binds = 0
  const tracker = new TencentOperations(async input => {
    if (input.report_type === 'bind') {
      if (++binds === 1) throw Object.assign(new Error('service unavailable'), { httpStatus: 503 })
      return { binding: 'recovered', observation_sources: ['tui_process'] }
    }
    return { status: 'observed_locally' }
  }, () => {})
  const first = await tracker.begin('detail', { cid: 'one' })
  expect(tracker.boundInput(first, { cid: 'one' })).toEqual({ cid: 'one' })
  await tracker.finish(first, {})
  const next = await tracker.begin('search', { q: 'next' })
  expect(tracker.boundInput(next, {}).report_binding).toBe('recovered')
  expect(binds).toBe(2)
})

for (const httpStatus of [401, 403, 429]) {
  test(`binding HTTP ${httpStatus} still stops the business flow`, async () => {
    let calls = 0
    const tracker = new TencentOperations(async () => {
      calls++
      throw Object.assign(new Error('rejected'), { httpStatus })
    }, () => {})
    await expect(tracker.begin('detail', { cid: 'one' })).rejects.toThrow('rejected')
    await expect(tracker.begin('play', { vid: 'one' })).rejects.toThrow('stopped after rejection')
    expect(calls).toBe(1)
  })
}


test('automatic profile summaries are recorded once per binding without leaking source fields', async () => {
  const previous = process.env.GVS_TENCENT_DIAGNOSTICS_PATH
  const dir = mkdtempSync(join(tmpdir(), 'tx-profile-summary-'))
  const file = join(dir, 'diagnostics.jsonl')
  process.env.GVS_TENCENT_DIAGNOSTICS_PATH = file
  try {
    const logs: string[] = []
    const tracker = new TencentOperations(async input => input.report_type === 'bind'
      ? { binding: 'PRIVATE_BINDING', observation_sources: ['electron_process'], adprofile: {
          generated: true, complete: false, status: 'generated', fields: ['guid'], values: { guid: 'PRIVATE_GUID' },
          qimei_registration: { generated: true, payload_generated: true, cipher_generated: true, pms: 'PRIVATE_WIRE', key: 'PRIVATE_KEY' },
        } }
      : { status: 'observed_locally' }, value => logs.push(value), '', undefined, 'private-fixture-scope', 'electron_process')
    const op = await tracker.begin('detail', { cid: 'fixture-cover' })
    await tracker.finish(op, {})
    await tracker.begin('play', { vid: 'fixture-episode' })
    const rows = readTencentDiagnostics('private-fixture-scope')
    expect(rows.filter(row => row.action === 'adprofile')).toHaveLength(1)
    expect(rows.find(row => row.action === 'adprofile')?.status).toBe('profile_generated_incomplete')
    expect(rows.find(row => row.action === 'qimei')?.decision).toBe('not_acceptance_proof')
    expect(readFileSync(file, 'utf8')).not.toContain('PRIVATE_')
    expect(logs.join(' ')).not.toContain('PRIVATE_')
  } finally {
    if (previous === undefined) delete process.env.GVS_TENCENT_DIAGNOSTICS_PATH
    else process.env.GVS_TENCENT_DIAGNOSTICS_PATH = previous
    rmSync(dir, { recursive: true, force: true })
  }
})


for (const scenario of [
  { name: 'complete encrypted request', registration: { generated: true, complete: true, payload_generated: true, cipher_generated: true, ready_to_send: true }, status: 'qimei_profile_prepared' },
  { name: 'complete fields without ciphertext', registration: { generated: true, complete: true, payload_generated: true, cipher_generated: false, ready_to_send: false }, status: 'qimei_profile_generated' },
  { name: 'incomplete fields despite ready flag', registration: { generated: true, complete: false, payload_generated: true, cipher_generated: true, ready_to_send: true }, status: 'qimei_profile_incomplete' },
  { name: 'missing ciphertext despite ready flag', registration: { generated: true, complete: true, payload_generated: true, ready_to_send: true }, status: 'qimei_profile_generated' },
  { name: 'unknown generation result despite complete flag', registration: { complete: true, payload_generated: true, cipher_generated: true, ready_to_send: true }, status: 'qimei_profile_unavailable' },
]) {
  test(`Qimei generation diagnostic distinguishes ${scenario.name}`, async () => {
    const previous = process.env.GVS_TENCENT_DIAGNOSTICS_PATH
    const dir = mkdtempSync(join(tmpdir(), 'tx-generation-coverage-'))
    const file = join(dir, 'diagnostics.jsonl')
    process.env.GVS_TENCENT_DIAGNOSTICS_PATH = file
    try {
      const tracker = new TencentOperations(async input => input.report_type === 'bind'
        ? { binding: 'opaque', adprofile: { generated: true, complete: true, qimei_registration: { ...scenario.registration, qimei36: 'PRIVATE_IDENTITY', params: 'PRIVATE_CIPHERTEXT' } } }
        : { status: 'observed_locally' }, () => {}, '', undefined, 'generation-coverage-scope')
      await tracker.begin('detail', { cid: 'cover1' })
      const row = readTencentDiagnostics('generation-coverage-scope').find(row => row.action === 'qimei')
      expect(row?.status).toBe(scenario.status)
      expect(row?.decision).toBe('not_acceptance_proof')
      expect(readFileSync(file, 'utf8')).not.toContain('PRIVATE_')
    } finally {
      if (previous === undefined) delete process.env.GVS_TENCENT_DIAGNOSTICS_PATH
      else process.env.GVS_TENCENT_DIAGNOSTICS_PATH = previous
      rmSync(dir, { recursive: true, force: true })
    }
  })
}


test('cached issued Qimei identity is not mislabeled as an incomplete profile', async () => {
  const previous = process.env.GVS_TENCENT_DIAGNOSTICS_PATH
  const dir = mkdtempSync(join(tmpdir(), 'tx-cached-profile-'))
  process.env.GVS_TENCENT_DIAGNOSTICS_PATH = join(dir, 'diagnostics.jsonl')
  try {
    const tracker = new TencentOperations(async input => input.report_type === 'bind'
      ? { binding: 'opaque', adprofile: { generated: true, complete: true, qimei_registration: { generated: true, status: 'identity_registered', identity_registered: true, acceptance_scope: 'qimei_identity_only', qimei36: 'PRIVATE_QIMEI' } } }
      : { status: 'observed_locally' }, () => {}, '', undefined, 'cached-profile-scope')
    await tracker.begin('detail', { cid: 'cover1' })
    const rows = readTencentDiagnostics('cached-profile-scope')
    expect(rows.find(row => row.action === 'qimei')?.status).toBe('qimei_identity_registered')
    expect(rows.find(row => row.action === 'qimei')?.decision).toBe('local_only')
    expect(readFileSync(process.env.GVS_TENCENT_DIAGNOSTICS_PATH!, 'utf8')).not.toContain('PRIVATE_QIMEI')
  } finally {
    if (previous === undefined) delete process.env.GVS_TENCENT_DIAGNOSTICS_PATH
    else process.env.GVS_TENCENT_DIAGNOSTICS_PATH = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const status of ['pending','blocked','rejected','delivery_unknown','registration_response_unverified','http_rejected','invalid_response','binding_invalid']) {
  test(`optional profile ${status} stops reporting while normal operations remain usable`,async()=>{
    const calls:Record<string,unknown>[]=[]
    let nativeCalls=0
    const tracker=new TencentOperations(async input=>{
      calls.push(input)
      return {binding:'opaque',status,stop:true,...(status==='delivery_unknown'?{delivery_unknown:true}:{}),adprofile:{generated:true,complete:false,qimei_registration:{generated:true},registration_delivery:{status,stop:true}}}
    },()=>{},'',undefined,'','tui_process',async()=>{nativeCalls++})
    const detail=await tracker.begin('detail',{cid:'cover'})
    expect(detail?.root.binding).toBe('opaque')
    await tracker.finish(detail,{episodes:[{vid:'episode'}]})
    const play=await tracker.begin('play',{vid:'episode'})
    await tracker.finish(play,{em:0})
    expect(calls).toHaveLength(1)
    expect(nativeCalls).toBe(0)
    expect(tracker.boundInput(play,{})).toMatchObject({session_type:'tv',report_binding:'opaque'})
    // Only the actual business response can stop the business flow.
    await tracker.finish(play,{em:93})
    await expect(tracker.begin('play',{vid:'episode'})).rejects.toThrow('stopped after rejection')
  })
}

for (const scenario of [
  {failure:'identity_not_issued',expected:'qimei_identity_not_issued'},
  {failure:'decryption_failed',expected:'qimei_response_decryption_failed'},
  {failure:'invalid_envelope_or_payload',expected:'qimei_response_invalid'},
  {failure:'identity_ambiguous',expected:'qimei_identity_ambiguous'},
  {failure:'PRIVATE_UNKNOWN_CAUSE',expected:undefined},
]) {
  test(`code-zero registration remains unverified with safe failure ${scenario.expected || 'unknown'}`,async()=>{
    const previous=process.env.GVS_TENCENT_DIAGNOSTICS_PATH
    const dir=mkdtempSync(join(tmpdir(),'tx-response-diagnostics-'))
    const file=join(dir,'diagnostics.jsonl');process.env.GVS_TENCENT_DIAGNOSTICS_PATH=file
    let calls=0
    try{
      const tracker=new TencentOperations(async()=>{
        calls++
        return {binding:'opaque',status:'registration_response_unverified',stop:true,adprofile:{generated:true,complete:false,qimei_registration:{generated:true,complete:true,payload_generated:true,cipher_generated:true,ready_to_send:true},registration_delivery:{status:'registration_response_unverified',stop:true,http_status:200,service_code:'0',response_diagnostics:{failure:scenario.failure,plain:'PRIVATE_RESPONSE',key:'PRIVATE_KEY'}}}}
      },()=>{},'',undefined,'unverified-response-scope')
      const detail=await tracker.begin('detail',{cid:'cover'})
      expect(detail?.root.binding).toBe('opaque')
      const rows=readTencentDiagnostics('unverified-response-scope')
      const delivery=rows.find(r=>r.phase==='delivery')
      expect(delivery?.status).toBe('qimei_registration_unverified')
      expect(delivery?.decision).toBe('no_automatic_resend')
      expect(delivery?.code).toBe('0');expect(delivery?.httpStatus).toBe(200)
      if(scenario.expected)expect(rows.some(r=>r.phase==='response'&&r.status===scenario.expected)).toBe(true)
      else expect(rows.filter(r=>r.phase==='response')).toHaveLength(0)
      expect(rows.some(r=>r.phase==='delivery'&&r.status==='rejected')).toBe(false)
      expect(readFileSync(file,'utf8')).not.toContain('PRIVATE_')
      await tracker.finish(detail,{em:0})
      await tracker.begin('play',{vid:'episode'})
      expect(calls).toBe(1)
    }finally{
      if(previous===undefined)delete process.env.GVS_TENCENT_DIAGNOSTICS_PATH
      else process.env.GVS_TENCENT_DIAGNOSTICS_PATH=previous
      rmSync(dir,{recursive:true,force:true})
    }
  })
}
