export type MovieIdentity = {
  title?: string
  original_title?: string
  originalTitle?: string
  year?: number | string
  searchTitles?: string[]
  metadata?: { search_titles?: string[] }
}

export type SourceIdentityOptions = {
  useMode?: 'fragment' | 'trailer'
  sourceType?: string
  description?: string
}

export type SourceIdentityResult = {
  matches: boolean
  score: number
  reason: 'matched' | 'missing_title' | 'wrong_title' | 'wrong_year' | 'ambiguous_title' | 'wrong_source_type'
}

function normalizeTitle(value: string): string {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function identityNames(movie: MovieIdentity): string[] {
  return [...new Set([
    movie.title, movie.original_title, movie.originalTitle,
    ...(Array.isArray(movie.searchTitles) ? movie.searchTitles : []),
    ...(Array.isArray(movie.metadata?.search_titles) ? movie.metadata.search_titles : []),
  ].map(value => normalizeTitle(String(value || ''))).filter(Boolean))]
}

function explicitYears(value: string): number[] {
  return [...new Set([...String(value || '').matchAll(/\b((?:18|19|20)\d{2})\b/g)].map(match => Number(match[1])))]
}

const ambiguousArticles = new Set(['the', 'a', 'an', 'le', 'la', 'les', 'el', 'der', 'die', 'das'])
const sourceDescriptor = /^(?:\d+|film|movie|full|silent|classic|official|clip|scene|excerpt|fragment|trailer|teaser|фильм|полный|немой|фрагмент|сцена|трейлер|тизер)$/
const reviewTitle = /(?:^|\s)(?:reviews?|reactions?|recaps?|explained|analysis|analyses|featurettes?|interviews?|documentar\p{L}*|обзор\p{L}*|рецензи\p{L}*|разбор\p{L}*|реакци\p{L}*)(?:\s|$)|video essay|behind the scenes|making of/iu
const trailerTitle = /(?:^|\s)(?:trailers?|teasers?|трейлер\p{L}*|тизер\p{L}*|trailer|bande annonce)(?:\s|$)/iu

/** Identity is an exact title phrase, never loose overlap of common words. */
export function validateSourceIdentity(
  candidateTitle: string,
  movie: MovieIdentity,
  options: SourceIdentityOptions = {},
): SourceIdentityResult {
  const fail = (reason: SourceIdentityResult['reason']): SourceIdentityResult => ({ matches: false, score: 0, reason })
  const hay = normalizeTitle(candidateTitle)
  const names = identityNames(movie)
  if (!hay || !names.length) return fail('missing_title')
  const mode = options.useMode || 'fragment'
  const classification = normalizeTitle(candidateTitle + ' ' + (options.description || ''))
  if (reviewTitle.test(classification) || /^(?:review|reaction|recap|analysis)$/i.test(options.sourceType || '')) return fail('wrong_source_type')
  if (mode === 'fragment' && (trailerTitle.test(classification) || /^(?:trailer|teaser)$/i.test(options.sourceType || ''))) return fail('wrong_source_type')
  if (mode === 'trailer' && !trailerTitle.test(hay) && !/^(?:trailer|teaser)$/i.test(options.sourceType || '')) return fail('wrong_source_type')

  const expectedYear = Number(movie.year)
  const hasExpectedYear = Number.isInteger(expectedYear) && expectedYear >= 1888 && expectedYear <= 2099
  const titleYears = explicitYears(candidateTitle)
  if (hasExpectedYear && titleYears.some(year => year !== expectedYear)) return fail('wrong_year')
  const paddedHay = ` ${hay} `
  const found = names.filter(name => paddedHay.includes(` ${name} `))
  if (!found.length) return fail('wrong_title')

  const words = hay.split(' ')
  for (const name of found) {
    const titleWords = name.split(' ')
    const meaningful = titleWords.filter(word => !ambiguousArticles.has(word))
    const ambiguous = meaningful.length <= 1 || name.length <= 5
    if (ambiguous) {
      const segments = String(candidateTitle).split(/[-|:()[\]]/).map(normalizeTitle)
      if (!segments.some(segment => segment === name || segment.startsWith(name + ' '))) continue
      // A year is mandatory for short shared names such as Mother or The Kid.
      const contextYears = titleYears.length ? titleYears : explicitYears(options.description || '')
      if (!hasExpectedYear || !contextYears.includes(expectedYear) || contextYears.some(year => year !== expectedYear)) continue
      let unextended = false
      for (let index = 0; index <= words.length - titleWords.length; index++) {
        if (titleWords.every((word, offset) => words[index + offset] === word)) {
          const next = words[index + titleWords.length]
          // Reject The Kid Detective, Mother and Child, The General's Daughter.
          if (!next || sourceDescriptor.test(next)) unextended = true
        }
      }
      if (!unextended) continue
    }
    return { matches: true, score: hay === name ? 1 : titleYears.includes(expectedYear) ? 0.98 : 0.92, reason: 'matched' }
  }
  return fail('ambiguous_title')
}

/** Compatibility helper for source ranking; rejected identities always score zero. */
export function sourceTitleMatch(candidateTitle: string, movie: MovieIdentity, options: SourceIdentityOptions = {}): number {
  return validateSourceIdentity(candidateTitle, movie, options).score
}

export type DirectVideoProbeOptions = {
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

export type DirectVideoProbeResult = {
  ok: boolean
  url: string
  mimeType?: 'video/mp4' | 'video/webm'
  bytesRead: number
  reason?: 'unsafe_url' | 'redirect_limit' | 'http_error' | 'not_video' | 'empty_response' | 'timeout' | 'network_error'
}

/** Restrict every network hop, including redirects from a trusted repository. */
export function isAllowedDirectVideoUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*archive\.org$/i.test(url.hostname)
      || ['upload.wikimedia.org', 'commons.wikimedia.org'].includes(url.hostname.toLowerCase())
  } catch { return false }
}

