import {expect,test} from 'bun:test'
import {parseYoukuMembership,youkuMembershipText} from './youku-membership.ts'
import {parseYkAccount,accountSummary,ykAccount} from './youku-session.ts'
const now=Date.UTC(2026,9,17,8)
const before=now-86400000,after=now+86400000
const profile=(products:unknown[])=>({session:{logged_in:true,yktk_vip:true},profile:{member_profile_get:{ret:['SUCCESS::调用成功'],data:{isVip:true,products}}}})

test('ordinary SVIP stays active while Kumiao and frame SVIP expire independently',()=>{
 const result=parseYoukuMembership(profile([
  {productId:'ordinary',productName:'优酷SVIP',isVip:true,endTime:after},
  {productId:'ott',productName:'酷喵SVIP',isVip:true,endTime:before},
  {productId:'fx',productName:'帧享SVIP+',isVip:true,endTime:before},
 ]),now)
 expect(result.status).toBe('active')
 expect(result.products.map(p=>[p.scope,p.status])).toEqual([['youku','active'],['kumiao','expired'],['frame_xiang','expired']])
 const text=youkuMembershipText(result)
 expect(text).toContain('普通优酷：优酷SVIP 有效')
 expect(text).toContain('酷喵：酷喵SVIP 已过期')
 expect(text).toContain('帧享：帧享SVIP+ 已过期')
})

test('expired dates beat stale true flags; login is retained and never requests a QR',()=>{
 const expired='2026-01-01T00:00:00Z'
 const account=parseYkAccount({session:{logged_in:true,yktk_vip:true},summary:{logged_in:true,membership_known:true,is_vip:true,membership_status:'active',products:[{product_id:'fx',name:'帧享SVIP+',scope:'frame_xiang',active:true,end_at:expired}]}})
 expect(account.loggedIn).toBe(true)
 expect(account.needsScan).toBe(false)
 expect(account.isVip).toBe(false)
 expect(account.membership?.status).toBe('expired')
 expect(accountSummary(account)).toContain('已过期')
 expect(accountSummary(account)).not.toContain('扫码')
})

test('login-time VIP and play.is_vip cannot create current member privileges',()=>{
 const account=parseYkAccount({session:{logged_in:true,yktk_vip:true}})
 expect(account.isVip).toBe(false)
 expect(account.vipSource).toBe('none')
 const text=accountSummary(account,{canPlay:true,isVip:true,hasTrial:false,download:'allowed',note:''})
 expect(text).toContain('帧享：未确认')
 expect(text).not.toContain('取流确认')
})

test('one generic member or unknown product ID does not grant all terminals',()=>{
 const data=profile([{productId:'10002',name:'SVIP',endTime:after}])
 const result=parseYoukuMembership(data,now)
 expect(result.products[0]!.scope).toBe('unknown')
 expect(youkuMembershipText(result)).toContain('不能确认酷喵或帧享权益')
 for(const key of ['普通优酷','酷喵','帧享'])expect(youkuMembershipText(result)).toContain(`${key}：未确认`)
})

test('future marketing date, empty success and expired profile access leave membership unknown',()=>{
 for(const data of [profile([]),{profile:{foo:{ret:['SUCCESS'],data:{campaign:{isActive:true,endTime:after},endTime:after}}}}, {profile:{foo:{ret:['FAIL_SYS_SESSION_EXPIRED'],data:{isVip:true,endTime:after}}}}]) {
  expect(parseYoukuMembership(data,now).status).toBe('unknown')
 }
})

test('explicit product inactivity overrides a future expiry',()=>{
 expect(parseYoukuMembership(profile([{productId:'fx',name:'帧享SVIP+',isVip:false,endTime:after}]),now).status).toBe('inactive')
})

test('current structured products override conflicting legacy profiles',()=>{
 const data={...profile([{productId:'fx',name:'帧享SVIP+',isVip:true,endTime:after}]),summary:{products:[{product_id:'fx',name:'帧享SVIP+',scope:'frame_xiang',status:'expired',end_ms:before}]}}
 expect(parseYoukuMembership(data,now).status).toBe('expired')
})

test('temporary account request failure is unknown rather than logged in or login expired',async()=>{
 const cli={invoke:async()=>{throw new Error('temporary network failure')}}
 const result=await ykAccount(cli as never,'')
 expect(result.loggedIn).toBe(false)
 expect(result.needsScan).toBe(false)
 expect(result.loginUnknown).toBe(true)
 expect(accountSummary(result)).toContain('检查暂不可用')
})

test('an authoritative legacy expired summary is not overridden by a stale active raw profile',()=>{
 const result=parseYoukuMembership({...profile([{productId:'fx',name:'帧享SVIP+',isVip:true,endTime:after}]),summary:{membership_known:true,membership_status:'expired',is_vip:false,expire_at:new Date(before).toISOString()}},now)
 expect(result.status).toBe('expired')
 expect(result.products.some(p=>p.status==='active')).toBe(false)
})

test('missing login status is unknown and does not request another scan',()=>{
 const account=parseYkAccount({summary:{membership_known:false,products:[]}})
 expect(account.loginUnknown).toBe(true)
 expect(account.needsScan).toBe(false)
 expect(accountSummary(account)).toContain('检查暂不可用')
})

test('an active ordinary VIP does not hide the expired SVIP in the same terminal',()=>{
 const result=parseYoukuMembership(profile([{productId:'vip',name:'优酷VIP',endTime:after},{productId:'svip',name:'优酷SVIP',endTime:before}]),now)
 const text=youkuMembershipText(result)
 expect(text).toContain('优酷VIP 有效')
 expect(text).toContain('优酷SVIP 已过期')
 expect(text).toContain('酷喵：未确认')
})
