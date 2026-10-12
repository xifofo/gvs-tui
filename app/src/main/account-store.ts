import {
  addSlot, emptyBook, fallbackCandidates, isAccountError, migrateBook, removeSlot, renameSlot, resolveSlot, sanitizeBook,
  setActive, setDefault, setStatus, statusFrom, supportsCookieSlot, type AccountBook, type AccountSlot, type AccountsView,
} from '../shared/accounts'
import { gatewayAccountId, GW_DEFAULT_ACCOUNT } from '../../../src/lib/client'

/**
 * 多账号网关（feature-detect 后才有）：每个槽位在网关有自己的会话，切换 = 换请求头，
 * 不再重导入 Cookie、扫码槽位也不用重扫，也不需要按平台串行切换。
 */
export type GatewayAccounts = {
  supports(provider: string): boolean
  ensure(provider: string, account: string, name: string): Promise<void>
  rename(provider: string, account: string, name: string): Promise<void>
  remove(provider: string, account: string): Promise<void>
  /** 设定界面当前账号（扫码 / 状态检查用） */
  setActive(provider: string, account: string): void
  /** 在该账号下跑 fn */
  run<T>(provider: string, account: string, fn: () => Promise<T>): Promise<T>
}

/**
 * 多账号存储 + 切换 + 换号重试。不依赖 Electron：加密、读写、导入网关都由外面注入。
 * 文件里只有槽位元数据和加密后的凭证（safeStorage 不可用时拒绝保存凭证，只能用扫码槽位）。
 */
export type AccountDeps = {
  load(): string | null
  save(json: string): void
  /** null = 本机无法加密（不保存 Cookie） */
  encrypt(plain: string): string | null
  decrypt(cipher: string): string
  importCookie(provider: string, cookie: string): Promise<void>
  /** 网关当前会话的状态（来自 Core.state().accounts） */
  statusOf(provider: string): { short: string; summary: string; tone: 'ok' | 'warn' | 'err' | 'muted' } | undefined
  changed(view: AccountsView): void
  /** 没有 = 旧网关行为 */
  gateway?: GatewayAccounts
  log?: (line: string) => void
  now?: () => number
}

type FileShape = { book: AccountBook; secrets: Record<string, string> }

export type ActivateResult = { slot: AccountSlot; needsLogin: boolean }

export class AccountStore {
  private book: AccountBook = emptyBook()
  private secrets: Record<string, string> = {}
  private readonly now: () => number
  /** 同一平台的切换串行，避免两个任务同时把网关会话换来换去 */
  private locks = new Map<string, Promise<unknown>>()
  /** 已在网关登记过的账号（provider\0gwId） */
  private ensured = new Set<string>()

  constructor(private readonly deps: AccountDeps) {
    this.now = deps.now ?? Date.now
    try {
      const raw = deps.load()
      if (raw) {
        const f = JSON.parse(raw) as Partial<FileShape>
        this.book = sanitizeBook(f.book)
        this.secrets = f.secrets && typeof f.secrets === 'object' ? { ...f.secrets } : {}
      }
    } catch (e) {
      deps.log?.(`accounts: load failed ${e instanceof Error ? e.message : e}`)
    }
  }

  /** 网关是否为这个平台托管多份会话 */
  multi(provider: string): boolean {
    return !!this.deps.gateway?.supports(provider)
  }

  /** 槽位在网关的账号 id：迁移来的旧会话槽位 = default，其余按槽位 id 派生 */
  gatewayId(slot: AccountSlot): string {
    return slot.mode === 'gateway' ? GW_DEFAULT_ACCOUNT : gatewayAccountId(slot.id)
  }

  private async ensureGw(slot: AccountSlot): Promise<string> {
    const gw = this.gatewayId(slot)
    const k = slot.provider + '\0' + gw
    if (gw !== GW_DEFAULT_ACCOUNT && !this.ensured.has(k)) {
      await this.deps.gateway!.ensure(slot.provider, gw, slot.name)
      this.ensured.add(k)
    }
    return gw
  }

  /** 网关重连 / 能力变化后调用：重新登记，并把当前账号告诉网关客户端 */
  syncGateway(): void {
    this.ensured.clear()
    for (const [p, id] of Object.entries(this.book.active)) {
      const s = this.slot(id)
      if (s && this.multi(p)) this.deps.gateway!.setActive(p, this.gatewayId(s))
    }
  }

  view(): AccountsView {
    return { book: structuredClone(this.book), encryption: this.deps.encrypt('probe') !== null }
  }

  private persist(): void {
    this.deps.save(JSON.stringify({ book: this.book, secrets: this.secrets } satisfies FileShape))
    this.deps.changed(this.view())
  }

  /** 连上网关、知道开通了哪些平台后调用；旧版单账号 → 每平台一个默认账号 */
  migrate(providers: string[]): void {
    const { book, changed } = migrateBook(this.book, providers, this.now())
    this.book = book
    if (changed) this.persist()
  }

