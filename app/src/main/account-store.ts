import {
  addSlot, emptyBook, fallbackCandidates, isAccountError, migrateBook, removeSlot, renameSlot, resolveSlot, sanitizeBook,
  setActive, setDefault, setStatus, statusFrom, supportsCookieSlot, type AccountBook, type AccountSlot, type AccountsView,
} from '../shared/accounts'

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
  }

  remove(id: string): void {
    this.book = removeSlot(this.book, id)
    delete this.secrets[id]
    this.persist()
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

  /** 用指定账号（空 = 默认账号）跑 fn；只有能自动切换的才会切 */
  async use<T>(provider: string, accountId: string | undefined, fn: () => Promise<T>): Promise<T> {
    const want = resolveSlot(this.book, provider, accountId)
    if (want && want.id !== this.activeId(provider) && want.mode === 'cookie') await this.activate(want.id)
    return fn()
  }

  /**
   * 跑 fn；遇到会员 / 登录类错误（爱奇艺 Q00503/Q00505 等）就依次换到其它能自动切换的账号再试。
   * onSwitch 用于提示用户「已切换到 xx」。
   */
  async withFallback<T>(provider: string, fn: () => Promise<T>, onSwitch?: (slot: AccountSlot, err: unknown) => void, accountId?: string): Promise<T> {
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

  private markFailed(id: string, err: unknown): void {
    if (!id) return
    const msg = err instanceof Error ? err.message : String(err)
    this.book = setStatus(this.book, id, { short: '受限', summary: msg.slice(0, 120), tone: 'err', vipUntil: this.slot(id)?.status?.vipUntil ?? 0, checkedAt: this.now() })
    this.persist()
  }
}
