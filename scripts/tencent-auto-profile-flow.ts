// Isolated integration driver; never load the user's settings or external events.
import { GwClient } from '../src/lib/client.ts'
import type { FileConfig } from '../src/lib/config.ts'
import { setRunLogDisabled } from '../src/lib/runlog.ts'
import { readTencentDiagnostics } from '../src/lib/tencent-diagnostics.ts'

const [host, source, qimeiExpected] = process.argv.slice(2)
if (!host || !['tui_process', 'electron_process'].includes(source || '') || new URL(host).hostname !== '127.0.0.1') throw new Error('isolated local arguments required')
if (!['qimei_profile_incomplete', 'qimei_profile_prepared'].includes(qimeiExpected || '')) throw new Error('expected registration coverage required')
setRunLogDisabled(true)
delete process.env.GVS_TENCENT_NATIVE_RESEARCH
delete process.env.GVS_TENCENT_OBSERVE
const config = { host, key: 'local-integration-fixture', tencentMode: 'tv' } as FileConfig
const client = new GwClient(host, config.key, () => config, source as 'tui_process' | 'electron_process')
await client.invoke('tencent', 'detail', { cid: 'fixture-cover', session_type: 'tv' })
await client.invoke('tencent', 'play', { vid: 'fixture-episode', session_type: 'tv' })
const job = client.forkTencentJob(42, 'fixture-episode')
await job.invoke('tencent', 'play', { vid: 'fixture-episode', session_type: 'tv' })
job.observeTencentTransfer(4096, 8192)
await job.closeTencentTransfer()
const diagnostics = readTencentDiagnostics(host + String.fromCharCode(0) + config.key)
if (!diagnostics.some(row => row.action === 'adprofile' && row.status === 'profile_generated_incomplete')) throw new Error('automatic profile result missing')
if (!diagnostics.some(row => row.action === 'qimei' && row.status === qimeiExpected)) throw new Error('automatic registration result missing')
console.log(JSON.stringify({ source, completed: true, automatic_profile: true, real_upstream_contacted: false, user_configuration_loaded: false, external_event_file: false }))
