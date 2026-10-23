/**
 * Crunchyroll SSO 的纯逻辑部分（不碰 electron），方便单测。
 *
 * 实测约束（2026-10，sso.crunchyroll.com）：APK 内置 client_id 只注册了
 * redirect_uri=crunchyroll://auth，配合 response_type=code；换任何别的回调都出错误页。
 * PKCE 的 S256 / plain 都被接受，这里用 S256。
 */
import { createHash, randomBytes } from 'node:crypto'

/** 授权成功后的回跳前缀；桌面端要在这个 scheme 上截获 code。 */
export const CR_REDIRECT_PREFIX = 'crunchyroll://auth'

/** base64url（RFC 4648 §5，无 padding）：PKCE 的 verifier 和 challenge 都用它。 */
export function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** RFC 7636：verifier 要求 43..128 字符的 unreserved；challenge = base64url(sha256(verifier))。 */
export function makePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** random state：一次登录一个，回跳里核对，防串会话。 */
export function makeState(): string {
  return b64url(randomBytes(12))
}

/** 从回跳地址里取授权码；也可能被粘成裸 code。 */
export function authCodeFrom(raw: string): string {
  const text = (raw || '').trim().replace(/^["']|["']$/g, '')
  if (!text) return ''
  try {
    const code = new URL(text).searchParams.get('code')
    if (code) return code
    // 是合法 URL 但没有 code（例如只有 state）：别把整条 URL 当 code
    return ''
  } catch {
    /* 不是合法 URL，继续按裸 code 处理 */
  }
  const m = /[?&]code=([^&#]+)/.exec(text)
  if (m) return decodeURIComponent(m[1])
  return /^[A-Za-z0-9._~-]+$/.test(text) ? text : ''
}

/** 判断这条导航是不是授权回跳。 */
export function isAuthRedirect(url: string): boolean {
  return (url || '').trim().toLowerCase().startsWith(CR_REDIRECT_PREFIX)
}
