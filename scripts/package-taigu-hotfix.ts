import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
const require = createRequire(import.meta.url)
const ts = require('../node_modules/typescript') as typeof import('typescript')
const asar = require('../app/node_modules/@electron/asar')
const installed = process.env.GVS_INSTALLED_ASAR
if (!installed) throw new Error('Set GVS_INSTALLED_ASAR to the installed app.asar path')
const mainPath = join('out','main','index.js')
const original = asar.extractFile(installed, mainPath).toString('utf8') as string
const built = readFileSync(resolve('app/out/main/index.js'),'utf8')
const hash = (b: string|Buffer) => createHash('sha256').update(b).digest('hex')
function functions(text: string) {
 const ast=ts.createSourceFile('index.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
 const result=new Map<string,{start:number;end:number;text:string}>()
 for(const s of ast.statements) if(ts.isFunctionDeclaration(s)&&s.name){const name=s.name.text;if(result.has(name))throw new Error('Duplicate function '+name);result.set(name,{start:s.getStart(ast),end:s.end,text:text.slice(s.getStart(ast),s.end)})}
 return result
}
const old=functions(original),next=functions(built)
const replace=['downloadPlaylist','dlYouku']
const add=['validStart','decryptYoukuTs','isMpegTsFile','assertCencMp4Output','youkuMediaError']
const changes=replace.map(name=>{const a=old.get(name),b=next.get(name);if(!a||!b)throw new Error('Missing function '+name);return {...a,text:b.text}}).sort((a,b)=>b.start-a.start)
let patched=original
for(const c of changes) patched=patched.slice(0,c.start)+c.text+patched.slice(c.end)
for(const name of add){if(old.has(name)||!next.has(name))throw new Error('Unexpected helper '+name)}
patched += String.fromCharCode(10)+add.map(name=>next.get(name)!.text).join(String.fromCharCode(10))
new Function('require','module','exports','__dirname','__filename',patched)
const root=resolve('tmp','taigu-desktop-hotfix-'+Date.now());mkdirSync(root,{recursive:true})
const stage=join(root,'stage');mkdirSync(stage)
asar.extractAll(installed,stage)
writeFileSync(join(stage,mainPath),patched)
const target=join(root,'app.asar')
await asar.createPackage(stage,target)
const changed:string[]=[]
const files=asar.listPackage(installed) as string[]
for(const entry of files){const name=entry.startsWith('/')||entry.startsWith(String.fromCharCode(92))?entry.slice(1):entry;const stat=asar.statFile(installed,name);if(stat.files || stat.link)continue;if(hash(asar.extractFile(installed,name))!==hash(asar.extractFile(target,name)))changed.push(name)}
if(changed.length!==1||changed[0]!==mainPath)throw new Error('Unexpected changed files '+changed.join(','))
const report={root,installed,target,originalAsarSHA256:hash(readFileSync(installed)),patchedAsarSHA256:hash(readFileSync(target)),changedFiles:changed,replacedFunctions:replace,addedFunctions:add,configTouched:false}
writeFileSync(join(root,'manifest.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
