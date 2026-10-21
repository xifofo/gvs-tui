import {expect,test} from 'bun:test'
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {GwClient} from './client.ts'
import {ykAccount,accountSummary} from './youku-session.ts'

// A contract fixture emitted by the Go test is supplied explicitly by the local check.
const contractTest=process.env.GVS_YOUKU_MEMBERSHIP_CONTRACT ? test : test.skip
contractTest('Go product summary and real HTTP GwClient keep ordinary and OTT memberships separate',async()=>{
 const data=JSON.parse(readFileSync(process.env.GVS_YOUKU_MEMBERSHIP_CONTRACT!,'utf8'))
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:0,msg:'SUCCESS',data}))})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const cli=new GwClient(`http://127.0.0.1:${(server.address() as {port:number}).port}`,'synthetic-contract-key','')
  const account=await ykAccount(cli,'')
  expect(account.loggedIn).toBe(true)
  expect(account.needsScan).toBe(false)
  expect(account.membership?.products.filter(p=>p.scope==='youku').map(p=>p.status)).toEqual(['active'])
  expect(account.membership?.products.filter(p=>p.scope==='kumiao').map(p=>p.status)).toEqual(['expired'])
  expect(account.membership?.products.filter(p=>p.scope==='frame_xiang').map(p=>p.status)).toEqual(['expired'])
  expect(accountSummary(account)).toContain('帧享SVIP+ 已过期')
  expect(accountSummary(account)).toContain('优酷SVIP 有效')
  expect(account.vipUntil).toBe('')
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
