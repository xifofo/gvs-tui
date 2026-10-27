// Production renderer with synthetic IPC and all network requests blocked.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const profile = mkdtempSync(join(tmpdir(), 'gvs-auto-upload-ui-'))
const output = resolve('../.build/auto-upload-smoke')
mkdirSync(output, { recursive: true })
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
let win
const errors = []
let preload = readFileSync(resolve('scripts/ui-flow-smoke-preload.cjs'), 'utf8')
  .replace('const settings = {', `const settings = { ui: { sidebarCollapsed: false, providerOrder: [], hiddenProviders: [], recentSearches: [], defaultQuality: 'best', theme: 'dark', motion: false },`)
const start = preload.indexOf('let jobs ='), end = preload.indexOf('const update =', start)
preload = preload.slice(0, start) + `
state.plutofish = { url: 'https://example.invalid', hasKey: true, status: 'verified', error: '', identity: { id: 'pub', name: '测试发布端', kind: 'publisher', sourceAccount: { id: 'source', alias: 'main', name: '测试源' }, categories: [{ value: 'tv', label: '剧集' }] } };
let jobs = [1, 2].map(id => ({ id, groupId: 'fixture-' + id, groupTitle: '测试作品 ' + id, provider: 'youku', poster: '', label: 'S01E01', quality: '1080P', status: '完成', state: 'done', pct: 1, err: '', log: '', note: '', createdAt: Date.now(), finishedAt: Date.now(), output: '/fixture/' + id + '.mkv',
  publication: { schemaVersion: 1, binding: { url: 'https://example.invalid', publisherId: 'pub', sourceAccount: { id: 'source', alias: 'main' } }, workTarget: { mediaType: 'tv', tmdbId: '123', category: 'tv' }, title: '测试作品 ' + id, categoryLabel: '剧集', kind: 'video', fileKey: 'fixture-' + id, releaseKey: 'fixture', output: '/fixture/' + id + '.mkv', updatedAt: '', directoryId: '0', directoryPath: '/',
    progress: { stage: 'processing', downloadPercent: 100, uploadPercent: 0, uploadedBytes: 0, sizeBytes: 1024, synced: true, error: '' } }
}));
` + preload.slice(end)
preload = preload.replace("case 'saveSettings':", `case 'publicationRetention': return { hours: 24 };
      case 'hookSettings': return { start: { notify: false, command: '' }, complete: { notify: false, command: '' }, ed2k: false, timeoutSec: 30 };
      case 'controlPublication': {
        const job = jobs.find(j => j.id === args[0]);
        Object.assign(job.publication.progress, { stage: 'uploading', phase: 'uploading', awaitingManual: false });
        emit('jobPatch', [job]); return;
      }
      case 'saveSettings':`)
preload = preload.replace('Object.assign(settings, args[0]);', `Object.assign(settings, args[0]);
        for (const job of jobs) if (job.publication.progress.stage === 'processing' && settings.plutofishAutoUpload === false) Object.assign(job.publication.progress, { awaitingManual: true, autoUploadBlocked: true });
        emit('jobs', jobs);`)
const preloadPath = join(output, 'preload.cjs')
writeFileSync(preloadPath, preload)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const run = code => win.webContents.executeJavaScript(code)
async function wait(code) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) { if (await run(`!!(${code})`)) return; await delay(50) }
  throw new Error(`Timeout: ${code}`)
}
async function clickText(text, root = 'main') {
  const code = `Array.from(document.querySelectorAll(${JSON.stringify(root + ' button')})).find(e => e.textContent.trim() === ${JSON.stringify(text)} || e.getAttribute('aria-label') === ${JSON.stringify(text)})`
  await wait(code)
  await run(`(${code}).click()`)
}
async function main() {
  await app.whenReady()
  for (const width of [1280, 760]) {
    win = new BrowserWindow({ width, height: 1000, show: false, useContentSize: true, webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false, partition: 'auto-upload-' + width } })
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^(https?|wss?):/.test(details.url) }))
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    await win.loadFile(resolve('out/renderer/index.html'))
    await wait('window.__uiFlowFixture.snapshot().ready')
    await clickText('设置', '.side')
    await clickText('PlutoFish', 'nav.tabs')
    const toggle = 'document.querySelector("input[aria-label=\\"下载完成后自动上传 PlutoFish\\"]")'
    await wait(toggle)
    assert.equal(await run(`${toggle}.checked`), true, 'old profiles retain automatic upload by default')
    await run(`${toggle}.click()`)
    await wait('window.__uiFlowFixture.snapshot().settings.plutofishAutoUpload === false')
    await wait(`!${toggle}.disabled`)
    assert.equal(await run(`${toggle}.checked`), false)
    await run('document.fonts.ready')
    writeFileSync(join(output, `settings-${width}.png`), (await win.webContents.capturePage()).toPNG())
    assert.equal(await run('document.documentElement.scrollWidth > innerWidth + 1'), false)
    await clickText('下载', '.side')
    await wait('document.querySelectorAll(".upload-progress .upload-actions button").length === 2')
    assert.equal(await run('Array.from(document.querySelectorAll(".upload-progress button")).filter(e => e.textContent.trim() === "立即上传").length'), 2)
    assert.ok(await run('/待处理\\s*2/.test(document.querySelector(".filters").textContent)'))
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    writeFileSync(join(output, `waiting-${width}.png`), (await win.webContents.capturePage()).toPNG())
    await clickText('立即上传')
    await wait('window.__uiFlowFixture.snapshot().calls.some(c => c.method === "controlPublication" && c.args[1] === "resume")')
    assert.equal(await run('window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "enqueue").length'), 0)
    await clickText('设置', '.side')
    await wait(toggle)
    assert.equal(await run(`${toggle}.checked`), false)
    await run(`${toggle}.click()`)
    await wait('window.__uiFlowFixture.snapshot().settings.plutofishAutoUpload === true')
    assert.equal(await run('window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "saveSettings").length'), 2)
    await clickText('下载', '.side')
    await wait('document.querySelectorAll(".upload-progress .upload-actions button").length === 2')
    assert.equal(await run('Array.from(document.querySelectorAll(".upload-progress button")).filter(e => e.textContent.trim() === "立即上传").length'), 1)
    assert.equal(await run('window.__uiFlowFixture.snapshot().jobs.filter(j => j.publication.progress.awaitingManual).length'), 1)
    assert.equal(await run('document.body.innerText.includes("自动上传已关闭，文件已保留")'), false)
    writeFileSync(join(output, `reenabled-${width}.png`), (await win.webContents.capturePage()).toPNG())
    assert.deepEqual(errors, [])
    win.destroy(); win = undefined
  }
  console.log('PASS: Re-enabling preserves existing manual tasks; settings, pending state and per-file upload work at 1280 and 760 px; no network or user data used')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  win?.destroy()
  rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
