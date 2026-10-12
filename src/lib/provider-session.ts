export type SessionProvider = 'mewatch' | 'hamivideo' | 'iq' | 'iqcn' | 'mgtv' | 'bilibili' | 'migu'
export type SessionCommand = { provider: SessionProvider; op: string; terminal?: 'mobile' | 'tv' | 'unified'; cookie?: string; phone?: string; code?: string; confirm?: boolean; profileId?: string; pin?: string; username?: string; password?: string; areaCode?: string }
export type ProviderSessionView = { provider: SessionProvider; state: string; authenticated: boolean; summary: string; qrDataUrl?: string; webAuthenticated?: boolean; tvAuthenticated?: boolean; userCode?: string; url?: string; interval?: number; expiresAt?: number; resendAfterSeconds?: number; profiles?: Array<{ id: string; name: string }> }
type Invoke = (provider: string, action: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>
const text = (v: unknown) => typeof v === 'string' ? v : ''
const positive = (v: unknown, fallback: number) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback
const OPS = { mewatch: new Set(['start', 'poll', 'status', 'logout', 'profiles', 'profile', 'refresh']), hamivideo: new Set(['import', 'status', 'refresh', 'logout', 'web_start', 'web_send_code', 'web_verify', 'web_status', 'web_logout']), iq: new Set(['password', 'web_import', 'exchange_tv', 'poll', 'status', 'verify', 'logout']), iqcn: new Set(['start', 'poll', 'status', 'logout', 'cancel']), mgtv:new Set(['start','poll','status','logout']), bilibili:new Set(['start','poll','import','status','logout']), migu:new Set(['start','poll','status','logout']) }

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
  private mangoFlow?: { id: string; expires: number; nextPoll: number }
  private biliFlow?: { expires: number; nextPoll: number }
  private miguFlow?: { id: string; expires: number; nextPoll: number; terminal:'mobile'|'tv'|'unified' }
  constructor(private readonly invoke: Invoke, private readonly now = Date.now) {}
  setScope(scope: string): void {
    if (scope === this.scope) return
    this.scope = scope; this.scopeRevision++; this.busy.clear(); this.flow = ''; this.flowExpires = 0; this.nextPoll = 0; this.nextSMS = 0; this.activation = undefined; this.cnFlow = undefined; this.mangoFlow = undefined; this.biliFlow = undefined; this.miguFlow = undefined; this.views.clear()
  }
  command(c: SessionCommand): Promise<ProviderSessionView> {
    const operation = c.op + (c.provider === 'migu' ? ':'+(c.terminal || 'unified') : '')
    const pending = this.busy.get(c.provider)
    // Startup and the account page can ask for the same read-only status together.
    if (pending?.result && pending.op === operation && (c.op === 'status' || c.op === 'web_status')) return pending.result
    if (pending) return Promise.reject(new Error('登录请求进行中，请勿重复操作'))
    const entry: { op: string; result?: Promise<ProviderSessionView> } = { op: operation }
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
    const miguTerminal = c.terminal || (c.op === 'poll' ? this.miguFlow?.terminal : undefined) || 'unified'
    const key = c.provider + (c.provider === 'migu' ? ':'+miguTerminal : web ? ':web' : ':tv')
    const input: Record<string, unknown> = { op: c.op }
    if (c.provider === 'migu') {
      input.terminal=miguTerminal
      if (miguTerminal === 'tv') input.verifyId='968181178'
      if (c.op === 'poll') {
        const flow=this.miguFlow
        if (!flow || flow.terminal!==miguTerminal || this.now()>=flow.expires) throw new Error('咪咕二维码已过期，请重新开始')
        if (this.now()<flow.nextPoll) return this.views.get(key)!
        input.loginId=flow.id
      }
    }
    if (c.provider === 'mgtv' && c.op === 'poll') {
      const flow = this.mangoFlow
      if (!flow || this.now() >= flow.expires) throw new Error('芒果二维码已过期，请重新开始')
      if (this.now() < flow.nextPoll) return this.views.get(key)!
      input.sessionId = flow.id
    }
    if (c.provider === 'bilibili' && c.op === 'start') input.op = 'qr'
    if (c.provider === 'bilibili' && c.op === 'poll') {
      // qrcode_key stays in gateway memory; the client only paces polling.
      const flow = this.biliFlow
      if (!flow || this.now() >= flow.expires) throw new Error('B 站二维码已过期，请重新开始')
      if (this.now() < flow.nextPoll) return this.views.get(key)!
    }
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
    let state = text(data.state) || text(data.status) || (data.authenticated === true ? 'authenticated' : data.imported === true ? 'imported' : 'unknown')
    if (c.provider === 'migu') state = ['NOT_SCANED','QR_SCANED'].includes(state) ? 'pending' : state==='QR_TIMEOUT' ? 'expired' : state==='LOGIN_FAIL' ? 'denied' : state
    const authenticated = data.authenticated === true || data.authorized === true || data.signedIn === true || data.loggedIn === true || state === 'authorized' || state === 'authenticated'
    const previous = c.provider === 'mewatch' ? this.activation : this.views.get(key)
    const view: ProviderSessionView = { provider: c.provider, state, authenticated, summary: authenticated ? '已登录；播放仍以源站授权为准' : state === 'imported' ? '已导入；尚未验证订阅' : state }
    if (c.provider === 'migu') {
      const label=miguTerminal==='tv' ? '咪视界 TV' : miguTerminal==='unified' ? '咪咕' : '咪咕手机端'
      if (c.op === 'start') {
        const url=new URL(text(data.qrCodeUrl)), expires=positive(data.expiresAt,0)*1000
        if (url.protocol!=='https:' || url.hostname!=='passport.migu.cn' || url.port || url.username || url.password || !url.pathname.startsWith('/qrc/') || !text(data.loginId) || expires<=this.now()) throw new Error('网关返回的咪咕二维码无效')
        const image=text(data.qrCodeDataUrl)
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length>1024*1024) throw new Error('网关返回的咪咕二维码图片无效')
        view.url=url.href;view.qrDataUrl=image;view.expiresAt=expires;view.interval=positive(data.pollIntervalMs,3000)/1000
        this.miguFlow={id:text(data.loginId),expires,nextPoll:this.now()+view.interval*1000,terminal:miguTerminal}
      } else if (state==='pending') {
        view.url=previous?.url;view.qrDataUrl=previous?.qrDataUrl;view.expiresAt=this.miguFlow?.expires;view.interval=positive(data.pollIntervalMs,3000)/1000
        if (this.miguFlow) this.miguFlow.nextPoll=this.now()+view.interval*1000
      }
      view.summary=authenticated ? `${label}已登录；播放以账号授权为准` : state==='pending' ? `用咪咕视频 App 扫码，确认${label}登录` : state==='expired' ? '二维码已过期，请刷新' : state==='denied' ? '登录已取消' : `${label}尚未登录`
      if (miguTerminal==='unified' && authenticated) {
        view.tvAuthenticated=data.tvAuthenticated===true
        view.summary=data.tvAuthenticated===true ? '咪咕已登录，TV 和 App 画质已合并' : '咪咕已登录，App 可用；TV 能力暂不可用，取流时会自动检查'
      }
      if (this.miguFlow?.terminal===miguTerminal && (authenticated || c.op==='logout' || ['expired','denied'].includes(state))) this.miguFlow=undefined
    }
    if (c.provider === 'mgtv') {
      if (c.op === 'start') {
        const url = new URL(text(data.qrUrl))
        if (url.protocol !== 'https:' || url.hostname !== 'oauth.mgtv.com' || url.username || url.password || url.port || url.pathname !== '/2.0/multicode_login' || !text(data.sessionId)) throw new Error('网关返回的芒果二维码无效')
        view.url = url.href; view.interval = positive(data.interval,3);view.expiresAt = this.now()+positive(data.expiresIn,300)*1000
        const image = text(data.qrDataUrl)
        if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) && image.length < 1024*1024) view.qrDataUrl = image
        this.mangoFlow = {id:text(data.sessionId),expires:view.expiresAt,nextPoll:this.now()+view.interval*1000}
      } else if (state === 'pending') {
        view.url = previous?.url;view.qrDataUrl = previous?.qrDataUrl;view.expiresAt = this.mangoFlow?.expires;view.interval = positive(data.retryAfter,3)
        if (this.mangoFlow) this.mangoFlow.nextPoll = this.now()+view.interval*1000
      }
      view.summary = authenticated ? '芒果已登录；播放以账号授权为准' : state === 'pending' ? '使用芒果 TV App 扫码并确认' : state === 'expired' ? '二维码已过期，请刷新' : '芒果尚未登录，可扫码登录'
      if (authenticated || c.op === 'logout' || state === 'expired') this.mangoFlow = undefined
    }
    if (c.provider === 'bilibili') {
      if (['qr_pending','qr_waiting','qr_scanned'].includes(state)) view.state = 'pending'
      if (state === 'qr_expired') view.state = 'expired'
      if (c.op === 'start') {
        const url = new URL(text(data.qrUrl))
        if (url.protocol !== 'https:' || !(url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com')) || url.username || url.password || url.port) throw new Error('网关返回的 B 站二维码无效')
        view.url = url.href; view.interval = 2; view.expiresAt = this.now() + positive(data.expiresIn, 180) * 1000
        this.biliFlow = { expires: view.expiresAt, nextPoll: this.now() + 2000 }
      } else if (view.state === 'pending') {
        view.url = previous?.url; view.expiresAt = this.biliFlow?.expires; view.interval = 2
        if (this.biliFlow) this.biliFlow.nextPoll = this.now() + 2000
      }
      view.summary = authenticated ? 'B 站 Web 会话已验证；网关重启需重新登录' : state === 'qr_scanned' ? '已扫码，请在 B 站 App 中确认登录' : view.state === 'pending' ? '使用哔哩哔哩 App 扫码并确认' : state === 'qr_expired' ? '二维码已过期，请刷新' : state === 'expired' ? 'B 站登录已失效，请重新扫码或导入 Cookie' : '匿名可用；高画质可扫码登录或导入本人 Web Cookie'
      if (authenticated || c.op === 'logout' || view.state === 'expired') this.biliFlow = undefined
    }
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
