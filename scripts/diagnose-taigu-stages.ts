import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { defaultConfig, configPath } from '../src/lib/config.ts'
import { GwClient } from '../src/lib/client.ts'
import { youkuDRM } from '../src/lib/jobs.ts'
import { youkuVideoPlaylist, referer, headersFor, hlsKeyArgs, cleanRELog } from '../src/lib/media.ts'
import { reexecWithoutProxy } from '../src/lib/proxy.ts'

await reexecWithoutProxy()
process.env.GVS_TUI_LOG = '0'
const root = resolve('tmp', 'taigu-stages-' + Date.now())
mkdirSync(root, { recursive: true })
const configBytes = readFileSync(configPath())
const cfg = { ...defaultConfig(), ...JSON.parse(configBytes.toString()) }
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const summary: Record<string, unknown> = { root, livePlayCalls: 0, livePlaylistCalls: 0, liveSegmentCalls: 0 }
const save = () => writeFileSync(join(root, 'summary.json'), JSON.stringify(summary, null, 2))
const bins = resolve('bin')
function scrub(s: string) {
  for (const value of [cfg.key,cfg.youkuSign,cfg.tencentCookie,cfg.douyinCookie]) if (value) s = s.split(value).join('<redacted>')
  return cleanRELog(s)
}
async function run(exe: string, args: string[], cwd: string) {
  return await new Promise<{ code: number | null; log: string }>((resolve, reject) => {
    const p = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore','pipe','pipe'] })
    let output = ''
    const timer = setTimeout(() => p.kill(), 60000)
    p.stdout.on('data', c => { output = (output + c).slice(-100000) })
    p.stderr.on('data', c => { output = (output + c).slice(-100000) })
    p.on('error', e => { clearTimeout(timer); reject(e) })
    p.on('close', code => { clearTimeout(timer); resolve({ code, log: scrub(output) }) })
  })
}
let server: ReturnType<typeof createServer> | undefined
try {
  if (!cfg.youkuSign || !cfg.key) throw new Error('Missing existing credentials')
  const cli = new GwClient(cfg.host, cfg.key, () => cfg)
  summary.livePlayCalls = 1
  const data = await cli.invoke('youku', 'play', { vid: 'XNjQ3MzYyNjYzMg==', expand: '0', tier: 'multi', nocache: '1' }, cli.extra(cfg,'youku'))
  const drm = youkuDRM(data)
  const source = youkuVideoPlaylist(data, 'mp5hd4')
  if (!source) throw new Error('Selected quality unavailable')
  summary.drm = { videoEnc: drm.videoEnc, audioEnc: drm.audioEnc, keyPresent: !!drm.reKey }
  const headers = headersFor(referer('youku'))
  summary.livePlaylistCalls = 1
  const response = await fetch(source, { headers, signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error('Playlist HTTP ' + response.status)
  const text = await response.text()
  const lines = text.split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean)
  if (!lines[0]?.startsWith('#EXTM3U') || lines.some(s => s.startsWith('#EXT-X-STREAM-INF'))) throw new Error('Expected media playlist')
  summary.manifest = { segments: lines.filter(s => !s.startsWith('#')).length, hasMap: lines.some(s => s.startsWith('#EXT-X-MAP')), methods: lines.filter(s => s.startsWith('#EXT-X-KEY')).map(s => s.match(/METHOD=([^,]+)/)?.[1] || 'unspecified') }
  if (lines.some(s => s.startsWith('#EXT-X-MAP'))) throw new Error('This bounded TS diagnostic does not fetch additional init resources')
  const segmentLine = lines.findIndex(s => !s.startsWith('#'))
  if (segmentLine < 0) throw new Error('No segment')
  const segmentUrl = new URL(lines[segmentLine]!, response.url || source).href
  summary.liveSegmentCalls = 1
  const segmentResponse = await fetch(segmentUrl, { headers, signal: AbortSignal.timeout(25000) })
  if (!segmentResponse.ok) throw new Error('Segment HTTP ' + segmentResponse.status)
  if (Number(segmentResponse.headers.get('content-length')) > 64 * 1024 * 1024) throw new Error('Segment exceeds diagnostic size bound')
  const segment = Buffer.from(await segmentResponse.arrayBuffer())
  writeFileSync(join(root, 'upstream-first-segment.ts'), segment)
  const original = readFileSync(resolve('downloads/.gvs-tmp/job-youku-XNjQ3MzYyNjYzMg_-e7aeaf421597/.XNjQ3MzYyNjYzMg==.video.mp4')).subarray(0,segment.length)
  summary.segment = { bytes: segment.length, sha256: sha(segment), tsSync: segment[0]===71 && segment[188]===71, equalsOriginalOutputPrefix: segment.equals(original) }
  save()
  console.log(JSON.stringify(summary))
  const safeLines = lines.slice(0,segmentLine).filter(s => !s.startsWith('#EXT-X-KEY') && !s.startsWith('#EXT-X-SESSION-KEY'))
  if (safeLines.some(s => s.includes('URI=') || s.includes('http'))) throw new Error('Unexpected external URI in local replay')
  const manifest = [...safeLines,'segment.ts','#EXT-X-ENDLIST'].join(String.fromCharCode(10))
  server = createServer((req,res) => {
    if (req.url === '/sample.m3u8') { res.setHeader('content-type','application/vnd.apple.mpegurl');res.end(manifest) }
    else if (req.url === '/segment.ts') res.end(segment)
    else { res.statusCode=404;res.end() }
  })
  await new Promise<void>(ok => server!.listen(0,'127.0.0.1',ok))
  const address = server.address() as { port: number }
  const dir = join(root,'current-pipeline');mkdirSync(dir)
  const args = ['http://127.0.0.1:'+address.port+'/sample.m3u8','--save-dir',dir,'--tmp-dir',dir,'--save-name','download','--auto-select','--drop-subtitle','all','--binary-merge','--del-after-done','false','--no-ansi-color','--force-ansi-console','--disable-update-check','--thread-count','1','--download-retry-count','0','--no-log','--write-meta-json','false','--use-system-proxy','false','--ffmpeg-binary-path',join(bins,'ffmpeg.exe'),...hlsKeyArgs(drm.reKey),'--decryption-engine','SHAKA_PACKAGER','--decryption-binary-path',join(bins,'packager.exe')]
  const execution = await run(join(bins,'N_m3u8DL-RE.exe'),args,dir)
  writeFileSync(join(root,'current-pipeline.log'),execution.log)
  const outputs = readdirSync(dir).filter(n => statSync(join(dir,n)).isFile()).map(name => { const bytes=readFileSync(join(dir,name));return { name,bytes:bytes.length,sha256:sha(bytes),identicalToUpstream:bytes.equals(segment) } })
  summary.currentPipeline = { exit:execution.code, outputs }
  console.log(JSON.stringify(summary.currentPipeline))
} catch(e) { summary.error = scrub(e instanceof Error ? e.message : String(e));console.log(JSON.stringify({error:summary.error})) }
finally {
  if(server) await new Promise<void>(ok => server!.close(() => ok()))
  summary.configUnchanged = sha(configBytes) === sha(readFileSync(configPath()))
  save()
}
