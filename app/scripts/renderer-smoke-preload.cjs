const { contextBridge } = require('electron')
const handlers = new Map()
const providers = ['youku','tencent','hongguo','huangguo','douyin','mewatch','hamivideo']
const settings = {host:'https://gateway.example.invalid',keyMasked:'mock-only',hasKey:true,outDir:'C:/mock-downloads',tmpDir:'',releaseGroup:'TEST',tmdbKey:'',tmdbLang:'zh-CN',threads:4,tencentCookie:'',douyinCookie:'',hongguoNfo:true,huangguoNfo:true,hongguoFmt:'mkv',huangguoFmt:'mkv',tencentObservations:false,hamiClient:'tv'}
const state = {configured:true,connecting:false,keyName:'Offline smoke fixture',keyError:'',providers,tunnel:{ok:true,err:'',enabled:true},accounts:providers.map(provider=>({provider,short:'待检查',summary:'离线模拟，不连接真实账号',tone:'muted'})),settings,tools:[],version:'smoke',platform:'win32'}
const clone = v => JSON.parse(JSON.stringify(v))
contextBridge.exposeInMainWorld('gvs',{
  on(event,cb){const list=handlers.get(event)||[];list.push(cb);handlers.set(event,list);return()=>{}},
  async call(method,...args){
    if(method==='state')return clone(state)
    if(method==='jobs')return [{id:7,groupId:'g1',groupTitle:'离线诊断样例',provider:'tencent',poster:'',label:'EP01',quality:'1080',status:'失败',pct:0,log:'',err:'已停止',note:'',state:'failed',output:'',createdAt:0,finishedAt:0}]
    if(method==='updateState')return {status:'idle',version:'smoke',message:'离线测试',auto:false}
    if(method==='catalog')return [{id:'fixture',title:'离线栏目',mode:'home',available:true}]
    if(method==='browse')return {cards:[],channels:[],more:false,next:'',notice:'离线测试，无源站请求'}
    if(method==='cacheInfo')return {posters:0,temp:0}
    if(method==='saveSettings'){Object.assign(settings,args[0]);for(const cb of handlers.get('state')||[])cb(clone(state));return clone(state)}
    if(method==='providerSession'){
      const c=args[0];if(c.op==='start')return {provider:c.provider,state:'pending',authenticated:false,summary:'离线激活码',userCode:'MOCK-1234',url:'https://example.invalid/activate',interval:5,expiresAt:Date.now()+600000}
      return {provider:c.provider,state:c.op==='web_send_code'?'code_pending':'ready',authenticated:false,summary:'离线测试：'+c.op}
    }
    if(method==='tencentDiagnostics')return [{at:'2026-09-30T00:00:00Z',flow:'fixture-flow',operation:'fixture-operation',job:'7',action:'play',phase:'decision',status:'risk_rejected',decision:'stop_flow',code:'93'},{at:'2026-09-30T00:00:01Z',flow:'fixture-flow',operation:'fixture-operation',job:'7',action:'play',phase:'finish',status:'local_only_gateway_source_unsupported',decision:'local_observation'}]
    throw new Error('Unexpected smoke IPC method: '+method)
  }
})
