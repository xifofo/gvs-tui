# 平台图标库

统一样式：圆角方块（圆角 24%）+ 品牌色底 + 白色单色图形，尺寸由组件 `PlatformLogo` 的 `size` 决定。映射表在 `platform-icons.ts`（provider id → 图标）。

图形来源分三类：
- **simple-icons**（https://simpleicons.org ，v16.35.0，CC0-1.0）：路径原样内联。商标归各自权利人所有，遵循 simple-icons 的 DISCLAIMER。
- **官方站点素材**：本目录已有的 svg/png（来源见 `SOURCES.md`），渲染时作为蒙版取轮廓、统一成白色。
- **字标**：没有可再分发的官方矢量标识时，用品牌色 + 简短字标，避免夹带未授权的商标文件。拿到官方新闻包/授权素材后，把 svg 放进本目录并在生成脚本里改成 `mask` 或 `path` 即可。

| id | 名称 | 品牌色 | 图形来源 |
|---|---|---|---|
| `tencent` | 腾讯视频 | `#FF7A00` | 官方素材 `tencent` |
| `youku` | 优酷 | `#1F7BFF` | 官方素材 `youku` |
| `iq` | iQIYI 海外版 | `#00C853` | 官方素材 `iq` |
| `iqcn` | 爱奇艺 | `#00B140` | 官方素材 `iq` |
| `douyin` | 抖音 | `#161823` | 官方素材 `douyin` |
| `mewatch` | meWATCH | `#E5007E` | 字标 “me” |
| `hamivideo` | Hami Video | `#0A84D6` | 官方素材 `hamivideo` |
| `hongguo` | 红果短剧 | `#F2453D` | 字标 “红果” |
| `huangguo` | 黄果 | `#E8A400` | 字标 “黄果” |
| `mgtv` | 芒果 TV | `#FF6A00` | 字标 “芒果” |
| `migu` | 咪咕视频 | `#E60033` | 字标 “咪咕” |
| `bilibili` | 哔哩哔哩 | `#00A1D6` | simple-icons `bilibili` |
| `netflix` | Netflix | `#E50914` | simple-icons `netflix` |
| `disneyplus` | Disney+ | `#0E3B8C` | 字标 “D+” |
| `primevideo` | Prime Video | `#1399FF` | 字标 “prime” |
| `max` | Max | `#002BE7` | simple-icons `max` |
| `hbo` | HBO | `#000000` | simple-icons `hbo` |
| `hulu` | Hulu | `#1CE783` | 字标 “hulu” |
| `appletv` | Apple TV+ | `#000000` | simple-icons `appletv` |
| `paramountplus` | Paramount+ | `#0064FF` | simple-icons `paramountplus` |
| `peacock` | Peacock | `#000000` | 字标 “P” |
| `youtube` | YouTube | `#FF0000` | simple-icons `youtube` |
| `crunchyroll` | Crunchyroll | `#FF5E00` | simple-icons `crunchyroll` |
| `wetv` | WeTV | `#FF7A00` | 官方素材 `tencent` |
| `tiktok` | TikTok | `#000000` | simple-icons `tiktok` |
| `kuaishou` | 快手 | `#FF4906` | simple-icons `kuaishou` |
| `viu` | Viu | `#F7B500` | 字标 “viu” |
| `linetv` | LINE TV | `#06C755` | simple-icons `line` |
| `kktv` | KKTV | `#1A1A1A` | 字标 “KK” |
| `friday` | friDay影音 | `#FF3C78` | 字标 “fri” |
| `catchplay` | CATCHPLAY+ | `#111111` | 字标 “C+” |
| `myvideo` | myVideo | `#E9002B` | 字标 “my” |
| `unext` | U-NEXT | `#000000` | 字标 “U” |
| `abema` | ABEMA | `#000000` | 字标 “A” |
| `tver` | TVer | `#00B4E6` | 字标 “TVer” |
| `dazn` | DAZN | `#0C161C` | simple-icons `dazn` |
| `viki` | Rakuten Viki | `#1E8FFF` | 字标 “viki” |
| `rakuten` | Rakuten TV | `#BF0000` | simple-icons `rakuten` |
| `zee5` | ZEE5 | `#8230C6` | 字标 “Z5” |
| `hotstar` | Disney+ Hotstar | `#0F1014` | 字标 “hs” |
| `bbciplayer` | BBC iPlayer | `#F54997` | 字标 “BBC” |
| `itvx` | ITVX | `#DEEB52` | simple-icons `itvx` |
| `channel4` | Channel 4 | `#AAFF89` | simple-icons `channel4` |
| `canalplus` | Canal+ | `#000000` | 字标 “C+” |
| `stan` | Stan | `#0072CE` | 字标 “S” |
| `binge` | Binge | `#5A1BE6` | 字标 “B” |
| `crave` | Crave | `#0A2463` | 字标 “C” |
| `globoplay` | Globoplay | `#FB0234` | 字标 “g” |
| `viaplay` | Viaplay | `#FE365F` | simple-icons `viaplay` |
| `tubi` | Tubi | `#7408FF` | simple-icons `tubi` |
| `twitch` | Twitch | `#9146FF` | simple-icons `twitch` |
| `vimeo` | Vimeo | `#1AB7EA` | simple-icons `vimeo` |
| `mubi` | MUBI | `#000000` | simple-icons `mubi` |
| `sky` | Sky | `#0072C9` | simple-icons `sky` |
| `showtime` | Showtime | `#B10000` | simple-icons `showtime` |
| `starz` | STARZ | `#082125` | simple-icons `starz` |

取得日期：2026-10-13。