  activeId(provider: string): string { return this.book.active[provider] ?? '' }
  defaultId(provider: string): string { return this.book.defaults[provider] ?? '' }
  slot(id: string): AccountSlot | undefined { return this.book.slots.find((s) => s.id === id) }
  nameOf(id: string): string { return this.slot(id)?.name ?? '' }

  /** 网关会话状态刷新后，记到当前生效的槽位上 */
  recordStatus(provider: string): void {
    const id = this.activeId(provider)
    const st = statusFrom(this.deps.statusOf(provider), this.now())
    if (!id || !st) return
    const old = this.slot(id)?.status
    if (old && old.short === st.short && old.summary === st.summary && old.tone === st.tone) return
    this.book = setStatus(this.book, id, st)
    this.persist()
  }

  async add(provider: string, name: string, cookie?: string): Promise<ActivateResult> {
    const c = cookie?.trim() ?? ''
    if (c && !supportsCookieSlot(provider)) throw new Error('这个平台只能扫码登录')
    if (!c && this.multi(provider)) {
      const r = addSlot(this.book, provider, name, 'qr', false, this.now())
      await this.ensureGw(r.slot)
      this.book = r.book
      this.persist()
      await this.activate(r.slot.id, true)
      return { slot: r.slot, needsLogin: true }
    }
    if (c) {
      const enc = this.deps.encrypt(c)
      if (enc === null) throw new Error('本机无法加密保存 Cookie（系统密钥环不可用），请改用扫码添加')
      const r = addSlot(this.book, provider, name, 'cookie', true, this.now())
      this.book = r.book
      this.secrets[r.slot.id] = enc
      this.persist()
      return this.activate(r.slot.id)
    }
    const r = addSlot(this.book, provider, name, 'qr', false, this.now())
    this.book = setActive(r.book, r.slot.id)
    this.persist()
    return { slot: r.slot, needsLogin: true }
  }

  rename(id: string, name: string): void {
    this.book = renameSlot(this.book, id, name)
    this.persist()
    const s = this.slot(id)
    if (s && this.multi(s.provider) && this.gatewayId(s) !== GW_DEFAULT_ACCOUNT) {
      void this.deps.gateway!.rename(s.provider, this.gatewayId(s), s.name).catch((e) => this.deps.log?.(`accounts: gateway rename failed ${e instanceof Error ? e.message : e}`))
    }
  }

  remove(id: string): void {
    const s = this.slot(id)
    this.book = removeSlot(this.book, id)
    delete this.secrets[id]
    this.persist()
    if (s && this.multi(s.provider)) {
      const gw = this.gatewayId(s)
      this.ensured.delete(s.provider + '\0' + gw)
      // 网关会先注销这个账号的会话再删除登记
      if (gw !== GW_DEFAULT_ACCOUNT) void this.deps.gateway!.remove(s.provider, gw).catch((e) => this.deps.log?.(`accounts: gateway delete failed ${e instanceof Error ? e.message : e}`))
      const now = this.activeId(s.provider)
      const cur = now ? this.slot(now) : undefined
      if (cur) this.deps.gateway!.setActive(s.provider, this.gatewayId(cur))
    }
  }

  setDefault(id: string): void {
    this.book = setDefault(this.book, id)
    this.persist()
  }

  /** 给槽位换一份 Cookie（例如 Cookie 过期后重新粘贴） */
  async updateCookie(id: string, cookie: string): Promise<ActivateResult> {
    const s = this.slot(id)
    if (!s) throw new Error('账号不存在')
    if (!supportsCookieSlot(s.provider)) throw new Error('这个平台只能扫码登录')
    const enc = this.deps.encrypt(cookie.trim())
    if (enc === null) throw new Error('本机无法加密保存 Cookie')
    this.secrets[id] = enc
    this.book = { ...this.book, slots: this.book.slots.map((x) => (x.id === id ? { ...x, mode: 'cookie', hasSecret: true } : x)) }
    this.persist()
    return this.activate(id, true)
  }

  /**
   * 让某个账号在网关生效。cookie 槽位：重新导入网关；扫码 / 网关槽位：如果它已经是当前会话就什么都不做，
   * 否则返回 needsLogin，由界面走扫码流程。
   */
  activate(id: string, force = false): Promise<ActivateResult> {
    const s = this.slot(id)
    if (!s) return Promise.reject(new Error('账号不存在'))
    if (this.multi(s.provider)) return this.activateMulti(s, force)
    const prev = this.locks.get(s.provider) ?? Promise.resolve()
    const run = prev.catch(() => {}).then(async (): Promise<ActivateResult> => {
      if (!force && this.activeId(s.provider) === id) return { slot: s, needsLogin: false }
      if (s.mode === 'cookie' && this.secrets[id]) {
        await this.deps.importCookie(s.provider, this.deps.decrypt(this.secrets[id]!))
        this.book = setActive(this.book, id)
        this.persist()
        return { slot: s, needsLogin: false }
      }
      this.book = setActive(this.book, id)
      this.persist()
      return { slot: s, needsLogin: true }
    })
    this.locks.set(s.provider, run)
    return run
  }

