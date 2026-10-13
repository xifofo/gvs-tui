/** 托盘菜单的纯数据模型：只有内容变了才重建原生菜单（Windows 上菜单打开时被替换会吞掉点击） */
export type TrayItem = { id: 'open' | 'subs' | 'pause' | 'check' | 'quit' | 'sep'; label: string; enabled: boolean }
export type TrayModel = { tooltip: string; items: TrayItem[] }

export function trayModel(paused: boolean, view: { running: boolean; subs: Array<{ newCount: number }> }): TrayModel {
  const fresh = view.subs.reduce((n, s) => n + s.newCount, 0)
  const sep = { id: 'sep' as const, label: '', enabled: true }
  return {
    tooltip: `GVS · ${view.subs.length} 个订阅${fresh ? ` · ${fresh} 集新更新` : ''}${paused ? ' · 已暂停检查' : ''}`,
    items: [
      { id: 'open', label: '打开 GVS', enabled: true },
      { id: 'subs', label: '订阅', enabled: true },
      sep,
      { id: 'pause', label: paused ? '恢复订阅检查' : '暂停订阅检查', enabled: true },
      { id: 'check', label: view.running ? '正在检查…' : '立即检查全部订阅', enabled: !view.running },
      sep,
      { id: 'quit', label: '退出 GVS', enabled: true },
    ],
  }
}

export const trayKey = (m: TrayModel) => JSON.stringify(m.items)