function detectedVideoType(sample: Uint8Array): 'video/mp4' | 'video/webm' | undefined {
  if (sample.length >= 8 && sample[4] === 0x66 && sample[5] === 0x74 && sample[6] === 0x79 && sample[7] === 0x70) return 'video/mp4'
  if (sample.length >= 4 && sample[0] === 0x1a && sample[1] === 0x45 && sample[2] === 0xdf && sample[3] === 0xa3) return 'video/webm'
  return undefined
}

/** Reads a bounded prefix and cancels the stream even when a server ignores Range. */
export async function probeDirectVideo(value: string, options: DirectVideoProbeOptions = {}): Promise<DirectVideoProbeResult> {
  const fail = (reason: DirectVideoProbeResult['reason'], url = value, bytesRead = 0): DirectVideoProbeResult => ({ ok: false, url, bytesRead, reason })
  if (!isAllowedDirectVideoUrl(value)) return fail('unsafe_url')
  const request = options.fetch || globalThis.fetch
  const timeoutMs = Math.max(1, Math.min(10_000, options.timeoutMs ?? 3500))
  const maxBytes = Math.max(8, Math.min(1024, Math.floor(options.maxBytes ?? 1024)))
  const maxRedirects = Math.max(0, Math.min(5, Math.floor(options.maxRedirects ?? 3)))
  const controller = new AbortController()
  let current = value
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let body: ReadableStream<Uint8Array> | null = null
  let bytesRead = 0
  let expired = false
  let timeout: ReturnType<typeof setTimeout>
  const cancel = () => {
    if (reader) { void reader.cancel().catch(() => {}); reader = undefined }
    else if (body) { void body.cancel().catch(() => {}) }
    body = null
  }
  const deadline = new Promise<DirectVideoProbeResult>(resolve => {
    timeout = setTimeout(() => { expired = true; controller.abort(); cancel(); resolve(fail('timeout', current, bytesRead)) }, timeoutMs)
  })
  const run = async (): Promise<DirectVideoProbeResult> => {
    try {
      for (let redirects = 0; ; redirects++) {
        if (!isAllowedDirectVideoUrl(current)) return fail('unsafe_url', current)
        const response = await request(current, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: { Range: 'bytes=0-1023', Accept: 'video/mp4, video/webm, application/octet-stream;q=0.8' },
        })
        body = response.body
        if (expired) { cancel(); return fail('timeout', current, bytesRead) }
        if (response.url && !isAllowedDirectVideoUrl(response.url)) { cancel(); return fail('unsafe_url', current) }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          cancel()
          if (!location) return fail('http_error', current)
          if (redirects >= maxRedirects) return fail('redirect_limit', current)
          try { current = new URL(location, current).href } catch { return fail('unsafe_url', current) }
          continue
        }
        if (![200, 206].includes(response.status)) { cancel(); return fail('http_error', current) }
        if (!body) return fail('empty_response', current)
        const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
        reader = body.getReader()
        const chunks: Uint8Array[] = []
        while (bytesRead < Math.min(12, maxBytes)) {
          const chunk = await reader.read()
          if (expired) return fail('timeout', current, bytesRead)
          if (chunk.done) break
          const prefix = chunk.value.subarray(0, maxBytes - bytesRead)
          chunks.push(prefix)
          bytesRead += prefix.length
          if (bytesRead >= maxBytes) break
        }
        cancel()
        if (!bytesRead) return fail('empty_response', current)
        const sample = new Uint8Array(bytesRead)
        let offset = 0
        for (const chunk of chunks) { sample.set(chunk, offset); offset += chunk.length }
        const textPrefix = new TextDecoder().decode(sample.subarray(0, 80)).trimStart()
        if (/^(?:<!doctype\s+html|<html|<\?xml)/i.test(textPrefix)) return fail('not_video', current, bytesRead)
        const magicType = detectedVideoType(sample)
        const mimeType = magicType || (mime === 'video/mp4' || mime === 'video/webm' ? mime : undefined)
        return mimeType ? { ok: true, url: current, mimeType, bytesRead } : fail('not_video', current, bytesRead)
      }
    } catch { return fail(expired || controller.signal.aborted ? 'timeout' : 'network_error', current, bytesRead) }
    finally { cancel() }
  }
  try { return await Promise.race([run(), deadline]) }
  finally { clearTimeout(timeout!); cancel() }
}

export type CountryRestrictions = { allowed?: string[]; blocked?: string[] }

/** Unknown country values never override an explicit provider restriction. */
export function isCountryAvailable(geoblocking: CountryRestrictions | null | undefined, country = 'RU'): boolean {
  const normalizedCountry = String(country || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalizedCountry)) return false
  const allowed = (Array.isArray(geoblocking?.allowed) ? geoblocking.allowed : []).map(value => String(value).toUpperCase())
  const blocked = (Array.isArray(geoblocking?.blocked) ? geoblocking.blocked : []).map(value => String(value).toUpperCase())
  return !blocked.includes(normalizedCountry) && (!allowed.length || allowed.includes(normalizedCountry))
}
