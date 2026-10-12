const { contextBridge } = require('electron')
const handlers = new Map(), calls = []
const clone = value => JSON.parse(JSON.stringify(value))
const providers = ['migu','youku']
const settings = {host:'https://gateway.example.invalid',keyMasked:'offline-only',hasKey:true,outDir:'C:/offline-downloads',tmpDir:'',releaseGroup:'TEST',tmdbKey:'',tmdbLang:'zh-CN',threads:4,tencentCookie:'',douyinCookie:'',hongguoNfo:true,huangguoNfo:true,hongguoFmt:'mkv',huangguoFmt:'mkv',tencentObservations:false,hamiClient:'tv'}
const state = {configured:true,connecting:false,keyName:'离线界面测试',keyError:'',providers,tunnel:{ok:true,err:'',enabled:true},accounts:providers.map(provider=>({provider,short:'离线测试',summary:'不连接真实账号',tone:'muted'})),settings,tools:[],version:'smoke',platform:'win32'}
const card = (provider,id,title,sourceTerminal) => ({provider,id,title,sourceTerminal,poster:'',desc:'离线测试数据',meta:'2026',score:'',vip:false,target:'detail'})
const cards = [card('migu','tv-series:968082109','伟大的长征','tv'),card('migu','968082110','伟大的长征','mobile'),card('migu','123456789','伟大的长征幕后','mobile')]
contextBridge.exposeInMainWorld('miguSearchSmoke',{calls:()=>clone(calls)})
contextBridge.exposeInMainWorld('gvs',{
  on(event,cb){const list=handlers.get(event)||[];list.push(cb);handlers.set(event,list);return()=>{}},
  async call(method,...args){
    calls.push({method,args:clone(args)})
    if(method==='state')return clone(state)
    if(method==='jobs')return []
    if(method==='updateState')return {status:'idle',version:'smoke',message:'离线测试',auto:false}
    if(method==='catalog')return args[0]==='migu' ? [
      {id:'mobile:recommend',title:'推荐',mode:'home',available:true,sourceTerminal:'mobile'},
      {id:'tv:recommend',title:'推荐',mode:'home',available:true,sourceTerminal:'tv'},
      {id:'mobile:series',title:'电视剧',mode:'rank',available:true,sourceTerminal:'mobile'},
      {id:'tv:series',title:'电视剧',mode:'home',available:true,sourceTerminal:'tv'},
    ] : [{id:'fixture',title:'离线测试',mode:'home',available:true}]
    if(method==='browse')return {cards:args[0]==='migu'?clone(cards.filter(c=>c.sourceTerminal===args[1].sourceTerminal&&c.title==='伟大的长征')):[],channels:[],more:false,next:'',notice:''}
    if(method==='parseLink')return {kind:'none'}
    if(method==='searchTargets')return providers
    if(method==='searchProvider')return {provider:args[0],cards:args[0]==='migu'?clone(cards):[card('youku','youku-show','其他平台作品')],error:''}
    if(method==='detail'){
      const found=cards.find(c=>c.id===args[1])
      const tv=found?.sourceTerminal==='tv'
      return {provider:args[0],id:args[1],title:found?.title||'作品',poster:'',desc:'离线测试数据',category:'电视剧',year:2026,tags:[],score:'',vip:false,drm:'',kind:'show',episodeCount:1,episodes:[{vid:tv?'tv:968181178':'968181177',title:'第一集',number:1,group:'正片',collection:'正片',duration:2400,languages:[]}],pickNoun:'集'}
    }
    throw Error('Unexpected smoke IPC method: '+method)
  },
})
