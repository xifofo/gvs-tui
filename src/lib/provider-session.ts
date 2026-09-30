export type SessionProvider = 'mewatch' | 'hamivideo'
export type SessionCommand = { provider: SessionProvider; op: string; cookie?: string; phone?: string; code?: string; confirm?: boolean; profileId?: string; pin?: string }
export type ProviderSessionView = { provider: SessionProvider; state: string; authenticated: boolean; summary: string; userCode?: string; url?: string; interval?: number; expiresAt?: number; resendAfterSeconds?: number; profiles?: Array<{ id: string; name: string }> }
type Invoke = (provider: string, action: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>
const text = (v: unknown) => typeof v === 'string' ? v : ''
const positive = (v: unknown, fallback: number) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback
const OPS = { mewatch: new Set(['start', 'poll', 'status', 'logout', 'profiles', 'profile', 'refresh']), hamivideo: new Set(['import', 'status', 'refresh', 'logout', 'web_start', 'web_send_code', 'web_verify', 'web_status', 'web_logout']) }

/** Source credentials are transient: never persist or log command inputs. */
export class ProviderSessions {
  private scope = ''
  private flow = ''
  private flowExpires = 0
  private activation?: ProviderSessionView
  private nextPoll = 0
  private nextSMS = 0
  private busy = new Set<SessionProvider>()
  private views = new Map<string, ProviderSessionView>()
  constructor(private readonly invoke: Invoke, private readonly now = Date.now) {}
  setScope(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope; this.flow = ''; this.flowExpires = 0; this.nextPoll = 0; this.nextSMS = 0; this.activation = undefined; this.views.clear()
  }
  async command(c: SessionCommand): Promise<ProviderSessionView> {
    if (!OPS[c.provider]?.has(c.op)) throw new Error('不支持的登录操作')
    if (this.busy.has(c.provider)) throw new Error('登录请求进行中，请勿重复操作')
    const web = c.provider === 'hamivideo' && c.op.startsWith('web_')
    const key = c.provider + (web ? ':web' : ':tv')
    const input: Record<string, unknown> = { op: c.op }
    if (c.provider === 'mewatch' && c.op === 'poll') {
      const prev = this.activation
      if (!prev?.expiresAt || this.now() >= prev.expiresAt) throw new Error('激活码已过期，请重新开始')
      if (this.now() < this.nextPoll) return { ...prev, interval: Math.ceil((this.nextPoll - this.now()) / 1000) }
    }
    if (c.op === 'import') {
      if (!c.cookie?.trim() || c.cookie.length > 65536) throw new Error('请输入有效的本人 Cookie 文本')
      input.cookie = c.cookie
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
    const scope = this.scope
    this.busy.add(c.provider)
    try {
      const data = await this.invoke(c.provider, 'login', input)
      if (scope !== this.scope) throw new Error('连接已切换，已丢弃旧登录响应')
      if (c.op === 'web_start') { this.flow = text(data.flowId); this.flowExpires = this.now() + 600000 }
      const state = text(data.state) || text(data.status) || (data.authenticated === true ? 'authenticated' : data.imported === true ? 'imported' : 'unknown')
      const authenticated = data.authenticated === true || data.authorized === true || data.signedIn === true || data.loggedIn === true || state === 'authorized' || state === 'authenticated'
      const previous = c.provider === 'mewatch' ? this.activation : this.views.get(key)
      const view: ProviderSessionView = { provider: c.provider, state, authenticated, summary: authenticated ? '已登录；播放仍以源站授权为准' : state === 'imported' ? '已导入；尚未验证订阅' : state }
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
    } finally { this.busy.delete(c.provider) }
  }
}
