// Isolated renderer fixture: no user profile, network, download or cloud writes.
import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const profile = mkdtempSync(join(tmpdir(), 'gvs-upload-ui-'))
app.setPath('userData', profile)
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const output = resolve('../.build/upload-progress')
mkdirSync(output, { recursive: true })
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
let win: BrowserWindow | undefined

async function main() {
  await app.whenReady()
  let preload = readFileSync(resolve('scripts/ui-flow-smoke-preload.cjs'), 'utf8')
  const start = preload.indexOf('let jobs ='), end = preload.indexOf('const update =', start)
  preload = preload.slice(0, start) + `
const progress = stage => ({ stage, phase: 'uploading', downloadPercent: 100, uploadPercent: stage === 'completed' ? 100 : 35, uploadedBytes: stage === 'completed' ? 104857600 : 36700160, sizeBytes: 104857600, transfer: stage === 'uploading' ? { sentBytes: 41943040, bytesPerSecond: 2097152, etaSeconds: 30, rateLimit: 10485760 } : undefined, error: stage === 'failed' ? 'PlutoFish 上报失败（HTTP 503）' : '', synced: true });
let jobs = ['missing', 'uploading', 'paused', 'failed'].map((stage, i) => ({
 id: i + 1, groupId: 'upload-' + i, groupTitle: ['此处通往繁星', '远方来信', '长风入海', '山间小路'][i], provider: 'youku', poster: '', label: 'S01E01', quality: '1080P', status: '完成', pct: 1, log: '', err: '', note: '', state: 'done', output: '/Downloads/Example.2026.S01E01.mp4', createdAt: Date.now(), finishedAt: Date.now(),
 publication: { schemaVersion: 1, title: '测试作品', binding: { url: 'https://example.com', publisherId: 'pub', sourceAccount: { id: 'source', alias: 'drive-b657a1c844bd9ecb091e71d4aeec0664' } }, workTarget: { mediaType: 'tv', tmdbId: '296203', category: stage === 'missing' ? '' : 'tv' }, directoryPath: '/最近接收/仿生迷踪 (2026) (tmdb-339629)/' + '很长的上传目录'.repeat(10), directoryId: '123', categoryLabel: '电视剧', fileKey: 'fixture-' + i, releaseKey: 'fixture-r', kind: 'video', output: '/Downloads/Example.2026.S01E01.mp4', updatedAt: '', seasonNumber: 1, episodeNumber: 1, measured: { file: { size: 104857600 }, media: { status: 'probed', width: 1920, height: 1080, codec: 'hevc' } }, ...(stage === 'missing' ? {} : { progress: progress(stage) }) }
})).reverse();
let categoryReads = 0;
state.plutofish = { url: 'https://example.com', hasKey: true, status: 'verified', error: '', uploadNotice: '服务端尚未声明支持双文件上传，已使用单文件兼容模式；其他文件仍会提前准备。', identity: { id: 'pub', kind: 'publisher', name: 'Fixture', sourceAccount: { id: 'source', alias: 'main', name: '测试源' } } };
` + preload.slice(end)
  preload = preload.replace('  snapshot,', `  snapshot,
  uploadStage(id, stage) { const job = jobs.find(j => j.id === id); job.publication.progress = progress(stage); emit('jobPatch', [job]) },
  downloadStage(id, done) {
    const job = jobs.find(j => j.id === id); job.state = done ? 'done' : 'running'; job.status = done ? '完成' : '下载中'; job.pct = done ? 1 : .67;
    job.publication.progress = progress(done ? 'uploading' : 'downloading'); emit('jobPatch', [job]);
  },
  prepareLargeQueue() {
    jobs = jobs.filter(j => j.id < 1000);
    const history = Array.from({ length: 6000 }, (_, i) => ({
      id: 1000 + i, groupId: 'history-' + Math.floor(i / 10), groupTitle: '历史任务 ' + Math.floor(i / 10), provider: 'youku', poster: '', label: 'S01E' + String(i % 10 + 1).padStart(2, '0'), quality: '2160P HDR HEVC 60fps', status: '完成', pct: 1, log: '', err: '', note: '', state: 'done',
      output: '/Downloads/历史任务 (2026)/Season 01/Example.Series.2026.S01E01.2160p.WEB-DL.HDR.HEVC.DDP5.1-GVS.mkv', createdAt: 1, finishedAt: 2,
    }));
    for (const job of history.slice(-6)) { job.state = 'running'; job.status = '下载中'; job.pct = 0.98; job.finishedAt = 0 }
    jobs = history.concat(jobs); emit('jobs', jobs);
  },
  async streamProgress(mode) {
    const upload = jobs.find(j => j.id === 2), completing = jobs.filter(j => j.id >= 1000 && j.state === 'running');
    let payloadBytes = 0;
    for (let i = 0; i < 30; i++) {
      upload.publication.progress = progress('uploading');
      upload.publication.progress.transfer.sentBytes = 41943040 + i * 1048576;
      const changes = [upload];
      if (i % 5 === 0) {
        const job = completing[i / 5]; job.state = 'done'; job.status = '完成'; job.pct = 1; job.finishedAt = Date.now(); changes.push(job);
        emit('toast', { message: job.groupTitle + ' ' + job.label + ' 下载完成', tone: 'ok' });
      }
      const payload = mode === 'jobs' ? jobs : changes;
      payloadBytes += new TextEncoder().encode(JSON.stringify(payload)).length;
      emit(mode, payload);
      await delay(120);
    }
    return { mode, jobs: jobs.length, completed: completing.filter(j => j.state === 'done').length, payloadBytes };
  },`)
  preload = preload.replace("      case 'enqueue': {", `      case 'refreshPublicationCategories': {
        await delay(100);
        state.plutofish.identity.categories = ++categoryReads === 1 ? [] : [{ value: 'cn-series', label: '国产剧集' }, { value: 'asian-series', label: '日韩剧集' }, { value: 'western-series', label: '欧美剧集' }, { value: 'anime', label: '动画番剧' }];
        emit('state', state); return clone(state.plutofish);
      }
      case 'choosePublicationFile': return { token: 'selected-file', path: '/Downloads/已改名/Custom.Name.S00E151.1080p.WEB-DL-WF.mkv', name: 'Custom.Name.S00E151.1080p.WEB-DL-WF.mkv', size: 104857600, seasonNumber: 0, episodeNumber: 151, numbersFromName: true, canEditNumbers: true };
      case 'relinkPublicationFile': {
        const job = jobs.find(j => j.id === args[0]);
        job.output = '/Downloads/已改名/Custom.Name.S00E151.1080p.WEB-DL-WF.mkv'; job.publication.output = job.output;
        job.publication.seasonNumber = args[2].seasonNumber; job.publication.episodeNumber = args[2].episodeNumber;
        job.label = 'S00E151'; emit('jobPatch', [job]); return;
      }
      case 'completePublicationSetup': {
        const job = jobs.find(j => j.id === args[0]); job.publication.workTarget.category = args[1]; job.publication.progress = progress('uploading'); emit('jobs', jobs); return
      }
      case 'controlPublication': { jobs.find(j => j.id === args[0]).publication.progress = progress(args[1] === 'pause' ? 'paused' : 'uploading'); emit('jobs', jobs); return }
      case 'enqueue': {`)
  const path = join(output, 'preload.cjs')
  writeFileSync(path, preload)
  for (const width of [1440, 1280, 760]) {
    const errors: string[] = []
    win = new BrowserWindow({ width, height: 1000, show: false, useContentSize: true, webPreferences: { preload: path, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false, partition: `upload-${width}` } })
    win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({ cancel: /^(https?|wss?):/.test(details.url) }))
    win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
    const run = (code: string) => win!.webContents.executeJavaScript(code)
    async function wait(code: string) {
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) { if (await run(`!!(${code})`)) return; await delay(80) }
      writeFileSync(join(output, 'failure.json'), JSON.stringify({ code, errors, body: await run('document.body.innerText') }, null, 2))
      throw new Error(`Timeout: ${code}`)
    }
    const clickText = async (text: string, root = 'main') => {
      const code = `Array.from(document.querySelectorAll(${JSON.stringify(root + ' button')})).find(e => e.textContent.trim() === ${JSON.stringify(text)})`
      await wait(code); await run(`(${code}).click()`); await delay(100)
    }
    await win.loadFile(resolve('out/renderer/index.html'))
    await run(`document.documentElement.classList.remove('light', 'dark'); document.documentElement.classList.add('${width === 760 ? 'dark' : 'light'}')`)
    await wait('window.__uiFlowFixture.snapshot().ready')
    await run('Array.from(document.querySelectorAll(".side button")).find(e => e.textContent.trim().startsWith("下载"))?.click()')
    await wait('document.querySelectorAll(".upload-progress").length === 4')
    await wait('document.body.innerText.includes("暂无可用资源分类")')
    assert.equal(await run('document.querySelector("select[aria-label=补全资源分类]").disabled'), true)
    await clickText('刷新')
    await wait('document.querySelectorAll("select[aria-label=补全资源分类] option").length === 5')
    assert.deepEqual(await run('Array.from(document.querySelectorAll("select[aria-label=补全资源分类] option")).slice(1).map(e => e.textContent)'), ['国产剧集', '日韩剧集', '欧美剧集', '动画番剧'])
    assert.equal(await run('document.querySelector("select[aria-label=补全资源分类]").required'), true)
    assert.equal(await run('Array.from(document.querySelectorAll("button")).find(e => e.textContent.trim() === "补全并上传").disabled'), true)
    assert.ok(await run('document.body.innerText.includes("待补全资源分类")'))
    const originalPath = await run('window.__uiFlowFixture.snapshot().jobs.find(job => job.id === 1).output')
    const relink = 'Array.from(document.querySelectorAll(".upload-progress")).find(card => card.textContent.includes("待补全资源分类")).querySelector(".upload-file button")'
    await run(`(${relink}).click()`)
    await wait('document.querySelector(".file-choice")')
    assert.equal(await run('document.querySelector("input[aria-label=新文件发布季号]").value'), '0')
    assert.equal(await run('document.querySelector("input[aria-label=新文件发布集号]").value'), '151')
    assert.equal(await run('Array.from(document.querySelectorAll("button")).find(e => e.textContent.trim() === "补全并上传").disabled'), true)
    await clickText('取消', '.file-choice')
    assert.equal(await run('window.__uiFlowFixture.snapshot().jobs.find(job => job.id === 1).output'), originalPath)
    await run(`(${relink}).click()`)
    await wait('document.querySelector(".file-choice")')
    await run('document.querySelector(".file-choice").scrollIntoView({block:"center"})')
    await run('document.fonts.ready')
    writeFileSync(join(output, `relink-confirm-${width}.png`), (await win.webContents.capturePage()).toPNG())
    await clickText('确认使用此文件', '.file-choice')
    await wait('!document.querySelector(".file-choice")')
    assert.equal(await run('window.__uiFlowFixture.snapshot().jobs.find(job => job.id === 1).output'), '/Downloads/已改名/Custom.Name.S00E151.1080p.WEB-DL-WF.mkv')
    assert.equal(await run('window.__uiFlowFixture.snapshot().calls.filter(call => ["completePublicationSetup", "controlPublication", "enqueue"].includes(call.method)).length'), 0, '重新关联不能自动上传或下载')
    assert.ok(await run('document.querySelector(".upload-progress.pending .upload-file").textContent.includes("Custom.Name.S00E151")'))

    assert.ok(await run('document.body.innerText.includes("40.0%") && document.body.innerText.includes("40.0 MB / 100 MB")'))
    assert.ok(await run('document.body.innerText.includes("2.00 MB/s") && document.body.innerText.includes("约 30 秒") && document.body.innerText.includes("账号共享上限 10.00 MB/s")'))
    assert.ok(await run('document.querySelector(".upload-progress.failed [role=alert]").textContent.trim().length > 0'))
    assert.ok(await run('document.querySelector(".upload-progress").textContent.includes("单文件兼容模式")'))
    await run('document.fonts.ready.then(() => true)')
    await delay(100)
    const overflow = await run(`Array.from(document.querySelectorAll('.upload-progress')).flatMap(card => {
      const outer = card.getBoundingClientRect();
      return Array.from(card.querySelectorAll('.upload-heading, .upload-heading .mono, .upload-meta, .upload-meta span, .progress')).filter(el => {
        const rect = el.getBoundingClientRect(); return rect.left < outer.left || rect.right > outer.right;
      }).map(el => el.className || el.tagName);
    })`)
    assert.deepEqual(overflow, [], 'Upload percentage, metadata and track must stay inside the card')
    assert.equal(await run('document.querySelectorAll(".job > .bar").length'), 0, 'The old standalone download progress column is removed')
    assert.ok(await run(`Array.from(document.querySelectorAll('.job')).every(job => {
      const panel = job.querySelector('.job-progress'), buttons = job.querySelector('.ja');
      return panel.getBoundingClientRect().right >= buttons.getBoundingClientRect().right - 1 && panel.querySelectorAll('[role=progressbar]').length <= 1;
    })`), 'One current-stage panel must span the information and action columns')
    writeFileSync(join(output, `uploads-${width}.png`), (await win.webContents.capturePage()).toPNG())
    await run('Array.from(document.querySelectorAll(".upload-progress")).find(e => e.querySelector(".upload-speed"))?.scrollIntoView({ block: "center" })')
    await delay(100)
    writeFileSync(join(output, `upload-speed-${width}.png`), (await win.webContents.capturePage()).toPNG())
    assert.equal(await run('document.documentElement.scrollWidth > innerWidth + 1'), false)
    await run('window.__uiFlowFixture.downloadStage(2, false)')
    await wait('document.querySelector(".download-progress [role=progressbar]")?.getAttribute("aria-valuenow") === "67"')
    assert.equal(await run('document.querySelector(".download-progress").closest(".job").querySelectorAll("[role=progressbar]").length'), 1)
    assert.ok(await run('document.querySelector(".download-progress").textContent.includes("下一步：上传")'))
    await run('window.__uiFlowFixture.downloadStage(2, true)')
    await wait('!document.querySelector(".download-progress") && document.querySelectorAll(".upload-progress").length === 4')
    assert.ok(await run('Array.from(document.querySelectorAll(".upload-progress")).some(panel => panel.textContent.includes("下载已完成") && panel.textContent.includes("40.0%"))'))
    await run('Array.from(document.querySelectorAll(".filters button")).find(e => e.textContent.startsWith("进行中")).click()')
    await wait('document.querySelectorAll(".upload-progress").length === 1')
    assert.ok(await run('document.querySelector(".upload-progress").textContent.includes("上传中")'))
    await run('Array.from(document.querySelectorAll(".filters button")).find(e => e.textContent.startsWith("待处理")).click()')
    await wait('document.querySelector("select[aria-label=补全资源分类]")')
    await run('(() => { const el = document.querySelector("select[aria-label=补全资源分类]"); el.value = "cn-series"; el.dispatchEvent(new Event("change", { bubbles: true })) })()')
    await clickText('补全并上传')
    await wait('!document.querySelector("select[aria-label=补全资源分类]")')
    assert.equal(await run('window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "completePublicationSetup").length'), 1)
    assert.equal(await run('window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "enqueue").length'), 0)
    await run('Array.from(document.querySelectorAll(".filters button")).find(e => e.textContent.startsWith("全部")).click()')
    await wait('document.querySelectorAll(".upload-progress").length === 4')
    await clickText('暂停上传')
    assert.ok(await run('window.__uiFlowFixture.snapshot().calls.some(c => c.method === "controlPublication" && c.args[1] === "pause")'))
    await clickText('继续上传')
    assert.ok(await run('window.__uiFlowFixture.snapshot().calls.some(c => c.method === "controlPublication" && c.args[1] === "resume")'))
    await run('window.__uiFlowFixture.uploadStage(1, "completed")')
    await wait('document.querySelectorAll(".upload-progress").length === 3')
    if (width === 1280) {
      const metrics = []
      for (const mode of ['jobs', 'jobPatch']) {
        await run('window.__uiFlowFixture.prepareLargeQueue()')
        await delay(400)
        await run(`(() => {
          const frames = [], tasks = []; let frame, last = performance.now();
          const loop = now => { frames.push(now - last); last = now; frame = requestAnimationFrame(loop) };
          frame = requestAnimationFrame(loop);
          const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)));
          observer.observe({ type: 'longtask' });
          window.__stopMeasure = () => { cancelAnimationFrame(frame); observer.disconnect(); frames.sort((a,b) => a-b); return { frames: frames.length, p95FrameMs: frames[Math.floor(frames.length * .95)], maxFrameMs: Math.max(...frames), longTasks: tasks.length, longestTaskMs: Math.max(0, ...tasks) } };
        })()`)
        const traffic = await run(`window.__uiFlowFixture.streamProgress(${JSON.stringify(mode)})`)
        await delay(100)
        metrics.push({ ...traffic, ...await run('window.__stopMeasure()') })
        assert.equal(traffic.completed, 6)
        assert.ok(await run('document.querySelectorAll(".toast").length > 0'))
      }
      assert.ok(metrics[1].payloadBytes < metrics[0].payloadBytes / 100)
      writeFileSync(join(output, 'performance.json'), JSON.stringify(metrics, null, 2))
      console.log(JSON.stringify(metrics))
    }
    assert.deepEqual(errors, [])
    win.destroy(); win = undefined
  }
  console.log('PASS: One full-width download/upload panel, phase transitions, long metadata bounds, category repair, pause/resume and completion patches at 1440, 1280 and 760 px')
}

void main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  win?.destroy()
  rmSync(profile, { recursive: true, force: true })
  app.exit(process.exitCode ?? 0)
})
