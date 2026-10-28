/** 真实下载页及订阅编辑页回归：仅使用 recognition-smoke 的临时 Core 和回环服务。 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

/** 开启自动上传且已填写命名时，显式搜索仍发起请求；错误、空结果与偏好回读分别验收。 */
export async function runTmdbSearchUI(win: BrowserWindow, output: string) {
  const run = (code: string) => win.webContents.executeJavaScript(code, true)
  const checks: string[] = []
  async function wait(code: string) {
    for (let i = 0; i < 200; i++) {
      if (await run(code)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error(`TMDB UI 超时：${code}\n${await run('document.body.innerText')}`)
  }
  async function check(label: string, code: string) { assert.equal(await run(code), true, label); checks.push(label) }
  async function click(selector: string) {
    await wait(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`)
    await run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }
  async function openQuality() {
    await run('[...document.querySelectorAll("nav button")].find(b => b.textContent.includes("发现")).click()')
    await click('main button.item'); await click('button[aria-label^="第 1 集"]'); await click('.eps .foot button.primary')
    await wait('!!document.querySelector(".output-settings .match")')
  }
  const calls = `window.__uiFlowFixture.snapshot().calls`
  const searches = `${calls}.filter(c => c.method === 'tmdbSearch')`
  const lastSave = `${calls}.filter(c => c.method === 'savePublicationPreferences').at(-1)`
  await wait('window.__uiFlowFixture?.snapshot().ready')
  await openQuality()
  await wait('document.querySelector(".publication-recognition").textContent.includes("未识别到作品")')
  await check('自动识别路径未搜索时不宣称没有条目', `${searches}.length === 0 && !document.querySelector('.output-settings').textContent.includes('未找到 TMDB 条目')`)
  await run(`{ const input = document.querySelector('#output-title'); input.value = '保留的手动标题'; input.dispatchEvent(new Event('input', { bubbles: true })); }`)
  await click('.output-settings .match .linkish')
  await wait('document.querySelector(".output-settings .match")?.textContent.includes("后会友期 (2026)")')
  await check('已有手动命名时搜索仍找到正确作品', `${searches}.length === 1`)
  await wait('!document.querySelector(".resource-category select").disabled')
  await run(`{ const select = document.querySelector('.resource-category select'); select.value = 'anime'; select.dispatchEvent(new Event('change', { bubbles: true })); }`)
  await wait(`${lastSave}?.args[0].tmdb?.id === 338938`)
  await openQuality()
  await wait('document.querySelector(".output-settings .match")?.textContent.includes("后会友期 (2026)")')
  await check('已保存作品自动恢复且没有重复搜索', `${searches}.length === 1`)
  await click('.output-settings .match .linkish')
  await wait('document.querySelector(".output-settings .warn-box")?.textContent.includes("请求过于频繁")')
  await check('恢复偏好后仍可发起搜索并显示请求失败', `${searches}.length === 2`)
  await click('.output-settings .warn-box .linkish')
  await wait('document.querySelector(".output-settings .match")?.textContent.includes("未找到 TMDB 条目")')
  await check('失败重试确实请求且只有真实空结果显示未找到', `${searches}.length === 3`)
  await click('.output-settings .match .linkish')
  await wait('document.querySelector(".output-settings .match")?.textContent.includes("后会友期 (2026)")')
  await check('空结果重试后恢复正确匹配', `${searches}.length === 4`)
  await wait('!!document.querySelector(".filename-preview") && !document.querySelector(".output-preview").classList.contains("pending") && !document.querySelector(".publication-grid").textContent.includes("正在匹配")')
  await run('document.querySelector(".output-card.output-options").scrollIntoView({ block: "start" })')
  writeFileSync(join(output, 'tmdb-search.png'), (await win.webContents.capturePage()).toPNG())
  await check('搜索区域无横向溢出', 'document.documentElement.scrollWidth <= innerWidth')
  writeFileSync(join(output, 'tmdb-search.json'), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(`TMDB 手动搜索 UI 验证通过：${checks.length} 项`)
}

export async function runRecognitionUI(win: BrowserWindow, output: string, dark: boolean) {
  const run = (code: string) => win.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`${code}\n${error.message}`) })
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const checks: string[] = []
  const errors: string[] = []
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  async function wait(code: string, label = code) {
    const end = Date.now() + 10000
    while (Date.now() < end) { if (await run(code)) return; await sleep(40) }
    throw new Error(`UI 超时：${label}\n${await run('document.body.innerText')}`)
  }
  async function click(selector: string) {
    await wait(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`)
    await run(`{ const element = document.querySelector(${JSON.stringify(selector)}); for (let p = element.parentElement; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true; element.scrollIntoView({ block: 'center' }); element.click(); }`)
    await sleep(80)
  }
  async function input(selector: string, value: string, event = 'input') {
    await wait(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`)
    await run(`{ const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true })); }`)
    await sleep(60)
  }
  async function check(label: string, code: string) {
    assert.equal(await run(code), true, label); checks.push(label)
  }
  const candidate = (index: number) => `.recognition-candidate:nth-child(${index + 1})`
  const confirm = '.candidate-confirmation > button'
  const category = '.resource-category select'
  const lastSave = `window.__uiFlowFixture.snapshot().calls.filter(c => c.method === 'savePublicationPreferences').at(-1)`
  async function recognize(name: string) {
    await input('#publication-recognition-file', name)
    await click('.publication-recognition .input-action button')
    await wait('document.querySelectorAll(".recognition-candidate").length === 3')
  }
  async function capture(name: string) {
    await run(`document.querySelector('.candidate-confirmation').scrollIntoView({block:'center'})`)
    await sleep(150)
    writeFileSync(join(output, `${name}-${dark ? 'dark' : 'light'}.png`), (await win.webContents.capturePage()).toPNG())
    await check(`${name} 无横向溢出`, 'document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll(".publication-recognition, .candidate-confirmation")].every(e => e.scrollWidth <= e.clientWidth + 1)')
  }

  await wait('window.__uiFlowFixture?.snapshot().ready')
  await run('[...document.querySelectorAll("nav button")].find(b => b.textContent.includes("发现")).click()')
  await click('main button.item')
  await click('button[aria-label^="第 1 集"]')
  await click('.eps .foot button.primary')
  await wait(`${lastSave}?.args[0].tmdb?.id === 123`)
  await check('原有明确识别仍自动回填', `${lastSave}.args[1].category === 'anime'`)

  await recognize('Ambiguous.mkv')
  await check('歧义不会自动覆盖已有作品', `${lastSave}.args[0].tmdb.id === 123`)
  await check('候选截断提示', 'document.querySelector(".publication-recognition").textContent.includes("仅展示部分候选")')
  await click(candidate(1))
  await check('只选中候选不回填', `${lastSave}.args[0].tmdb.id === 123`)
  await check('显示年份冲突与原名', 'document.querySelector(".candidate-confirmation").textContent.includes("年份不一致") && document.querySelector(".recognition-candidates").textContent.includes("Stars: Homecoming")')
  await capture('candidate-movie')
  await click(confirm)
  await wait(`${lastSave}?.args[0].tmdb?.id === 456`)
  await check('电影候选回填类型年份并清除季号', `${lastSave}.args[0].kind === 'movie' && ${lastSave}.args[0].tmdb.year === 2025 && ${lastSave}.args[0].naming.season === undefined`)

  for (const mode of ['Range', 'Missing']) {
    await recognize(`Ambiguous${mode}.mkv`)
    await click(candidate(2))
    await check(`${mode} 不猜季号且禁止确认`, 'document.querySelector("[aria-label=候选季号]").value === "" && document.querySelector(".candidate-confirmation > button").disabled')
  }
  await input('[aria-label="候选季号"]', '0')
  await click(confirm)
  await wait('document.querySelector("#manual-season")?.value === "0"')
  await check('未匹配分类不继承旧分类', 'document.querySelector(".resource-category select").value === ""')
  await input(category, 'manual', 'change')
  await wait(`${lastSave}?.args[0].tmdb?.id === 789 && ${lastSave}?.args[1].category === 'manual'`)
  await check('补分类后保存特别篇及新作品', `${lastSave}.args[0].naming.season === 0`)

  await recognize('AmbiguousSpecial.mkv')
  await click(candidate(0))
  await check('解析特别篇零正确保留', 'document.querySelector("[aria-label=候选季号]").value === "0"')
  await capture('candidate-tv')
  await click(confirm)
  await wait(`${lastSave}?.args[0].tmdb?.id === 123 && ${lastSave}?.args[0].naming?.season === 0`)
  await check('候选确认不修改所选平台集号', 'window.__uiFlowFixture.snapshot().calls.filter(c => c.method === "namingPreview").at(-1).args[0].episodes.map(e => e.number).join(",") === "1"')
  await input('#manual-season', '7')
  await recognize('AmbiguousSpecial.mkv')
  await click(candidate(0)); await click(confirm)
  await wait(`${lastSave}?.args[0].naming?.season === 0`)
  await check('同作品重新确认也覆盖旧季号', 'document.querySelector("#manual-season").value === "0"')

  await input('#publication-recognition-file', 'SlowAmbiguous.mkv')
  await click('.publication-recognition .input-action button')
  await input('.publication-fields > .field select', 'second', 'change')
  await sleep(900)
  await check('切换账号后旧候选失效', 'document.querySelectorAll(".recognition-candidate").length === 0')
  await recognize('Ambiguous.mkv')
  await click(candidate(0))
  await input('#publication-recognition-file', 'Edited.mkv')
  await check('修改识别文件名清空候选', '!document.querySelector(".candidate-confirmation")')

  await run('[...document.querySelectorAll("nav button")].find(b => b.textContent.trim() === "订阅").click()')
  await click('button[aria-label="编辑"]')
  await wait('!!document.querySelector("[aria-label=编辑订阅] #publication-recognition-file")')
  await recognize('AmbiguousSpecial.mkv')
  await click(candidate(0)); await click(confirm)
  await check('订阅编辑同样采用候选与季号', 'document.querySelector("[aria-label=编辑订阅]").textContent.includes("TMDB 123") && [...document.querySelectorAll("[aria-label=编辑订阅] label")].find(e => e.textContent.startsWith("输出季号")).querySelector("input").value === "0"')
  await run('[...document.querySelectorAll("[aria-label=编辑订阅] button")].find(b => b.textContent.trim() === "保存").click()')
  await wait('!document.querySelector("[aria-label=编辑订阅]")')
  await check('订阅保存完整发布偏好', `${lastSave}.args[0].tmdb.id === 123 && ${lastSave}.args[0].naming.season === 0 && ${lastSave}.args[1].category === 'anime'`)
  assert.deepEqual(errors, [], '渲染进程错误')
  writeFileSync(join(output, `ui-${dark ? 'dark' : 'light'}.json`), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(`识别候选 UI 验证通过：${checks.length} 项（${dark ? '窄窗口暗色' : '普通浅色'}）`)
}
