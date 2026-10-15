/** 真实 Electron Core + 连接页回归；仅使用本机 HTTP 夹具和临时配置。 */
import { app, BrowserWindow, ipcMain } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Core } from '../src/main/core'
import { assertDesktopAccess } from '../../src/integrations/plutofish/access'

const profile = mkdtempSync(join(tmpdir(), 'gvs-plutofish-smoke-'))
const output = resolve('../.build/plutofish-auth')
mkdirSync(output, { recursive: true })
app.setPath('userData', profile)
process.env.APPDATA = profile
process.env.GVS_NO_TUNNEL = '1'
app.disableHardwareAcceleration()
let publisherStatus = 200, gatewayStatus = 200, publisherChecks = 0, gatewayChecks = 0
let window: BrowserWindow | undefined, core: Core | undefined
const consoleErrors: string[] = []
const publisher = createServer((req, res) => {
  ++publisherChecks
  const status = req.headers.authorization === 'Bearer publisher-test-key' ? publisherStatus : 401
  assert.equal(req.url, '/api/v1/publisher/me')
  assert.equal(req.headers.cookie, undefined)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(status === 200 ? { id: 'publisher-fixture', name: '测试发布端', kind: 'publisher', sourceAccount: { id: 'source-fixture', name: '测试源账号', alias: 'fixture' } } : { error: { code: 'UNAUTHENTICATED' } }))
})
const gateway = createServer((req, res) => {
  const status = req.headers.authorization === 'Bearer gateway-test-key' ? gatewayStatus : 401
  if (req.url === '/v1/key') ++gatewayChecks
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(status !== 200 ? { code: 401, msg: '网关密钥无效' } : {
    code: 0, data: req.url === '/v1/accounts' ? { multiAccount: false } : { id: 'gateway-fixture', name: '测试网关', prefix: 'test', all: false, scope: [], permanent: true },
  }))
})
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const makeCore = () => {
  const value = new Core({ state: () => { if (window && !window.isDestroyed()) window.webContents.send('gvs:state', value.state()) }, jobs: () => {}, toast: () => {} })
  // 与鉴权无关的媒体工具探测不属于本回归。
  ;(value as any).checkTools = async () => {}
  return value
}

async function main() {
  await app.whenReady()
  await new Promise<void>(r => publisher.listen(0, '127.0.0.1', r))
  await new Promise<void>(r => gateway.listen(0, '127.0.0.1', r))
  const pf = `http://127.0.0.1:${(publisher.address() as { port: number }).port}`
  const gw = `http://127.0.0.1:${(gateway.address() as { port: number }).port}`
  core = makeCore()
  assert.equal(core.state().configured, false)
  await assert.rejects(core.setup(gw, 'gateway-test-key', '', { url: pf, key: 'wrong' }))
  assert.equal(core.state().configured, false)
  assert.equal(gatewayChecks, 0)
  gatewayStatus = 401
  await assert.rejects(core.setup(gw, 'gateway-test-key', '', { url: pf, key: 'publisher-test-key' }))
  assert.equal(core.state().configured, false)
  gatewayStatus = 200
  await core.setup(gw, 'gateway-test-key', '', { url: pf, key: 'publisher-test-key' })
  assert.equal(core.state().configured, true)
  assert.ok(!JSON.stringify(core.state()).includes('publisher-test-key'))
  await core.shutdown()

  // 新进程等价的 Core 实例不能沿用上次的已验证状态。
  const before = [publisherChecks, gatewayChecks]
  core = makeCore()
  assert.equal(core.state().configured, false)
  await core.boot()
  assert.equal(core.state().configured, true)
  assert.equal(publisherChecks, before[0] + 1)
  assert.equal(gatewayChecks, before[1] + 1)
  publisherStatus = 401
  await assert.rejects(core.plutofish.verify(undefined, true))
  assert.equal(core.state().configured, false)
  await assert.rejects(() => core!.enqueue({} as never), /双重鉴权/)
  assert.throws(() => assertDesktopAccess('resumeAll', core!.state().configured), /双重鉴权/)

  ipcMain.handle('gvs:call', async (_event, method: string, args: unknown[]) => {
    try {
      assertDesktopAccess(method, core!.state().configured)
      let data: unknown
      if (method === 'state') data = core!.state()
      else if (method === 'setup') data = await core!.setup(...args as Parameters<Core['setup']>)
      else if (method === 'jobs') data = core!.jobList()
      else if (method === 'accounts') data = { providers: [], slots: [] }
      else if (method === 'subscriptions') data = { items: [], paused: true }
      else if (method === 'updateState') data = { status: 'idle' }
      else throw new Error('未实现的测试调用')
      return { ok: true, data }
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'error' } }
  })
  window = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { preload: resolve('out/preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  window.webContents.on('console-message', event => { if (event.level === 'error') consoleErrors.push(event.message) })
  await window.loadFile(resolve('out/renderer/index.html'))
  const run = (script: string) => window!.webContents.executeJavaScript(script)
  const waitFor = async (script: string) => {
    for (let i = 0; i < 100; i++) { if (await run(script)) return; await sleep(50) }
    throw new Error(`UI wait failed: ${script}`)
  }
  await waitFor("document.body.innerText.includes('连接网关与 PlutoFish')")
  await run(`(() => {
    const inputs = document.querySelectorAll('form input');
    const values = ${JSON.stringify([gw, 'gateway-test-key', '', pf, 'publisher-test-key'])};
    inputs.forEach((input, i) => { input.value = values[i]; input.dispatchEvent(new Event('input', { bubbles: true })); });
  })()`)
  assert.equal(await run("document.querySelector('fieldset input[type=password]') !== null"), true)
  await run("document.querySelector('form').requestSubmit()")
  await waitFor("document.body.innerText.includes('PlutoFish 密钥无效') && !document.querySelector('button[type=submit]').disabled")
  assert.equal(await run("document.querySelector('.shell') === null"), true)
  await sleep(150)
  writeFileSync(join(output, 'connection-error.png'), (await window.webContents.capturePage()).toPNG())
  publisherStatus = 200
  await run("document.querySelector('form').requestSubmit()")
  await waitFor("document.body.innerText.includes('你常用哪些平台')")
  assert.equal(core.state().configured, true)
  assert.equal(await run("document.documentElement.scrollWidth <= window.innerWidth"), true)
  assert.equal(await run("document.body.innerText.includes('publisher-test-key')"), false)
  assert.deepEqual(consoleErrors, [])
  writeFileSync(join(output, 'result.json'), JSON.stringify({ passed: true, publisherChecks, gatewayChecks, consoleErrors, checks: ['invalid publisher', 'invalid gateway', 'both required', 'restart verification', 'runtime revocation', 'IPC gate', 'renderer submit', 'masked credential', '1100px layout'] }, null, 2))
  console.log('PlutoFish Electron authentication smoke passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(async () => {
  if (window && !window.isDestroyed()) window.destroy()
  await core?.shutdown()
  publisher.closeAllConnections(); publisher.close()
  gateway.closeAllConnections(); gateway.close()
  rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
})