  /**
   * 多账号网关：不串行、不重导入。cookie 槽位第一次（或 force）把 Cookie 导进它自己的网关账号；
   * 扫码槽位只要登录过就直接可用（网关替它保存会话），没登录过才需要扫码。
   */
  private async activateMulti(s: AccountSlot, force: boolean): Promise<ActivateResult> {
    const gw = await this.ensureGw(s)
    if (s.mode === 'cookie' && this.secrets[s.id] && (force || !this.imported.has(s.id))) {
      await this.deps.gateway!.run(s.provider, gw, () => this.deps.importCookie(s.provider, this.deps.decrypt(this.secrets[s.id]!)))
      this.imported.add(s.id)
    }
    this.book = setActive(this.book, s.id)
    this.persist()
    this.deps.gateway!.setActive(s.provider, gw)
    const needsLogin = s.mode === 'qr' && s.status?.tone !== 'ok'
    return { slot: s, needsLogin }
  }

  /** 本次运行里已导入过网关的 cookie 槽位（网关重启会丢内存会话，遇到登录错误会再导一次） */
  private imported = new Set<string>()

  /** 用指定账号（空 = 默认账号）跑 fn；只有能自动切换的才会切 */
  async use<T>(provider: string, accountId: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (this.multi(provider)) {
      const want = resolveSlot(this.book, provider, accountId) ?? (this.activeId(provider) ? this.slot(this.activeId(provider)) : undefined)
      if (!want) return fn()
      const gw = await this.ensureGw(want)
      if (want.mode === 'cookie' && this.secrets[want.id] && !this.imported.has(want.id)) {
        await this.deps.gateway!.run(provider, gw, () => this.deps.importCookie(provider, this.deps.decrypt(this.secrets[want.id]!)))
        this.imported.add(want.id)
      }
      return this.deps.gateway!.run(provider, gw, fn)
    }
    const want = resolveSlot(this.book, provider, accountId)
    if (want && want.id !== this.activeId(provider) && want.mode === 'cookie') await this.activate(want.id)
    return fn()
  }

  /**
   * 跑 fn；遇到会员 / 登录类错误（爱奇艺 Q00503/Q00505 等）就依次换到其它能自动切换的账号再试。
   * onSwitch 用于提示用户「已切换到 xx」。
   */
  async withFallback<T>(provider: string, fn: () => Promise<T>, onSwitch?: (slot: AccountSlot, err: unknown) => void, accountId?: string): Promise<T> {
    if (this.multi(provider)) return this.withFallbackMulti(provider, fn, onSwitch, accountId)
    let firstErr: unknown
    try {
      return await this.use(provider, accountId, fn)
    } catch (e) {
      if (!isAccountError(e)) throw e
      firstErr = e
    }
    const failed = this.activeId(provider)
    this.markFailed(failed, firstErr)
    for (const s of fallbackCandidates(this.book, provider, failed)) {
      try {
        await this.activate(s.id)
        onSwitch?.(s, firstErr)
        return await fn()
      } catch (e) {
        this.markFailed(s.id, e)
        if (!isAccountError(e)) throw e
      }
    }
    throw firstErr
  }

  /** 多账号网关：直接在别的账号下重试，不切换「当前账号」；扫码槽位登录过也能顶上 */
  private async withFallbackMulti<T>(provider: string, fn: () => Promise<T>, onSwitch?: (slot: AccountSlot, err: unknown) => void, accountId?: string): Promise<T> {
    const first = resolveSlot(this.book, provider, accountId) ?? this.slot(this.activeId(provider))
    let firstErr: unknown
    try {
      return await this.use(provider, first?.id, fn)
    } catch (e) {
      if (!isAccountError(e)) throw e
      firstErr = e
    }
    // cookie 槽位可能只是网关重启丢了内存会话：重导一次再试
    if (first?.mode === 'cookie' && this.secrets[first.id]) {
      this.imported.delete(first.id)
      try { return await this.use(provider, first.id, fn) } catch (e) { if (!isAccountError(e)) throw e }
    }
    if (first) this.markFailed(first.id, firstErr)
    const others = this.book.slots.filter((s) => s.provider === provider && s.id !== first?.id && ((s.mode === 'cookie' && s.hasSecret) || s.status?.tone === 'ok'))
    for (const s of [...fallbackCandidates(this.book, provider, first?.id ?? ''), ...others].filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i)) {
      try {
        const out = await this.use(provider, s.id, fn)
        onSwitch?.(s, firstErr)
        return out
      } catch (e) {
        this.markFailed(s.id, e)
        if (!isAccountError(e)) throw e
      }
    }
    throw firstErr
  }

  private markFailed(id: string, err: unknown): void {
    if (!id) return
    const msg = err instanceof Error ? err.message : String(err)
    this.book = setStatus(this.book, id, { short: '受限', summary: msg.slice(0, 120), tone: 'err', vipUntil: this.slot(id)?.status?.vipUntil ?? 0, checkedAt: this.now() })
    this.persist()
  }
}
