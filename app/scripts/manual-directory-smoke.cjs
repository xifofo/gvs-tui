// Production renderer with isolated synthetic IPC. No credentials or network access.
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const profile = mkdtempSync(join(tmpdir(), 'gvs-manual-directory-'))
app.setPath('userData', profile); app.disableHardwareAcceleration(); app.on('window-all-closed', () => {})
const output = mkdtempSync(join(tmpdir(), 'gvs-directory-screens-')); console.log('screenshots:', output)
const accounts = [{ id: 'source-a', alias: 'a', name: '账号 A', provider: '115', enabled: true }, { id: 'source-b', alias: 'b', name: '账号 B', provider: '115', enabled: true }]
const connection = { url: 'https://example.invalid', hasKey: true, status: 'verified', error: '', identity: { id: 'publisher', name: '测试发布端', kind: 'publisher', sourceAccount: accounts[0], sourceAccounts: accounts, categories: [{ value: 'tv', label: '日韩剧集' }, { value: 'other', label: '其他剧集' }] } }
const tmdb = { id: 123, kind: 'show', name: 'Doctor X', title: 'Doctor X', year: 2024, overview: '' }
const preferences = Object.fromEntries(accounts.map(a => [a.id, { publication: { sourceAccountId: a.id, category: 'tv', directoryId: a.id === 'source-a' ? '100' : '200', directoryPath: '/发布资源' }, tmdb }]))
const calls = [], errors = [], creations = []
const nodes = new Map([['0', { id: '0', name: '根目录', parent: null }], ['100', { id: '100', name: '发布资源', parent: '0' }], ['200', { id: '200', name: '账号 B 目录', parent: '0' }], ['300', { id: '300', name: '其他位置', parent: '0' }]])
let nextDirectoryId = 500
function directoryPage(sourceAccountId, id) {
  const path = []; let node = nodes.get(id)
  assert.ok(node, `fixture directory ${id} must exist`)
  while (node) { path.unshift({ id: node.id, name: node.name }); node = nodes.get(node.parent) }
  return { sourceAccountId, path, items: [...nodes.values()].filter(n => n.parent === id).map(n => ({ id: n.id, name: n.name })), nextCursor: '' }
}
let failCreate = true, win, pendingCreate
const delay = ms => new Promise(r => setTimeout(r, ms))
const clone = value => JSON.parse(JSON.stringify(value))
ipcMain.handle('manual-directory-smoke', async (_event, method, ...args) => {
  calls.push({ method, args: clone(args) })
  const source = args[0]?.sourceAccountId || 'source-a'
  if (method === 'publicationPreferences') return clone(preferences[source] || null)
  if (method === 'savePublicationPreferences') { preferences[source] = { publication: clone(args[1]), tmdb: args[0].tmdb, tmdbSeason: args[0].tmdbSeason, naming: args[0].naming }; return }
  if (method === 'publisherDirectories') return directoryPage(args[0], args[1])
  if (method === 'createPublisherDirectories') {
    creations.push(clone(args)); await delay(150)
    if (failCreate) { failCreate = false; throw Error('目录暂时无法创建') }
    if (pendingCreate) await pendingCreate
    let parentId = args[1]
    for (const name of args[2]) {
      let node = [...nodes.values()].find(n => n.parent === parentId && n.name === name)
      if (!node) { const id = String(++nextDirectoryId); node = { id, name, parent: parentId }; nodes.set(id, node) }
      parentId = node.id
    }
    return directoryPage(args[0], parentId)
  }
  throw Error(`Unexpected IPC ${method}`)
})
let preload = readFileSync(resolve('scripts/ui-flow-smoke-preload.cjs'), 'utf8')
  .replace("const { contextBridge } = require('electron')", "const { contextBridge, ipcRenderer } = require('electron')")
  .replace('const settings = {', `const settings = { ui: { sidebarCollapsed: false, providerOrder: [], hiddenProviders: [], recentSearches: [], defaultQuality: 'best', theme: 'dark', motion: false },`)
  .replace('Object.assign(settings, args[0]);', 'if (args[0].ui) args[0].ui = { ...settings.ui, ...args[0].ui }; Object.assign(settings, args[0]);')
  .replace('const cards = ', `state.plutofish = ${JSON.stringify(connection)};\nconst cards = `)
