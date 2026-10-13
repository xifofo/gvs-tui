"""生成 src/renderer/src/assets/platforms/platform-icons.ts 与 README.md。
用法：在临时目录 `npm i simple-icons`，然后 SIMPLE_ICONS=<该目录>/node_modules/simple-icons python3 scripts/gen-platform-icons.py
"""
import json, os
SI = os.environ.get('SIMPLE_ICONS', 'node_modules/simple-icons')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src/renderer/src/assets/platforms')
si={i['slug'] if 'slug' in i else None:i for i in json.load(open(SI + '/data/simple-icons.json'))}
import re
def slug(t): return re.sub(r'[^a-z0-9]','',t.lower().replace('+','plus').replace('.','dot').replace('&','and'))
data=json.load(open(SI + '/data/simple-icons.json'))
idx={(i.get('slug') or slug(i['title'])):i for i in data}
def sipath(s):
    return re.search(r' d="([^"]+)"', open(f'{SI}/icons/{s}.svg').read()).group(1)
# id, name, color, glyph spec
E=[
 # app providers
 ('tencent','腾讯视频','#FF7A00',('mask','tencent')),
 ('youku','优酷','#1F7BFF',('mask','youku')),
 ('iq','iQIYI 海外版','#00C853',('mask','iq')),
 ('iqcn','爱奇艺','#00B140',('mask','iq')),
 ('douyin','抖音','#161823',('mask','douyin')),
 ('mewatch','meWATCH','#E5007E',('text','me')),  # 官方 favicon 是实心圆，轮廓无法区分
 ('hamivideo','Hami Video','#0A84D6',('mask','hamivideo')),
 ('hongguo','红果短剧','#F2453D',('text','红果')),
 ('huangguo','黄果','#E8A400',('text','黄果')),
 ('mgtv','芒果 TV','#FF6A00',('text','芒果')),
 ('migu','咪咕视频','#E60033',('text','咪咕')),
 ('bilibili','哔哩哔哩','#00A1D6',('si','bilibili')),
 # worldwide services
 ('netflix','Netflix','#E50914',('si','netflix')),
 ('disneyplus','Disney+','#0E3B8C',('text','D+')),
 ('primevideo','Prime Video','#1399FF',('text','prime')),
 ('max','Max','#002BE7',('si','max')),
 ('hbo','HBO','#000000',('si','hbo')),
 ('hulu','Hulu','#1CE783',('text','hulu')),
 ('appletv','Apple TV+','#000000',('si','appletv')),
 ('paramountplus','Paramount+','#0064FF',('si','paramountplus')),
 ('peacock','Peacock','#000000',('text','P')),
 ('youtube','YouTube','#FF0000',('si','youtube')),
 ('crunchyroll','Crunchyroll','#FF5E00',('si','crunchyroll')),
 ('wetv','WeTV','#FF7A00',('mask','tencent')),
 ('tiktok','TikTok','#000000',('si','tiktok')),
 ('kuaishou','快手','#FF4906',('si','kuaishou')),
 ('viu','Viu','#F7B500',('text','viu')),
 ('linetv','LINE TV','#06C755',('si','line')),
 ('kktv','KKTV','#1A1A1A',('text','KK')),
 ('friday','friDay影音','#FF3C78',('text','fri')),
 ('appletvplus','Apple TV+','#000000',('si','appletv')),
 ('catchplay','CATCHPLAY+','#111111',('text','C+')),
 ('myvideo','myVideo','#E9002B',('text','my')),
 ('unext','U-NEXT','#000000',('text','U')),
 ('abema','ABEMA','#000000',('text','A')),
 ('tver','TVer','#00B4E6',('text','TVer')),
 ('dazn','DAZN','#0C161C',('si','dazn')),
 ('viki','Rakuten Viki','#1E8FFF',('text','viki')),
 ('rakuten','Rakuten TV','#BF0000',('si','rakuten')),
 ('zee5','ZEE5','#8230C6',('text','Z5')),
 ('hotstar','Disney+ Hotstar','#0F1014',('text','hs')),
 ('bbciplayer','BBC iPlayer','#F54997',('text','BBC')),
 ('itvx','ITVX','#DEEB52',('si','itvx')),
 ('channel4','Channel 4','#AAFF89',('si','channel4')),
 ('canalplus','Canal+','#000000',('text','C+')),
 ('stan','Stan','#0072CE',('text','S')),
 ('binge','Binge','#5A1BE6',('text','B')),
 ('crave','Crave','#0A2463',('text','C')),
 ('globoplay','Globoplay','#FB0234',('text','g')),
 ('viaplay','Viaplay','#FE365F',('si','viaplay')),
 ('tubi','Tubi','#7408FF',('si','tubi')),
 ('twitch','Twitch','#9146FF',('si','twitch')),
 ('vimeo','Vimeo','#1AB7EA',('si','vimeo')),
 ('mubi','MUBI','#000000',('si','mubi')),
 ('sky','Sky','#0072C9',('si','sky')),
 ('showtime','Showtime','#B10000',('si','showtime')),
 ('starz','STARZ','#082125',('si','starz')),
]
lines=["/* 自动生成：app/scripts/gen-platform-icons.py（来源与许可见同目录 README.md）。统一样式：圆角方块 + 品牌色底 + 白色单色图形 */",
"export type PlatformGlyph = { kind: 'path'; d: string } | { kind: 'mask'; asset: string } | { kind: 'text'; text: string }",
"export type PlatformIcon = { id: string; name: string; color: string; glyph: PlatformGlyph; source: string }",
"export const PLATFORM_ICONS: Record<string, PlatformIcon> = {"]
for id,name,color,(k,v) in E:
    if k=='si':
        g="{ kind: 'path', d: %s }"%json.dumps(sipath(v)); src=f'simple-icons {v} (CC0-1.0)'
    elif k=='mask':
        g="{ kind: 'mask', asset: %s }"%json.dumps(v); src=f'assets/platforms/{v} (official site asset, see SOURCES.md)'
    else:
        g="{ kind: 'text', text: %s }"%json.dumps(v,ensure_ascii=False); src='monogram (no redistributable official mark bundled)'
    lines.append(f"  {json.dumps(id)}: {{ id: {json.dumps(id)}, name: {json.dumps(name,ensure_ascii=False)}, color: '{color}', glyph: {g}, source: {json.dumps(src)} }},")
