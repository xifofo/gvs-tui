// Run from tui/: electron app/scripts/migu-search-smoke.cjs (hidden window).
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const assert = require('node:assert/strict')
const output = path.resolve(__dirname,'../../.build/migu-search-smoke')
fs.mkdirSync(output,{recursive:true})
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'gvs-migu-search-')))
app.disableHardwareAcceleration()
let win
async function main(){
  await app.whenReady()
  win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{preload:path.join(__dirname,'migu-search-smoke-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true}})
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^(https?|wss?):/i.test(d.url)}))
  const run = script => win.webContents.executeJavaScript(script)
  const wait = async script => {
    for(let i=0;i<100;i++){if(await run(script))return;await new Promise(r=>setTimeout(r,50))}
    throw Error('UI timed out: '+script)
  }
  const click = async label => {
    const expression=`Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===${JSON.stringify(label.replace(/ \d+$/,''))}||b.textContent.trim()===${JSON.stringify(label)})`
    await wait('!!('+expression+')');await run(expression+'.click()')
  }
  const capture = async name => {
    await run('document.fonts.ready');await new Promise(r=>setTimeout(r,650))
    for(let attempt=0;attempt<3;attempt++){
      win.webContents.invalidate();await new Promise(r=>setTimeout(r,250))
      try{fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage({stayHidden:true})).toPNG());return}catch(e){if(attempt===2)throw e}
    }
  }
  await win.loadFile(path.resolve(__dirname,'../out/renderer/index.html'))
  // The redesigned shell opens on 首页; Migu catalogs live under 发现 · 榜单.
  await click('发现 · 榜单')
  await wait("document.querySelectorAll('main .grid .item, main .ranklist .rl').length===1")
  assert(await run("!!document.querySelector('main button[aria-label=\"咪咕 App\"][aria-pressed=true]')"))
  await capture('app-recommendations')
  await click('咪咕 TV（咪视界）')
  await wait("document.querySelectorAll('main .grid .item, main .ranklist .rl').length===1&&document.querySelector('main button[aria-label=\"咪咕 TV（咪视界）\"][aria-pressed=true]')")
  let browsing=await run("window.miguSearchSmoke.calls().filter(c=>c.method==='browse').at(-1)")
  assert.equal(browsing.args[0],'migu');assert.equal(browsing.args[1].id,'tv:recommend');assert.equal(browsing.args[1].sourceTerminal,'tv')
  await capture('tv-recommendations')
  await click('电视剧')
  await wait("window.miguSearchSmoke.calls().some(c=>c.method==='browse'&&c.args[1].id==='tv:series')")
  await click('咪咕 App')
  await wait("window.miguSearchSmoke.calls().filter(c=>c.method==='browse').at(-1)?.args[1].id==='mobile:recommend'")
  browsing=await run("window.miguSearchSmoke.calls().filter(c=>c.method==='browse').at(-1)")
  assert.equal(browsing.args[1].sourceTerminal,'mobile')
  await wait("!!document.querySelector('input[type=search]')")
  await run(`(()=>{const input=document.querySelector('input[type=search]');input.value='伟大的长征';input.dispatchEvent(new Event('input',{bubbles:true}));input.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()`)
  // Unified search merges same-title works into one row; Migu App and Migu TV stay separate sources of that row.
  const rows="Array.from(document.querySelectorAll('main .list .card.row:not(.sk-row)'))"
  const srcLabels="Array.from(document.querySelectorAll('main .list .card.row:not(.sk-row) button.src')).map(s=>{const copy=s.cloneNode(true);copy.querySelectorAll('.plogo').forEach(e=>e.remove());return copy.textContent.replace(/\\s+/g,' ').trim()})"
  await wait(`${rows}.length===3&&!document.querySelector('main .status .spin')`)
  const allSources=await run(srcLabels)
  assert.equal(allSources.filter(s=>s.startsWith('咪咕 App')).length,2);assert.equal(allSources.filter(s=>s.startsWith('咪咕 TV（咪视界）')).length,1)
  const mergedRow=await run(`${rows}.find(r=>r.querySelector('.t').textContent.trim()==='伟大的长征')?.querySelectorAll('button.src').length`)
  assert.equal(mergedRow,2)
  await run("document.querySelector('main .fwrap > button').click()")
  await wait("document.querySelectorAll('main .fmenu .fm-i').length>0")
  const pills=await run("Array.from(document.querySelectorAll('main .fmenu .fm-i')).map(b=>b.querySelector('.fm-n').textContent.trim()+' '+b.querySelector('.fm-n').nextElementSibling.textContent.trim())")
  assert(pills.includes('咪咕 App 2'));assert(pills.includes('咪咕 TV（咪视界） 1'))
  assert(!pills.some(p=>p.startsWith('咪咕视频')))
  await capture('all-sources')
  for(const [source,expected,count,name] of [['咪咕 TV（咪视界）','tv-series:968082109',1,'tv'],['咪咕 App','968082110',2,'app']]){
    if(!(await run("!!document.querySelector('main .fmenu')")))await run("document.querySelector('main .fwrap > button').click()")
    await wait("!!document.querySelector('main .fmenu .fm-h button')")
    await run("document.querySelector('main .fmenu .fm-h button').click()")
    await run(`Array.from(document.querySelectorAll('main .fmenu .fm-i')).find(b=>b.querySelector('.fm-n').textContent.trim()===${JSON.stringify(source)}).click()`)
    await wait(`${rows}.length===${count}`)
    const labels=await run(srcLabels)
    assert(labels.length===count&&labels.every(s=>s.startsWith(source)))
    await run("document.querySelector('main .fwrap > button').click()")
    await capture(name+'-filtered')
    await run(`${rows}.find(r=>r.querySelector('.t').textContent.trim()==='伟大的长征').querySelector('button.src').click()`)
    await wait("document.querySelectorAll('main button[aria-label^=\"第 1 集\"]').length===1")
    const detail=await run("window.miguSearchSmoke.calls().filter(c=>c.method==='detail').at(-1)")
    assert.deepEqual(detail.args.slice(0,2),['migu',expected])
    assert((await run("document.querySelector('main .src')?.textContent")).includes(source))
    await capture(name+'-detail')
    if(name==='app'){
      await run("(()=>{const episode=document.querySelector('main button[aria-label^=\"第 1 集\"]');if(episode.getAttribute('aria-pressed')!=='true')episode.click()})()")
      await wait("!Array.from(document.querySelectorAll('main .foot button')).find(b=>b.textContent.trim()==='选画质')?.disabled")
      await click('选画质')
      await click('手动选择画质 / 音轨')
      await wait("document.querySelectorAll('main label.vcard.opt').length===12")
      const rows=await run("Array.from(document.querySelectorAll('main label.vcard.opt')).map(row=>row.innerText+' '+row.getAttribute('aria-label'))")
      assert.equal(rows.filter(row=>row.includes('2560×1066')).length,2)
      assert.equal(rows.filter(row=>row.includes('3840×1600')).length,2)
      assert(rows.every(row=>row.includes('00:45:25')))
      assert(rows.some(row=>row.includes('H.264'))&&rows.some(row=>row.includes('H.265')))
      assert(!(await run("document.querySelector('main').innerText")).includes('u121417'))
      await capture('app-rendition-table')
      await run("document.querySelectorAll('main label.vcard.opt input')[3].click()")
      await wait("window.miguSearchSmoke.calls().filter(c=>c.method==='namingPreview').at(-1)?.args[0].quality===3")
    }
    await click('返回')
    await wait("!!document.querySelector('main .fwrap > button')")
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,scope:'Built renderer with synthetic IPC; external network blocked; independent App/TV catalogs and exact App rendition rows, codec, size, resolution, duration and selected index verified.',pills,calls:await run('window.miguSearchSmoke.calls()')},null,2))
  app.exit(0)
}
main().catch(async e=>{
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:false,error:e.stack},null,2))
  if(win){
    try{const shot=await Promise.race([win.webContents.capturePage(),new Promise((_,reject)=>setTimeout(()=>reject(Error('capture timeout')),5000))]);fs.writeFileSync(path.join(output,'failure.png'),shot.toPNG())}catch{}
  }
  app.exit(1)
})