for (const method of ['publicationPreferences', 'savePublicationPreferences']) preload = preload.replace(new RegExp(`case '${method}':[^\\n]+`), `case '${method}': return ipcRenderer.invoke('manual-directory-smoke', method, ...args)`)
preload = preload.replace(/case 'namingPreview':[^\n]+/, "case 'namingPreview': return { folder: 'D:/GVS/Doctor X/Season 02', file: 'Doctor.X.S02E01.mkv', season: args[0].naming?.season ?? args[0].tmdbSeason ?? 2 }")
preload = preload.replace('switch (method) {', `switch (method) {
  case 'publisherDirectories': case 'createPublisherDirectories': return ipcRenderer.invoke('manual-directory-smoke', method, ...args)
  case 'publicationReleases': return { context: 'fixture', name: 'fixture', items: [], needsChoice: false }
  case 'tmdbSearch': return []
  case 'tmdbSeasons': return { seasons: [], warning: '' }
  case 'recognizePublication': return { canAutoFill: false, candidates: [], parsed: {} }
`)
const preloadPath = join(output, 'preload.cjs'); writeFileSync(preloadPath, preload)
const run = script => win.webContents.executeJavaScript(script)
const dom = selector => `document.querySelector(${JSON.stringify(selector)})`
async function wait(script) { const until = Date.now() + 12000; while (Date.now() < until) { if (await run(`!!(${script})`)) return; await delay(50) } throw Error(`Timeout: ${script}`) }
async function clickText(text, within = 'main') { const script = `Array.from(document.querySelectorAll(${JSON.stringify(within + ' button')})).find(e => e.textContent.trim() === ${JSON.stringify(text)})`; await wait(`${script} && !(${script}).disabled`); await run(`(${script}).click()`); await delay(80) }
async function open() {
  win = new BrowserWindow({ width: 1040, height: 900, show: false, webPreferences: { preload: preloadPath, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
  win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({ cancel: /^(https?|wss?):/i.test(details.url) }))
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  await win.loadFile(resolve('out/renderer/index.html')); await wait('window.__uiFlowFixture.snapshot().ready'); await run('(() => { const original = console.error; console.error = (...args) => original(...args.map(value => value?.stack || value)); })()'); await wait(dom('input[type=search]'))
  await run('(() => { const e = document.querySelector("input[type=search]"); e.value = "山海回声"; e.dispatchEvent(new Event("input", { bubbles: true })); e.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); })()')
  await wait(dom('button[aria-label="打开 山海回声"]')); await run(`${dom('button[aria-label="打开 山海回声"]')}.click()`)
  await wait(dom('button[aria-label^="第 1 集"]')); await run(`${dom('button[aria-label^="第 1 集"]')}.click()`); await clickText('选画质')
  await wait(dom('.publication-fields select:not(:disabled)')); await wait('document.querySelector(".publication-fields").textContent.includes("TMDB 123")')
}
async function chooseCreationParent(name) {
  await clickText('根目录', '.directory-dialog')
  const reads = calls.filter(c => c.method === 'publisherDirectories').length
  await clickText(name, '.directory-dialog .folders')
  assert.equal(calls.filter(c => c.method === 'publisherDirectories').length, reads, 'single selection must not browse')
  assert.equal(await run('document.querySelectorAll(".folder-select[aria-pressed=true]").length'), 1)
  await wait('document.querySelector(".directory-dialog [aria-label=完整创建路径]")')
}
async function changeSeason(number) {
  await run('document.querySelectorAll("details").forEach(e => e.open = true)'); await wait(dom('#manual-season'))
  await run(`(() => { const e = document.querySelector("#manual-season"); e.value = ${JSON.stringify(String(number))}; e.dispatchEvent(new Event("input", { bubbles: true })); })()`)
  await wait('document.querySelector(".create-work-directory button")?.textContent === "在网盘创建文件夹" && !document.querySelector(".create-work-directory button").disabled')
}
async function openCreation() {
  await clickText('在网盘创建文件夹')
  await wait('document.querySelector(".directory-dialog [aria-label=完整创建路径]")')
}
async function confirmed() {
  await clickText('确认创建', '.directory-dialog')
  await wait('!document.querySelector(".directory-dialog")')
  await wait('document.querySelector(".create-work-directory button")?.textContent === "文件夹已创建"'); await delay(100)
}
async function main() {
  await app.whenReady(); await open()
  await wait('document.querySelector("[aria-label=新建网盘路径]")?.textContent === "日韩剧集/Doctor X {tmdbid-123}/season 02"')
  const original = clone(preferences['source-a'].publication)
  await clickText('选择目录')
  await clickText('根目录', '.directory-dialog')
  const reads = calls.filter(c => c.method === 'publisherDirectories').length
  await clickText('其他位置', '.directory-dialog .folders')
  assert.equal(calls.filter(c => c.method === 'publisherDirectories').length, reads)
  assert.equal(await run('document.querySelector(".directory-dialog footer .selected").textContent'), '上传至：/其他位置')
  await run('document.querySelector(".folder-select[aria-pressed=true]").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))')
  await wait('document.querySelector(".directory-dialog .breadcrumbs").textContent.includes("其他位置")')
  assert.equal(calls.filter(c => c.method === 'publisherDirectories').length, reads + 1)
  await clickText('根目录', '.directory-dialog')
  await run(`document.querySelector('[aria-label="进入“发布资源”"]').click()`)
  await wait('document.querySelector(".directory-dialog .breadcrumbs").textContent.includes("发布资源")')
  assert.equal(calls.filter(c => c.method === 'publisherDirectories').length, reads + 3)
  await clickText('取消', '.directory-dialog')

  await openCreation()
  assert.equal(creations.length, 0, 'opening the parent browser must never create directories')
  await chooseCreationParent('其他位置')
  assert.equal(await run('document.querySelector(".directory-dialog [aria-label=完整创建路径]").textContent'), '/其他位置/日韩剧集/Doctor X {tmdbid-123}/season 02')
  await clickText('取消', '.directory-dialog'); await delay(100)
  assert.deepEqual(preferences['source-a'].publication, original, 'browsing and cancellation keep the upload destination and creation metadata')
  assert.equal(creations.length, 0)
  await openCreation(); await chooseCreationParent('其他位置')
  await delay(150); writeFileSync(join(output, 'create-parent-dialog.png'), (await win.webContents.capturePage()).toPNG())
  await run('(() => { const e = document.querySelector(".directory-dialog footer .primary"); e.click(); e.click(); })()')
  await wait('document.querySelector(".directory-dialog .create-output [role=alert]")')
  assert.equal(creations.length, 1, 'double confirmation creates one request')
  assert.deepEqual(preferences['source-a'].publication, original, 'failure keeps original upload destination and metadata')
  assert.equal(await run('document.querySelector(".directory-dialog [aria-label=完整创建路径]").textContent'), '/其他位置/日韩剧集/Doctor X {tmdbid-123}/season 02', 'failed create retains the chosen parent for retry')
  await confirmed()
  assert.deepEqual(creations.slice(0, 2), [0, 1].map(() => ['source-a', '300', ['日韩剧集', 'Doctor X {tmdbid-123}', 'season 02']]))
  const firstWorkId = preferences['source-a'].publication.directoryCreation.workDirectoryId
  assert.equal(preferences['source-a'].publication.directoryCreation.parentId, '300')
  await run('document.querySelector(".create-work-directory").scrollIntoView({ block: "center", behavior: "instant" })'); await delay(150)
  writeFileSync(join(output, 'created.png'), (await win.webContents.capturePage()).toPNG())
  await clickText('选择目录'); await clickText('保存到当前文件夹', '.directory-dialog'); await delay(100)
  assert.equal(preferences['source-a'].publication.directoryCreation.workDirectoryId, firstWorkId, 'same ID selection preserves the creation record')
  preferences['source-a'].tmdb = { ...tmdb, name: '新的译名' }
  win.destroy(); await open(); await wait('document.querySelector(".create-work-directory button").textContent === "文件夹已创建"')
  await run('(() => { const e = document.querySelector("select[aria-label=资源分类]"); e.value = "other"; e.dispatchEvent(new Event("change", { bubbles: true })); })()')
  await delay(100); assert.equal(creations.length, 2, 'title and category changes preserve the bound destination')
  await changeSeason(3); await openCreation()
  assert.equal(await run('document.querySelector(".directory-dialog [aria-label=完整创建路径]").textContent'), '/其他位置/日韩剧集/Doctor X {tmdbid-123}/season 03')
  await confirmed()
  assert.deepEqual(creations[2], ['source-a', firstWorkId, ['season 03']], 'default new season uses the existing work ID')
  assert.equal(preferences['source-a'].publication.directoryCreation.parentId, '300')
  await changeSeason(4); await delay(100)
  const beforeCancel = clone(preferences['source-a'].publication)
  await openCreation(); await chooseCreationParent('发布资源')
  assert.equal(await run('document.querySelector(".directory-dialog [aria-label=完整创建路径]").textContent'), '/发布资源/其他剧集/新的译名 {tmdbid-123}/season 04')
  await clickText('取消', '.directory-dialog'); await delay(100)
  assert.deepEqual(preferences['source-a'].publication, beforeCancel, 'new-season parent cancellation preserves the full prior creation binding')
  await openCreation(); await chooseCreationParent('发布资源')
  win.setContentSize(760, 820); await delay(150)
  assert.equal(await run('document.documentElement.scrollWidth > innerWidth + 1'), false)
  assert.equal(await run('(() => { const p = document.querySelector(".directory-dialog [aria-label=完整创建路径]").getBoundingClientRect(); const b = document.querySelector(".directory-dialog footer .primary").getBoundingClientRect(); return p.top >= 0 && p.bottom <= innerHeight && b.top >= 0 && b.bottom <= innerHeight; })()'), true)
  writeFileSync(join(output, 'parent-dialog-narrow.png'), (await win.webContents.capturePage()).toPNG())
  await confirmed()
  assert.deepEqual(creations[3], ['source-a', '100', ['其他剧集', '新的译名 {tmdbid-123}', 'season 04']], 'changed parent must use exactly the displayed full hierarchy')
  assert.equal(preferences['source-a'].publication.directoryCreation.parentId, '100')
  assert.notEqual(preferences['source-a'].publication.directoryCreation.workDirectoryId, firstWorkId)
  assert.equal(preferences['source-a'].publication.directoryPath, '/发布资源/其他剧集/新的译名 {tmdbid-123}/season 04')
  let release; pendingCreate = new Promise(r => { release = r })
  await changeSeason(5); await openCreation(); await clickText('确认创建', '.directory-dialog')
  assert.equal(await run('document.querySelector(".publication-fields select").disabled'), true)
  await run('(() => { const e = document.querySelector(".publication-fields select"); e.value = "source-b"; e.dispatchEvent(new Event("change", { bubbles: true })); })()')
  release(); await delay(300)
  await wait('document.querySelector(".publication-fields select").value === "source-b" && !document.querySelector(".publication-fields select").disabled')
  assert.equal(preferences['source-b'].publication.directoryId, '200', 'late A response must not change B destination')
  assert.deepEqual(errors, [])
  console.log('PASS: parent browsing/cancel without mutation, full preview, explicit confirmation, double-click dedupe, retry keeps selected parent, persistent binding, default next season, changed next-season parent, account race and narrow dialog')
}
main().catch(async e => { console.error(e); process.exitCode = 1; if (win) writeFileSync(join(output, 'failure.json'), JSON.stringify({ body: await run('document.body.innerText'), calls, errors }, null, 2)) }).finally(() => { win?.destroy(); rmSync(profile, { recursive: true, force: true }); app.exit(process.exitCode || 0) })
