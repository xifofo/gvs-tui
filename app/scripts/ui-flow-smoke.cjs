// PowerShell, from tui/: Start-Process app/node_modules/electron/dist/electron.exe -ArgumentList 'app/scripts/ui-flow-smoke.cjs' -WindowStyle Hidden -Wait
// --baseline records known assertion failures without failing the process.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const baseline = process.argv.includes('--baseline')
const output = path.resolve(__dirname, '../../.build/ui-flow-smoke', baseline ? 'baseline' : 'current')
fs.mkdirSync(output, { recursive: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gvs-ui-flow-smoke-'))
app.setPath('userData', userData)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.on('window-all-closed', () => {})
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = { passed: true, baseline, scope: 'Built Electron renderer; synthetic IPC; HTTP/HTTPS/WS/WSS blocked; no production main process, real account, or media download.', userData, viewports: [], assertions: [], blockedRequests: [], consoleErrors: [] }
let currentWindow
const source = fs.readFileSync(path.resolve(__dirname, '../src/main/index.ts'), 'utf8')
const minWidth = Number(/minWidth:\s*(\d+)/.exec(source)?.[1] || 1000)
const minHeight = Number(/minHeight:\s*(\d+)/.exec(source)?.[1] || 700)
const viewports = [{ width: 1280, height: 800 }, { width: Math.max(1000, minWidth), height: Math.max(700, minHeight) }]
const js = (fn, ...args) => '(' + fn.toString() + ')(' + args.map(value => JSON.stringify(value)).join(',') + ')'

async function flow(viewport) {
  const tag = `${viewport.width}x${viewport.height}`
  const dir = path.join(output, tag)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'console.log'), '')
  fs.writeFileSync(path.join(dir, 'progress.log'), '')
  const win = currentWindow = new BrowserWindow({
    ...viewport, useContentSize: true, frame: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'ui-flow-smoke-preload.cjs'), partition: `ui-flow-${tag}`, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false },
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const cancel = /^(https?|wss?):/i.test(details.url)
    if (cancel) report.blockedRequests.push({ viewport: tag, url: details.url })
    callback({ cancel })
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:')) event.preventDefault() })
  win.webContents.on('console-message', (...args) => {
    const event = args[0]
    const message = event?.message || args[2]
    const level = event?.level ?? args[1]
    fs.appendFileSync(path.join(dir, 'console.log'), String(message) + '\n')
    if (level === 'error' || level === 3) report.consoleErrors.push({ viewport: tag, message })
  })
  const run = script => win.webContents.executeJavaScript(script)
  const progress = message => fs.appendFileSync(path.join(dir, 'progress.log'), new Date().toISOString() + ' ' + message + '\n')
  win.webContents.on('did-start-loading', () => progress('did-start-loading'))
  win.webContents.on('dom-ready', () => progress('dom-ready'))
  win.webContents.on('did-finish-load', () => progress('did-finish-load'))
  win.webContents.on('render-process-gone', (_event, details) => progress('render-process-gone ' + JSON.stringify(details)))
  async function waitFor(script, label, timeout = 10000) {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      if (await run(script)) { await sleep(170); return }
      await sleep(50)
    }
    throw new Error(`${tag}: timed out waiting for ${label}`)
  }
  async function assert(name, script) {
    const detail = await run(script)
    const passed = typeof detail === 'boolean' ? detail : detail.passed
    report.assertions.push({ viewport: tag, name, passed, ...(typeof detail === 'object' ? { detail } : {}) })
    if (!passed) report.passed = false
  }
  async function capture(name) {
    progress('capture ' + name)
    await run('Promise.race([document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 3000))])')
    progress('fonts settled ' + name)
    await sleep(100)
    win.webContents.invalidate()
    const screen = await Promise.race([win.webContents.capturePage({stayHidden:true}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Screenshot timed out: '+name)),15000))])
    fs.writeFileSync(path.join(dir, name + '.png'), screen.toPNG())
    await assert(`${name}: no horizontal page overflow`, js(() => {
      const overflow = [document.documentElement, document.body, ...document.querySelectorAll('main, .page, .downloads')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => ({ element: e.tagName + '.' + e.className, clientWidth: e.clientWidth, scrollWidth: e.scrollWidth }))
      return { passed: overflow.length === 0, overflow }
    }))
  }
  async function click(selector, index = 0) {
    await waitFor(js((selector, index) => !!document.querySelectorAll(selector)[index], selector, index), selector)
    await run(js((selector, index) => {
      const element = document.querySelectorAll(selector)[index]
      if (element.disabled) throw new Error('Disabled control: ' + selector)
      let disclosure = element.closest('details:not([open])')
      while (disclosure) { disclosure.querySelector('summary').click(); disclosure = disclosure.parentElement?.closest('details:not([open])') }
      element.scrollIntoView({ block: 'nearest' })
      element.click()
    }, selector, index))
    await sleep(200)
  }
  async function textButton(text, within = 'main', startsWith = false) {
    const script = js((text, within, startsWith) => Array.from(document.querySelectorAll(within + ' button')).some(e => startsWith ? e.textContent.trim().startsWith(text) : e.textContent.trim() === text), text, within, startsWith)
    await waitFor(script, `button ${text}`)
    await run(js((text, within, startsWith) => {
      const button = Array.from(document.querySelectorAll(within + ' button')).find(e => startsWith ? e.textContent.trim().startsWith(text) : e.textContent.trim() === text)
      button.scrollIntoView({ block: 'nearest' }); button.click()
    }, text, within, startsWith))
    await sleep(200)
  }
  async function ctaVisible(name, selector) {
    await assert(name, js(selector => {
      const e = document.querySelector(selector)
      if (!e) return { passed: false, reason: 'missing', selector }
      const r = e.getBoundingClientRect()
      const x = r.x + r.width / 2, y = r.y + r.height / 2
      const hit = document.elementFromPoint(x, y)
      return { passed: r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && (hit === e || e.contains(hit)), rect: { x: r.x, y: r.y, width: r.width, height: r.height }, viewport: { width: innerWidth, height: innerHeight } }
    }, selector))
  }
  progress('load renderer')
  await win.loadFile(path.resolve(__dirname, '../out/renderer/index.html'))
  await waitFor('!!document.querySelector("input[type=search]")', 'application boot')
  report.viewports.push({ requested: viewport, actual: await run('({width:innerWidth,height:innerHeight})') })
  await capture('00-connecting')
  await waitFor('window.__uiFlowFixture.snapshot().ready && document.body.innerText.includes("山海回声")', 'ready discovery content')
  await assert('discovery waits for connection and tunnel readiness', 'window.__uiFlowFixture.snapshot().calls.filter(c => ["catalog", "browse"].includes(c.method) && !c.ready).length === 0')
  await capture('01-discover')
  async function search(query) {
    await run(js(query => {
    const input = document.querySelector('input[type=search]')
    input.value = query
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }, query))
  }
  await search('慢速旧查询')
  await sleep(30)
  await search('山海')
  await waitFor('Array.from(document.querySelectorAll("main button")).filter(e => e.querySelector("h3")).length >= 12', '12 search results')
  await waitFor('window.__uiFlowFixture.snapshot().calls.some(c => c.method === "parseLink" && c.args[0] === "慢速旧查询" && c.completed)', 'late link parsing')
  await assert('late parseLink result cannot replace the new search', js(() => document.querySelector('main h1')?.textContent.includes('山海') && !window.__uiFlowFixture.snapshot().calls.some(c => c.method === 'detailFromLink')))
  await capture('02-search')
  await run(js(() => Array.from(document.querySelectorAll('main button')).find(e => e.querySelector('h3')?.textContent.trim() === '山海回声').click()))
  await waitFor(js(() => document.querySelectorAll('button[aria-label^="第 "]').length === 40), '40 episodes')
  await capture('03-detail')
  await click('button[aria-label^="第 1 集"]')
  await click('button[aria-label^="第 3 集"]')
  await click('button[aria-label^="第 5 集"]')
  await run(js(() => {
    const input = document.querySelector('#range')
    input.value = '2-4'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('blur'))
  }))
  await assert('range draft does not silently replace episode selection on blur', js(() => Array.from(document.querySelectorAll('button[aria-label^="第 "][aria-pressed=true]')).map(e => e.getAttribute('aria-label').split('，')[0]).join(',') === '第 1 集,第 3 集,第 5 集'))
  await run('document.querySelector("#range").form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))')
  await sleep(50)
  await assert('explicit range submission selects matching episodes', js(() => Array.from(document.querySelectorAll('button[aria-label^="第 "][aria-pressed=true]')).map(e => e.getAttribute('aria-label').split('，')[0]).join(',') === '第 2 集,第 3 集,第 4 集'))
  await run(js(() => {
    const input = document.querySelector('#range')
    input.value = 'not-a-range'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }))
  await sleep(50)
  await assert('invalid range preserves selected episodes', js(() => Array.from(document.querySelectorAll('button[aria-label^="第 "][aria-pressed=true]')).map(e => e.getAttribute('aria-label').split('，')[0]).join(',') === '第 2 集,第 3 集,第 4 集'))
  await ctaVisible('detail primary action remains visible', '.eps .foot button.primary')
  await run('window.__uiFlowFixture.delayNextProbe(2200)')
  await textButton('下一步', 'main', true)
  await waitFor('window.__uiFlowFixture.snapshot().calls.some(c => c.method === "probe" && !c.completed)', 'pending quality request')
  await textButton('设置', 'nav[aria-label="主导航"]')
  await waitFor('!!document.querySelector("nav[aria-label=设置分类]")', 'settings during quality loading')
  await textButton('返回画质选择')
  await waitFor('document.body.innerText.includes("画质加载已中断")', 'interrupted quality retry state')
  await assert('leaving pending quality exposes a retry instead of blank content', js(() => Array.from(document.querySelectorAll('main .error-box button')).some(e => e.textContent.trim() === '重试' && !e.disabled)))
  await waitFor('window.__uiFlowFixture.snapshot().calls.some(c => c.method === "probe" && c.completed)', 'discarded late quality response')
  await assert('late quality result cannot overwrite interrupted state', 'document.body.innerText.includes("画质加载已中断") && document.querySelectorAll("input[name=quality]").length === 0')
  await textButton('重试', 'main .error-box')
  await waitFor('document.querySelectorAll("input[name=quality]").length === 8', '8 video qualities')
  await assert('retry recovers interrupted quality loading', 'window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "probe").length === 2 && document.querySelectorAll("input[name=quality]").length === 8')
  await capture('04-quality')
  await ctaVisible('quality primary action remains visible', '.out-actions button.primary')
  await assert('multiple audio tracks available', 'document.querySelectorAll("main input[type=checkbox]").length >= 5')
  await click('input[name=quality][value="3"]')
  await click('button[aria-label^="国语 杜比全景声"]')
  await capture('04-quality-audio-expanded')
  await click('.out-content button.dir:not(.tmp)')
  await waitFor('!!document.querySelector("nav[aria-label=设置分类]")', 'quality output directory settings')
  await textButton('返回画质选择')
  await waitFor('document.querySelectorAll("input[name=quality]").length === 8', 'return from directory settings')
  await assert('settings return preserves quality and default audio', js(() => document.querySelector('input[name=quality]:checked')?.value === '3' && document.querySelector('button[aria-label^="国语 杜比全景声"]')?.getAttribute('aria-pressed') === 'true'))
  await run(js(() => { const last = document.querySelector('input[name=quality][value="7"]'); last.closest('label').scrollIntoView({ block: 'nearest' }) }))
  await capture('05-quality-scrolled')
  await ctaVisible('quality primary action remains visible after scrolling', '.out-actions button.primary')
  await run('document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await waitFor(js(() => document.querySelectorAll('button[aria-label^="第 "]').length === 40), 'return to detail')
  await assert('back preserves three selected episodes', js(() => document.querySelectorAll('button[aria-label^="第 "][aria-pressed=true]').length === 3))

  // The extra collection catches a remount regression hidden by testing only the first tab.
  await textButton('番外', '[role=tablist]')
  await waitFor(js(() => document.querySelectorAll('button[aria-label^="第 "]').length === 4), 'extra collection')
  await click('button[aria-label^="第 1 集"]')
  await click('button[aria-label^="第 2 集"]')
  await textButton('下一步', 'main', true)
  await waitFor('document.querySelectorAll("input[name=quality]").length === 8', 'extra quality')
  await run('document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
  await waitFor(js(() => !!document.querySelector('button[aria-label^="第 "]')), 'return to extra collection')
  await assert('back preserves collection and selected episodes', js(() => document.querySelectorAll('button[aria-label^="第 "]').length === 4 && document.querySelectorAll('button[aria-label^="第 "][aria-pressed=true]').length === 2))
  await capture('06-detail-return')
  await textButton('下一步', 'main', true)
  await waitFor('document.querySelectorAll("input[name=quality]").length === 8', 'final quality selection')
  await click('input[name=quality][value="3"]')
  await click('button[aria-label^="国语 杜比全景声"]')
  await run(js(() => {
    const button = document.querySelector('.out-actions button.primary')
    if (!button || button.disabled) throw new Error('Missing enabled enqueue button')
    button.click(); button.click()
  }))
  await waitFor('!!document.querySelector(".downloads")', 'download queue')
  await assert('same-tick double click enqueues once', 'window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "enqueue").length === 1')
  await assert('queue receives selected quality, audio and episodes', js(() => {
    const calls = window.__uiFlowFixture.snapshot().calls.filter(c => c.method === 'enqueue')
    const r = calls[0]?.args[0]
    return !!r && r.quality === 3 && r.defaultAudioId === 'zh-eac3' && r.audioIds.includes('zh-eac3') && r.episodes.map(e => e.vid).join(',') === 'fixture-episode-41,fixture-episode-42'
  }))
  await capture('07-downloads')
  await run(js(() => {
    const opener = document.querySelector('button[aria-label="删除整组"]')
    opener.dataset.smokeOpener = 'confirm'
    opener.focus(); opener.click()
  }))
  await waitFor('!!document.querySelector("[role=alertdialog]")', 'delete confirmation')
  await assert('confirmation focuses safe cancel action', 'document.activeElement?.hasAttribute("data-dialog-cancel") === true')
  await run(js(() => {
    const buttons = document.querySelectorAll('[role=alertdialog] button')
    buttons[buttons.length - 1].focus()
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  }))
  await assert('Tab wraps from last dialog control to first', 'document.activeElement === document.querySelector("[role=alertdialog] input")')
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }))')
  await assert('Shift+Tab wraps back to last dialog control', js(() => { const buttons = document.querySelectorAll('[role=alertdialog] button'); return document.activeElement === buttons[buttons.length - 1] }))
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }))')
  await assert('Ctrl+K cannot focus search behind dialog', 'document.querySelector("[role=alertdialog]")?.contains(document.activeElement) === true')
  await capture('07-confirm-dialog')
  await click('[data-dialog-cancel]')
  await waitFor('!document.querySelector("[role=alertdialog]")', 'confirmation cancellation')
  await assert('cancel restores focus and keeps queued jobs', 'document.activeElement?.dataset.smokeOpener === "confirm" && window.__uiFlowFixture.snapshot().jobs.filter(j => j.groupId === "fixture-enqueued").length === 2')
  await textButton('已暂停', '.downloads .filters', true)
  await assert('download filter excludes queued jobs', '!document.querySelector(".downloads .stt.queued") && !!document.querySelector(".downloads .stt.paused")')
  await capture('08-downloads-paused')
  await textButton('设置', 'nav[aria-label="主导航"]')
  await waitFor('!!document.querySelector("nav[aria-label=设置分类]")', 'settings tabs')
  const tabs = await run('Array.from(document.querySelectorAll("nav[aria-label=设置分类] button")).map(e => e.textContent.trim())')
  for (let i = 0; i < tabs.length; i++) {
    await textButton(tabs[i], 'nav[aria-label="设置分类"]')
    await assert('settings tab selected: ' + tabs[i], js(label => Array.from(document.querySelectorAll('nav[aria-label=设置分类] button')).some(e => e.textContent.trim() === label && ['true', 'page'].includes(e.getAttribute('aria-current'))), tabs[i]))
    if (tabs[i] === '下载') {
      await run(js(() => { const button = document.querySelector('button[aria-label="增加"]'); button.click(); button.click() }))
      await waitFor('window.__uiFlowFixture.snapshot().settings.threads === 6', 'both queued settings patches saved')
      await assert('rapid settings increments save and display both changes', js(() => document.querySelector('.stepper span')?.textContent.trim() === '6' && window.__uiFlowFixture.snapshot().calls.filter(c => c.method === 'saveSettings' && c.args[0].threads).map(c => c.args[0].threads).join(',') === '5,6'))
    }
    if (await run('!!document.querySelector("#desktop-proxy")')) {
      await run(js(() => {
        const input = document.querySelector('#desktop-proxy')
        input.value = 'http://127.0.0.1:17890'
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }))
      await run('window.__uiFlowFixture.pushState()')
      await sleep(120)
      await assert('state event preserves unsaved settings draft', 'document.querySelector("#desktop-proxy").value === "http://127.0.0.1:17890" && window.__uiFlowFixture.snapshot().settings.desktopProxy === ""')
    }
    if (tabs[i] === '平台账号') {
      await textButton('扫码')
      await waitFor('!!document.querySelector("[role=dialog][aria-modal=true]")', 'QR loading dialog')
      await assert('QR can close while its start request is pending', 'window.__uiFlowFixture.snapshot().calls.some(c => c.method === "youkuQrStart" && !c.completed)')
      await capture('09-qr-pending')
      await click('[role=dialog] button[aria-label="关闭"]')
      await waitFor('!document.querySelector("[role=dialog][aria-modal=true]")', 'QR close')
      await waitFor('window.__uiFlowFixture.snapshot().calls.some(c => c.method === "youkuQrStart" && c.completed)', 'late QR response')
      await sleep(1700)
      await assert('closed QR ignores late response and starts no polling', 'window.__uiFlowFixture.snapshot().calls.some(c => c.method === "qrCancel") && !window.__uiFlowFixture.snapshot().calls.some(c => c.method === "youkuQrPoll") && !document.querySelector("[role=dialog][aria-modal=true]")')
    }
    if (tabs[i] === '关于') {
      await textButton('检查更新')
      await waitFor('document.body.innerText.includes("403")', 'rate limited update response')
      await assert('update 403 keeps readable guidance and release page action', js(() => Array.from(document.querySelectorAll('button')).some(e => e.textContent.trim() === '打开发布页' && !e.disabled) && document.querySelector('[role=status]')?.textContent.includes('60 分钟')))
    }
    await capture(`09-settings-${i + 1}`)
  }
  // New provider entry points use the same renderer flow; media execution is
  // verified separately against generated loopback fixtures.
  for (const [provider, label] of [['mgtv','芒果 TV'],['bilibili','哔哩哔哩'],['migu','咪咕视频']]) {
    await textButton('发现','nav[aria-label="主导航"]')
    await click(`button.pill[aria-label="${label}"]`)
    await waitFor(js(p=>window.__uiFlowFixture.snapshot().calls.some(c=>c.method==='browse' && c.args[0]===p),provider),'new provider browse')
    await run(js(()=>document.querySelector('main .item, main .rl').click()))
    await waitFor(js(()=>!!document.querySelector('button[aria-label^="第 1 集"]')),'provider episodes')
    await click('button[aria-label^="第 2 集"]')
    await textButton('下一步：选画质',undefined,true)
    await waitFor('!!document.querySelector("input[name=quality]")','provider quality')
    await assert(label+' has its own probe identity',js(p=>window.__uiFlowFixture.snapshot().calls.filter(c=>c.method==='probe').at(-1)?.args[0]===p,provider))
    await capture('10-'+provider+'-quality')
    await textButton('开始下载',undefined,true)
    await waitFor(js(p=>window.__uiFlowFixture.snapshot().calls.filter(c=>c.method==='enqueue').at(-1)?.args[0].detail.provider===p,provider),'provider enqueue')
    await assert(label+' preserves selected episode',js(p=>{const r=window.__uiFlowFixture.snapshot().calls.filter(c=>c.method==='enqueue').at(-1)?.args[0];return r?.detail.provider===p && r.episodes.length===1 && r.episodes[0].number===2},provider))
  }
  await textButton('设置','nav[aria-label="主导航"]')
  await textButton('平台账号','nav[aria-label="设置分类"]')
  await textButton('芒果扫码登录')
  await waitFor('!!document.querySelector("[role=dialog] img")','mango QR')
  await assert('MGTV uses official app QR dialog', 'document.querySelector("[role=dialog]")?.getAttribute("aria-label") === "扫码登录芒果 TV"')
  await capture('11-mgtv-login')
  await click('button[aria-label="关闭"]')
  for (const [button,title,terminal] of [['咪咕扫码登录','扫码登录咪咕视频','unified']]) {
    await textButton(button)
    await waitFor('!!document.querySelector("[role=dialog] img")','Migu QR')
    await assert('Migu has one QR entry',js(title=>document.querySelector('[role=dialog]')?.getAttribute('aria-label')===title && window.__uiFlowFixture.snapshot().calls.filter(c=>c.method==='providerSession').at(-1)?.args[0].provider==='migu' && !document.body.innerText.includes('咪视界 TV 扫码'),title))
    await capture('11-migu-'+terminal+'-login')
    await click('button[aria-label="关闭"]')
  }
  await run(js(()=>{const e=document.querySelector('textarea[aria-label="本人 B 站 Web Cookie"]');e.value='SESSDATA=OFFLINE_ONLY';e.dispatchEvent(new Event('input',{bubbles:true}))}))
  await textButton('验证并导入 B 站 Cookie')
  await waitFor('document.body.innerText.includes("B 站 Web 会话已验证")','Bili import status')
  await assert('Bilibili import clears transient Cookie without saving preferences',js(()=>document.querySelector('textarea[aria-label="本人 B 站 Web Cookie"]').value === '' && !JSON.stringify(window.__uiFlowFixture.snapshot().settings).includes('OFFLINE_ONLY')))
  const fixture = await run('window.__uiFlowFixture.snapshot()')
  fs.writeFileSync(path.join(dir, 'ipc-calls.json'), JSON.stringify(fixture.calls, null, 2))
  win.destroy()
  currentWindow = null
}

async function main() {
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ ...report, running: true, passed: false }, null, 2))
  await app.whenReady()
  for (const viewport of viewports) await flow(viewport)
  if (report.consoleErrors.length) report.passed = false
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
  process.stdout.write(JSON.stringify({ passed: report.passed, baseline, output, assertions: report.assertions.length, failures: report.assertions.filter(a => !a.passed).map(a => `${a.viewport}: ${a.name}`), consoleErrors: report.consoleErrors }, null, 2) + '\n')
  app.exit(report.passed || baseline ? 0 : 1)
}
main().catch(async error => {
  report.passed = false
  report.error = error.stack || error.message
  if (currentWindow && !currentWindow.isDestroyed()) {
    fs.writeFileSync(path.join(output, 'failure.png'), (await currentWindow.webContents.capturePage()).toPNG())
    fs.writeFileSync(path.join(output, 'failure.html'), await currentWindow.webContents.executeJavaScript('document.documentElement.outerHTML').catch(() => ''))
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
  process.stderr.write(String(error.stack || error) + '\n')
  app.exit(1)
})
