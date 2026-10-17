// Synthetic local integration driver. The Go test supplies an isolated gateway,
// session, source fixture and fake upstream; this script never loads user config.
import { GwClient } from '../src/lib/client.ts'
import type { FileConfig } from '../src/lib/config.ts'
import { setRunLogDisabled } from '../src/lib/runlog.ts'

const [host, sourceFile, source] = process.argv.slice(2)
if (!host || !sourceFile || !['tui_process', 'electron_process'].includes(source || '') || new URL(host).hostname !== '127.0.0.1') throw new Error('isolated local integration arguments required')
setRunLogDisabled(true)
const config = { host, key: 'local-integration-fixture', tencentMode: 'tv', tencentObservations: true, tencentNativeEventFile: sourceFile, tencentNativeEventMode: 'send' } as FileConfig
process.env.GVS_TENCENT_NATIVE_RESEARCH = '1'
const client = new GwClient(host, config.key, () => config, source as 'tui_process' | 'electron_process')
await client.invoke('tencent', 'detail', { cid: 'fixture-cover', session_type: 'tv' })
await client.invoke('tencent', 'play', { vid: 'fixture-episode', session_type: 'tv' })
const job = client.forkTencentJob(1, 'fixture-episode')
await job.invoke('tencent', 'play', { vid: 'fixture-episode', session_type: 'tv' })
job.observeTencentTransfer(4096, 8192)
await job.closeTencentTransfer(false, false)
console.log(JSON.stringify({ source, completed: true, real_upstream_contacted: false, user_configuration_loaded: false }))
