// Per-scene chrome data: the browser title, the wizard order in the header,
// and the footer key hints. The shell decides *which* scene is active; this
// table is where each scene's copy lives, so a redesign of one scene touches
// one row here instead of hunting through the shell.

/** Window title for the browser tab / `useTitle`. */
export const SCENE_TITLES: Record<string, string> = {
  workspace: '发现',
  filters: '筛选',
  confirm: '确认',
  help: '快捷键',
  'job-detail': '任务详情',
  setup: '连接网关',
  home: '首页',
  search: '搜索',
  results: '搜索结果',
  detail: '选集',
  quality: '画质',
  tmdb: '匹配',
  jobs: '下载任务',
  settings: '设置',
  qr: '扫码登录',
  edit: '编辑',
}

/** The download wizard, shown as a stepper in the header. */
export const FLOW = ['detail', 'quality', 'tmdb', 'confirm']

/** Always-available keys, right-aligned in the footer when there is room. */
export const GLOBAL_HINTS: Array<[string, string]> = [
  ['F1', '帮助'],
  ['F2', '搜索'],
  ['F3', '任务'],
  ['F4', '设置'],
]

/** Scene hints, left-aligned in the footer. */
export const HINTS: Record<string, Array<[string, string]>> = {
  workspace: [
    ['⏎', '打开'],
    ['←→', '栏目'],
    ['tab', '推荐/榜单'],
    ['1-4', '平台'],
    ['r', '刷新'],
    ['/', '搜索'],
  ],
  filters: [
    ['↑↓', '选择'],
    ['⏎', '应用'],
    ['esc', '取消'],
  ],
  confirm: [
    ['⏎', '加入队列'],
    ['o', '改目录'],
    ['esc', '返回画质'],
  ],
  help: [
    ['↑↓', '滚动'],
    ['esc', '返回'],
  ],
  'job-detail': [
    ['↑↓', '日志'],
    ['esc', '返回'],
  ],
  setup: [
    ['tab', '切换字段'],
    ['⏎', '进入'],
    ['^C', '退出'],
  ],
  home: [
    ['↑↓', '移动'],
    ['⏎', '打开'],
    ['q', '退出'],
  ],
  search: [
    ['⏎', '搜索'],
    ['tab', '切平台'],
    ['esc', '返回'],
  ],
  results: [
    ['⏎', '打开'],
    ['/', '改搜索'],
    ['↑↓', '移动'],
    ['esc', '返回'],
  ],
  detail: [
    ['⏎', '去画质'],
    ['空格', '勾选'],
    ['⇧方向', '连选'],
    ['a/c', '全选/清'],
    ['esc', '返回'],
  ],
  quality: [
    ['⏎', '继续'],
    ['↑↓', '选档'],
    ['←→', '音轨'],
    ['空格', '勾音轨'],
    ['esc', '返回'],
  ],
  tmdb: [
    ['⏎', '采用'],
    ['s', '跳过'],
    ['r', '重试'],
    ['esc', '返回画质'],
  ],
  jobs: [
    ['↑↓', '移动'],
    ['⏎', '日志'],
    ['esc', '返回'],
  ],
  settings: [
    ['↑↓', '移动'],
    ['⏎', '修改'],
    ['esc', '保存返回'],
  ],
  edit: [
    ['⏎', '保存'],
    ['esc', '取消'],
  ],
  qr: [
    ['⏎', '刷新'],
    ['esc', '取消'],
  ],
}
