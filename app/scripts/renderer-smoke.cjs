const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const output = path.resolve(__dirname,'../../.build/electron-smoke')
fs.mkdirSync(output,{recursive:true})
app.setPath('userData',path.join(os.tmpdir(),'gvs-render-smoke-'+process.pid))
app.disableHardwareAcceleration()
async function main(){
  await app.whenReady()
  const win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{preload:path.join(__dirname,'renderer-smoke-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true}})
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}))
  win.webContents.on('console-message', (...args) => { const message = args[0]?.message || args[2]; fs.appendFileSync(path.join(output,'console.log'),String(message)+String.fromCharCode(10)) })
  const run=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){fs.writeFileSync(path.join(output,'failure.png'),(await win.webContents.capturePage()).toPNG());throw e}}
  const sleep=ms=>new Promise(r=>setTimeout(r,ms))
  async function click(text){await check(text);await sleep(150);await run('('+function(text){const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===text);if(!b)throw Error('Missing button: '+text);b.click()}.toString()+')('+JSON.stringify(text)+')');await sleep(250)}
  async function check(text){for(let i=0;i<60;i++){if(await run('document.body.innerText.includes('+JSON.stringify(text)+')'))return;await sleep(50)}throw Error('Missing UI text: '+text)}
  async function capture(name){fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage()).toPNG())}
  await win.loadFile(path.resolve(__dirname,'../out/renderer/index.html'))
  await check('GVS');await click('设置');await click('平台账号');await check('HamiVideo · 独立 Web / TV 会话')
  await capture('accounts-tv.png');await click('获取激活码');await check('MOCK-1234')
  await run('('+function(){const s=Array.from(document.querySelectorAll('select')).find(e=>Array.from(e.options).some(o=>o.value==='web'));s.value='web';s.dispatchEvent(new Event('change',{bubbles:true}))}.toString()+')()')
  await check('准备短信登录（不发码）');await check('MOCK-1234');await click('准备短信登录（不发码）');await capture('accounts-web.png')
  await click('风控处理日志');await check('停止当前流程');await check('Electron 本地观测');await capture('tencent-diagnostics.png')
  await click('下载');await click('腾讯诊断');await check('腾讯诊断 · 任务 7');await capture('tencent-job-diagnostics.png')
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,scope:'Built renderer with synthetic IPC; network blocked; no real login, SMS or license'},null,2))
  app.exit(0)
}
main().catch(e=>{fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:false,error:e.message},null,2));app.exit(1)})
