type Fetcher = (url: string, init: RequestInit) => Promise<Response>
type IQAuthNetwork = {
  fetch: (url: string, init: RequestInit, proxy: string) => Promise<Response>
  resolveProxy: (url: string) => Promise<string>
  log: (line: string) => void
}

const AUTH_HOSTS = new Set(['passport.iq.com', 'intl-passport.iqiyi.com'])

/** Account endpoints only; media and other providers keep their own transport. */
export function isIQAuthURL(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && AUTH_HOSTS.has(url.hostname)
}

export function createIQAuthRoute(network: IQAuthNetwork): (url: URL) => Promise<Fetcher | undefined> {
  return async url => {
    if (!isIQAuthURL(url)) return undefined
    const policy = await network.resolveProxy(url.href)
    // Respect the first PAC decision. DIRECT retains the tunnel's fake-IP-safe transport.
    if (/^\s*DIRECT(?:\s*;|\s*$)/i.test(policy)) {
      network.log(`iq_auth_transport host=${url.hostname} route=direct`)
      return undefined
    }
    const match = /^\s*(PROXY|HTTPS)\s+([^\s;]+)/i.exec(policy)
    if (!match) throw new Error('IQ 登录的系统代理类型不支持，请使用 HTTP/HTTPS 系统代理')
    const proxy = `${match[1]!.toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`
    return async (input, init) => {
      // Log routing and HTTP status, never paths, queries, credentials or bodies.
      const route = 'system-proxy'
      network.log(`iq_auth_transport host=${url.hostname} route=${route}`)
      try {
        const response = await network.fetch(input, { ...init, credentials: 'omit', cache: 'no-store' }, proxy)
        network.log(`iq_auth_transport host=${url.hostname} route=${route} http=${response.status}`)
        return response
      } catch (error) {
        network.log(`iq_auth_transport host=${url.hostname} route=${route} failed`)
        throw error
      }
    }
  }
}
