export type SessionProvider = 'mewatch' | 'hamivideo' | 'iq' | 'iqcn'
export type SessionCommand = { provider: SessionProvider; op: string; cookie?: string; phone?: string; code?: string; confirm?: boolean; profileId?: string; pin?: string; username?: string; password?: string; areaCode?: string }
export type ProviderSessionView = { provider: SessionProvider; state: string; authenticated: boolean; summary: string; webAuthenticated?: boolean; tvAuthenticated?: boolean; userCode?: string; url?: string; interval?: number; expiresAt?: number; resendAfterSeconds?: number; profiles?: Array<{ id: string; name: string }> }
type Invoke = (provider: string, action: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>
const text = (v: unknown) => typeof v === 'string' ? v : ''
const positive = (v: unknown, fallback: number) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback
const OPS = { mewatch: new Set(['start', 'poll', 'status', 'logout', 'profiles', 'profile', 'refresh']), hamivideo: new Set(['import', 'status', 'refresh', 'logout', 'web_start', 'web_send_code', 'web_verify', 'web_status', 'web_logout']), iq: new Set(['password', 'web_import', 'exchange_tv', 'poll', 'status', 'verify', 'logout']), iqcn: new Set(['start', 'poll', 'status', 'logout', 'cancel']) }

/** Source credentials are transient: never persist or log command inputs. */
export class ProviderSessions {
  private scope = ''
  private scopeRevision = 0
  private flow = ''
  private flowExpires = 0
  private activation?: ProviderSessionView
  private nextPoll = 0
  private nextSMS = 0
  private busy = new Map<SessionProvider, { op: string; result?: Promise<ProviderSessionView> }>()
  private views = new Map<string, ProviderSessionView>()
  private cnFlow?: { id: string; expires: number; nextPoll: number }
  constructor(private readonly invoke: Invoke, private readonly now = Date.now) {}
  setScope(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope; this.scopeRevision++; this.busy.clear(); this.flow = ''; this.flowExpires = 0; this.nextPoll = 0; this.nextSMS = 0; this.activation = undefined; this.cnFlow = undefined; this.views.clear()
  }
  command(c: SessionCommand): Promise<ProviderSessionView> {
    const pending = this.busy.get(c.provider)
    // Startup and the account page can ask for the same read-only status together.
    if (pending?.result && pending.op === c.op && (c.op === 'status' || c.op === 'web_status')) return pending.result
    if (pending) return Promise.reject(new Error('登录请求进行中，请勿重复操作'))
    const entry: { op: string; result?: Promise<ProviderSessionView> } = { op: c.op }
    const revision = this.scopeRevision
    this.busy.set(c.provider, entry)
    entry.result = this.execute(c, revision).finally(() => {
      // An old gateway's response must not unlock a request on the new gateway.
      if (this.busy.get(c.provider) === entry) this.busy.delete(c.provider)
    })
    return entry.result
  }
  private async execute(c: SessionCommand, revision: number): Promise<ProviderSessionView> {
    if (!OPS[c.provider]?.has(c.op)) throw new Error('不支持的登录操作')
    const web = c.provider === 'hamivideo' && c.op.startsWith('web_')
    const key = c.provider + (web ? ':web' : ':tv')
    const input: Record<string, unknown> = { op: c.op }
    if (c.provider === 'iqcn' && (c.op === 'poll' || c.op === 'cancel')) {
      if (!this.cnFlow) throw new Error('二维码已过期，请重新开始')
      if (this.now() >= this.cnFlow.expires) {
        this.cnFlow = undefined
        const expired: ProviderSessionView = { provider: 'iqcn', state: 'expired', authenticated: false, summary: '二维码已过期，请刷新' }
        this.views.set(key, expired)
        return expired
      }
      input.flowId = this.cnFlow.id
      if (c.op === 'poll' && this.now() < this.cnFlow.nextPoll) return this.views.get(key)!
    }
    if (c.provider === 'mewatch' && c.op === 'poll') {
      const prev = this.activation
      if (!prev?.expiresAt || this.now() >= prev.expiresAt) throw new Error('激活码已过期，请重新开始')
      if (this.now() < this.nextPoll) return { ...prev, interval: Math.ceil((this.nextPoll - this.now()) / 1000) }
    }
    if (c.op === 'import' || (c.provider === 'iq' && c.op === 'web_import')) {
      if (!c.cookie?.trim() || c.cookie.length > 65536) throw new Error('请输入有效的本人 Cookie 文本')
      input.cookie = c.cookie
    }
    if (c.provider === 'iq' && c.op === 'password') {
      if (!c.username?.trim() || !c.password || c.username.length > 256 || c.password.length > 256) throw new Error('请输入本人账号和密码（最多256字符）')
      input.username = c.username.trim(); input.password = c.password
      if (c.areaCode) input.areaCode = c.areaCode
    }
    if (c.op === 'web_send_code' || c.op === 'web_verify') {
      if (!this.flow || this.now() >= this.flowExpires) throw new Error('短信登录流程已过期，请重新准备')
      input.flowId = this.flow
      if (c.op === 'web_send_code') {
        if (c.confirm !== true) throw new Error('发送短信需要用户明确确认')
        if (!/^(09[0-9]{8}|[+]8869[0-9]{8})$/.test(c.phone || '')) throw new Error('请输入台湾门号 09xxxxxxxx 或 +8869xxxxxxxx')
        if (this.now() < this.nextSMS) throw new Error('短信冷却中，请稍后手动重试')
        input.phone = c.phone; input.confirm = true; this.nextSMS = this.now() + 60000
      } else {
        if (!/^[0-9]{6}$/.test(c.code || '')) throw new Error('请输入六位短信码，保留前导零')
        input.code = c.code
      }
    }
    if (c.op === 'profile') {
      if (!c.profileId) throw new Error('请选择 profile')
      input.profileId = c.profileId
      if (c.pin) input.pin = c.pin
    }
    const data = await this.invoke(c.provider, 'login', input)
    if (revision !== this.scopeRevision) throw new Error('连接已切换，已丢弃旧登录响应')
    if (c.op === 'web_start') { this.flow = text(data.flowId); this.flowExpires = this.now() + 600000 }
    const state = text(data.state) || text(data.status) || (data.authenticated === true ? 'authenticated' : data.imported === true ? 'imported' : 'unknown')
    const authenticated = data.authenticated === true || data.authorized === true || data.signedIn === true || data.loggedIn === true || state === 'authorized' || state === 'authenticated'
    const previous = c.provider === 'mewatch' ? this.activation : this.views.get(key)
    const view: ProviderSessionView = { provider: c.provider, state, authenticated, summary: authenticated ? '已登录；播放仍以源站授权为准' : state === 'imported' ? '已导入；尚未验证订阅' : state }
    if (c.provider === 'iqcn') {
      view.summary = text(data.summary) || (authenticated ? '爱奇艺国内版已登录' : state === 'pending' ? '用爱奇艺 App 扫码并确认' : state === 'expired' ? '二维码已过期，请刷新' : '登录未完成，请重试')
      if (c.op === 'start') {
        const url = new URL(text(data.url))
        const trusted = ['iqiyi.com', 'gitv.tv'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))
        const expires = positive(data.expiresAt, 0) * 1000
        if (url.protocol !== 'https:' || !trusted || url.username || url.password || !text(data.flowId) || expires <= this.now()) throw new Error('网关返回的爱奇艺二维码无效')
        view.url = url.href; view.expiresAt = expires; view.interval = positive(data.interval, 2)
        this.cnFlow = { id: text(data.flowId), expires, nextPoll: this.now() + view.interval * 1000 }
      } else if (state === 'pending') {
        view.url = this.views.get(key)?.url; view.expiresAt = this.cnFlow?.expires
        view.interval = positive(data.interval, 2)
        if (this.cnFlow) this.cnFlow.nextPoll = this.now() + view.interval * 1000
      }
      if (authenticated || ['logout', 'cancel'].includes(c.op) || ['expired', 'denied'].includes(state)) this.cnFlow = undefined
    }
    if (c.provider === 'iq') {
      view.webAuthenticated = data.webAuthenticated === true; view.tvAuthenticated = data.tvAuthenticated === true
      view.authenticated = view.webAuthenticated && view.tvAuthenticated
      view.summary = text(data.summary) || (view.authenticated ? 'Web 登录和 TV 会话转换已完成' : 'IQ 会话尚未完成')
      const uri = text(data.url)
      if (uri) { const u = new URL(uri); if (u.protocol !== 'https:' || !['www.iq.com', 'iq.com'].includes(u.hostname)) throw new Error('拒绝非官方 IQ 登录地址'); view.url = u.href }
      view.userCode = text(data.userCode) || undefined
      if (data.interval) view.interval = positive(data.interval, 2)
      if (data.expiresAt) view.expiresAt = positive(data.expiresAt, 0) * 1000
    }
    if (c.provider === 'mewatch' && state === 'pending') {
      view.userCode = text(data.userCode) || previous?.userCode
      const uri = text(data.verificationUriComplete) || text(data.verificationUri) || previous?.url
      if (uri) { const u = new URL(uri); if (u.protocol !== 'https:') throw new Error('拒绝不安全的激活地址'); view.url = u.href }
      view.interval = positive(data.interval, previous?.interval || 5)
      view.expiresAt = data.expiresIn ? this.now() + positive(data.expiresIn, 600) * 1000 : previous?.expiresAt
      this.nextPoll = this.now() + view.interval * 1000
      view.summary = '请在官方激活页输入激活码，按间隔检查状态'
      this.activation = view
    }
    if (Number.isFinite(Number(data.resendAfterSeconds))) { view.resendAfterSeconds = Math.max(0, Number(data.resendAfterSeconds)); this.nextSMS = Math.max(this.nextSMS, this.now() + view.resendAfterSeconds * 1000) }
    if (data.requiresBrowser === true || state === 'requires_device_choice') view.summary = '请在官网完成校验或设备选择；不会自动重试'
    if (/uncertain/.test(state)) view.summary = '上次操作结果不确定，请先查询状态，不要重复发码或提交'
    if (Array.isArray(data.profiles)) view.profiles = data.profiles.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object').map(p => ({ id: text(p.id) || text(p.profileId), name: text(p.name) || text(p.title) })).filter(p => !!p.id)
    if (c.op === 'logout' || c.op === 'web_logout') { view.authenticated = false; view.state = 'signed_out'; view.summary = '已退出'; if (web) { this.flow = ''; this.flowExpires = 0 } }
    if (c.provider === 'mewatch' && (authenticated || c.op === 'logout' || ['expired','cancelled','denied'].includes(state))) this.activation = undefined
    this.views.set(key, view)
    return view
  }
}
