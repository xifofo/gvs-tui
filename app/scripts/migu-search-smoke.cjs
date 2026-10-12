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
  await wait("document.querySelectorAll('main .list button.card').length===4")
  const pills=await run("Array.from(document.querySelectorAll('main button.pill')).map(b=>{const copy=b.cloneNode(true);copy.querySelectorAll('.plogo').forEach(e=>e.remove());return copy.textContent.replace(/\\s+/g,' ').trim()})")
  assert(pills.includes('咪咕 App 2'));assert(pills.includes('咪咕 TV（咪视界） 1'))
  assert(!pills.some(p=>p.startsWith('咪咕视频')))
  await capture('all-sources')
  for(const [label,expected,count,name] of [['咪咕 TV（咪视界） 1','tv-series:968082109',1,'tv'],['咪咕 App 2','968082110',2,'app']]){
    await click(label)
    await wait(`document.querySelectorAll('main .list button.card').length===${count}`)
    const labels=await run("Array.from(document.querySelectorAll('main .list button.card .src')).map(s=>{const copy=s.cloneNode(true);copy.querySelectorAll('.plogo').forEach(e=>e.remove());return copy.textContent.trim()})")
    assert(labels.every(s=>s===(name==='tv'?'咪咕 TV（咪视界）':'咪咕 App')))
    await capture(name+'-filtered')
    await run("document.querySelector('main .list button.card').click()")
    await wait("document.querySelectorAll('button[aria-label^=\"第 \"]').length===1")
    const detail=await run("window.miguSearchSmoke.calls().filter(c=>c.method==='detail').at(-1)")
    assert.deepEqual(detail.args.slice(0,2),['migu',expected])
    assert((await run("document.querySelector('main .src')?.textContent")).includes(name==='tv'?'咪咕 TV（咪视界）':'咪咕 App'))
    await capture(name+'-detail')
    await click('搜索')
    await wait("!!document.querySelector('main button.pill')")
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,scope:'Built renderer with synthetic IPC; external network blocked; independent App/TV recommendations, category switches, search counts, filtering, labels and detail IDs verified.',pills,calls:await run('window.miguSearchSmoke.calls()')},null,2))
  app.exit(0)
}
main().catch(async e=>{
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:false,error:e.stack},null,2))
  if(win){
    try{const shot=await Promise.race([win.webContents.capturePage(),new Promise((_,reject)=>setTimeout(()=>reject(Error('capture timeout')),5000))]);fs.writeFileSync(path.join(output,'failure.png'),shot.toPNG())}catch{}
  }
  app.exit(1)
})
