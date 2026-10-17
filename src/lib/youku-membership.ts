import { isObj } from './util.ts'

export type YoukuMembershipScope = 'youku' | 'kumiao' | 'frame_xiang' | 'unknown'
export type YoukuMembershipStatus = 'active' | 'expired' | 'inactive' | 'unknown'
export type YoukuMembershipProduct = { productId: string; name: string; scope: YoukuMembershipScope; status: YoukuMembershipStatus; endAt: string; source: string }
export type YoukuMembership = { status: YoukuMembershipStatus; products: YoukuMembershipProduct[] }
const str=(v:unknown)=>typeof v==='string'?v.trim():typeof v==='number'?String(v):''
const normalized=(v:string)=>v.replace(/[^a-z0-9]/gi,'').toLowerCase()
const bool=(v:unknown):boolean|undefined=>v===true||v===1||['true','1','active'].includes(str(v).toLowerCase())?true:v===false||v===0||['false','0','inactive','expired'].includes(str(v).toLowerCase())?false:undefined

function time(v:unknown):number {
 const s=str(v)
 if (/^\d{8}$/.test(s)) {const at=Date.parse(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`);return Number.isFinite(at)?at:0}
 if (/^\d+(?:\.\d+)?$/.test(s)) {const n=Number(s);return n>0?(n<1e10?n*1000:n):0}
 const n=Date.parse(s);return Number.isFinite(n)?n:0
}
function scope(row:Record<string,unknown>,name:string,source:string):YoukuMembershipScope {
 const s=str(row.scope||row.terminal||row.product_scope||row.productScope).toLowerCase()
 if(['youku','mobile','app','phone','youku_svip'].includes(s))return 'youku'
 if(['kumiao','cibn','com.cibn.tv'].includes(s))return 'kumiao'
 if(['frame_xiang','bluray','com.youku.bluray.tv'].includes(s))return 'frame_xiang'
 if(name.includes('帧享'))return 'frame_xiang'
 if(name.includes('酷喵'))return 'kumiao'
 if(name.includes('优酷'))return 'youku'
 if(source==='device:bluray')return 'frame_xiang'
 if(source==='device:cibn')return 'kumiao'
 return 'unknown'
}
export function youkuMembershipStatus(products:YoukuMembershipProduct[]):YoukuMembershipStatus {
 if(products.some(p=>p.status==='active'))return 'active'
 if(products.some(p=>p.status==='expired'))return 'expired'
 if(products.some(p=>p.status==='inactive'))return 'inactive'
 return 'unknown'
}

/** Successful HTTP and generic future timestamps cannot create a membership. */
export function parseYoukuMembership(data:Record<string,unknown>,now=Date.now()):YoukuMembership {
 const products:YoukuMembershipProduct[]=[]
 const seen=new Set<string>()
 const walk=(node:unknown,source:string,context=false,depth=0):void=>{
  if(depth>20)return
  if(Array.isArray(node)){for(const child of node)walk(child,source,context,depth+1);return}
  if(!isObj(node))return
  const row=Object.fromEntries(Object.entries(node).map(([k,v])=>[normalized(k),v]))
  const productId=str(row.productid||row.memberproductid)
  const name=str(row.productname||row.membername||row.name)
  const flags=['isvip','vip','ismember','memberactive'].map(k=>bool(row[k]))
  let flag=flags.find(v=>v!==undefined)
  context=context||!!productId||/会员|vip/i.test(name)||flag!==undefined
  if(context&&flag===undefined)flag=bool(row.active)??bool(row.isactive)
  const end=context?Math.max(0,...['endms','endat','endtime','expiretime','expiresat','expireat','vipexpiretime','vipendtime'].map(k=>time(row[k]))):0
  const explicit=str(row.membershipstatus||row.status).toLowerCase()
  const container=['products','productlist','viplist','memberships','entitlements'].some(k=>row[k]!=null)
  let status:YoukuMembershipStatus='unknown'
  if(context&&!container){
   if(end>0&&end<=now||explicit==='expired')status='expired'
   else if(flag===false||['inactive','revoked'].includes(explicit))status='inactive'
   else if(flag===true||end>now||explicit==='active')status='active'
  }
  if(status!=='unknown'){
   const entry={productId,name:name||'未标明产品的会员',scope:scope(node,name,source),status,endAt:end?new Date(end).toISOString():'',source}
   const key=JSON.stringify(entry)
   if(!seen.has(key)){products.push(entry);seen.add(key)}
  }
  for(const [key,value] of Object.entries(node)){
   const k=normalized(key)
   if(['raw','advertisement','ads','campaign','promotion','offers','recommendations'].includes(k))continue
   walk(value,source,context||['memberinfo','memberinfos','membership','vipinfo','viplist','products','productlist','memberships','entitlements'].includes(k),depth+1)
  }
 }
 const summary=isObj(data.summary)?data.summary:{}
 // New summaries carry individual products. Do not OR their result with old profiles.
 if(Array.isArray(summary.products)){
  walk(summary.products,'summary',true)
  return {status:youkuMembershipStatus(products),products}
 }
 if(summary.membership_known===true){
  const explicit=str(summary.membership_status).toLowerCase()
  const expiry=time(summary.expire_at)
  // Old generic summaries can report one unknown product; never infer terminal coverage.
  const status:YoukuMembershipStatus=expiry>0&&expiry<=now?'expired':explicit==='expired'?'expired':explicit==='inactive'?'inactive':explicit==='active'&&summary.is_vip===true?'active':'unknown'
  if(status!=='unknown')products.push({productId:'',name:'未标明产品的会员',scope:'unknown',status,endAt:expiry?new Date(expiry).toISOString():'',source:'legacy_summary'})
  return {status:youkuMembershipStatus(products),products}
 }
 if(isObj(data.profile))for(const [name,value]of Object.entries(data.profile)){
  if(!isObj(value)||!Array.isArray(value.ret)||!value.ret.some(r=>/^SUCCESS(?:$|::)/i.test(str(r))))continue
  walk(value.data,`profile:${name}`)
 }

 return {status:youkuMembershipStatus(products),products}
}

export function youkuMembershipText(value:YoukuMembership):string {
 const labels={youku:'普通优酷',kumiao:'酷喵',frame_xiang:'帧享'}
 const states={active:'有效',expired:'已过期',inactive:'未开通',unknown:'未确认'}
 const scoped=Object.entries(labels).map(([scope,label])=>{
  const rows=value.products.filter(p=>p.scope===scope)
  if(!rows.length)return `${label}：未确认`
  const entries=[...new Set(rows.map(product=>`${product.name} ${states[product.status]}${product.endAt?`（${product.endAt.slice(0,10)}）`:''}`))]
  return `${label}：${entries.join(' / ')}`
 })
 const unknown=value.products.filter(p=>p.scope==='unknown')
 if(unknown.length)scoped.push(`未标明端的会员：${states[youkuMembershipStatus(unknown)]}，不能确认酷喵或帧享权益`)
 return scoped.join(' · ')
}
