/** Browser credentials are scoped to the exact origin that supplied them. */
export interface BrowserContext {
  origin: string
  headers: Record<string, string>
}

export function browserHeaders(url: URL, context?: BrowserContext): Record<string, string> {
  if (!context || url.origin !== context.origin) return {}
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(context.headers)) {
    if (
      /^(cookie|authorization|referer|user-agent|origin|accept|accept-language)$/i.test(name) &&
      typeof value === 'string' &&
      value.length < 65536 &&
      !/[\r\n\0]/.test(value)
    ) {
      result[name.toLowerCase()] = value
    }
  }
  return result
}

export function httpUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 32768) throw new Error('Invalid download URL')
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP and HTTPS downloads are supported')
  }
  return url
}
