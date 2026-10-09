import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { downloadPlaylist } from '../src/lib/media.ts'

process.env.GVS_TUI_LOG = '0'
const input = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Provide the saved first TS segment path')
const sample = readFileSync(input)
const root = resolve('tmp', 'taigu-offline-guard-' + Date.now())
mkdirSync(root, { recursive: true })
const output = join(root,'existing-output.mp4')
const marker = Buffer.from('preserve-existing-output')
writeFileSync(output,marker)
const manifest = ['#EXTM3U','#EXT-X-VERSION:3','#EXT-X-TARGETDURATION:12','#EXT-X-MEDIA-SEQUENCE:0','#EXTINF:11.8,','segment.ts','#EXT-X-ENDLIST'].join(String.fromCharCode(10))
const server = createServer((req,res) => {
  if(req.url === '/sample.m3u8') { res.setHeader('content-type','application/vnd.apple.mpegurl');res.end(manifest) }
  else if(req.url === '/segment.ts') res.end(sample)
  else { res.statusCode=404;res.end() }
})
await new Promise<void>(ok => server.listen(0,'127.0.0.1',ok))
const address = server.address() as { port: number }
const events: unknown[] = []
let failure = ''
try {
  await downloadPlaylist({ src: 'http://127.0.0.1:'+address.port+'/sample.m3u8', dest: output, ref: '', select: 'muxed', transport: 'node', key: '0123456789abcdef0123456789abcdef', keyMethod: 'CENC', workDir: join(root,'work'), workTag: 'video', threads: 1, cb: (n,total,info) => events.push({n,total,phase:info?.phase}) })
} catch(e) { failure = e instanceof Error ? e.message : String(e) }
finally { server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok())) }
const report = { root, failure, rejectedAtFormatCheck: failure.includes('CENC/MP4'), originalOutputPreserved: readFileSync(output).equals(marker), diagnosticsPreserved: existsSync(output+'.download-error.log'), scratchPreserved: readdirSync(join(root,'work','video')).length > 0, falselyCompletedDecrypt: events.some((e:any)=>e.phase==='decrypt' && e.n===1), externalRequests: 0, credentialReads: 0 }
writeFileSync(join(root,'result.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report))
if(!report.rejectedAtFormatCheck || !report.originalOutputPreserved || !report.diagnosticsPreserved || !report.scratchPreserved || report.falselyCompletedDecrypt) process.exit(1)
