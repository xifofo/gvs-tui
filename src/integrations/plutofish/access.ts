/** 桌面 IPC 在连接页只允许读状态和连接操作，页面跳转不能绕过主进程检查。 */
const beforeConnection = new Set(['state', 'setup', 'jobs', 'subscriptions', 'accounts', 'updateState', 'pauseJob', 'pauseAll', 'qrCancel'])

export function assertDesktopAccess(method: string, connected: boolean): void {
  if (!connected && !beforeConnection.has(method)) throw new Error('请先完成网关与 PlutoFish 双重鉴权')
}