lines.append("}")
open(os.path.join(OUT,'platform-icons.ts'),'w').write('\n'.join(lines)+'\n')
rd=["# 平台图标库","","统一样式：圆角方块（圆角 24%）+ 品牌色底 + 白色单色图形，尺寸由组件 `PlatformLogo` 的 `size` 决定。映射表在 `platform-icons.ts`（provider id → 图标）。","",
"图形来源分三类：","- **simple-icons**（https://simpleicons.org ，v"+json.load(open(SI + '/package.json'))['version']+"，CC0-1.0）：路径原样内联。商标归各自权利人所有，遵循 simple-icons 的 DISCLAIMER。",
"- **官方站点素材**：本目录已有的 svg/png（来源见 `SOURCES.md`），渲染时作为蒙版取轮廓、统一成白色。",
"- **字标**：没有可再分发的官方矢量标识时，用品牌色 + 简短字标，避免夹带未授权的商标文件。拿到官方新闻包/授权素材后，把 svg 放进本目录并在生成脚本里改成 `mask` 或 `path` 即可。","",
"| id | 名称 | 品牌色 | 图形来源 |","|---|---|---|---|"]
for id,name,color,(k,v) in E:
    rd.append(f"| `{id}` | {name} | `{color}` | {'simple-icons `'+v+'`' if k=='si' else ('官方素材 `'+v+'`' if k=='mask' else '字标 “'+v+'”')} |")
rd+=["","取得日期：2026-10-13。"]
open(os.path.join(OUT,'README.md'),'w').write('\n'.join(rd)+'\n')
print(len(E))
