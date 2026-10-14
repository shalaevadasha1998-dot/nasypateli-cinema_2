import {
  isAllowedDirectVideoUrl,
  isCountryAvailable,
  probeDirectVideo,
  sourceTitleMatch,
  validateSourceIdentity,
} from '../supabase/functions/app/_shared/videoValidation.ts'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const bytes = (...values: number[]) => new Uint8Array(values)
const mp4 = bytes(0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d)
const webm = bytes(0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d)
const mockFetch = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) =>
  ((input: URL | RequestInfo, init?: RequestInit) => Promise.resolve(handler(String(input), init || {}))) as typeof fetch

Deno.test('film identities reject different titles, review content, trailers and explicit wrong years', () => {
  const movie = { title: 'A Trip to the Moon', originalTitle: 'Le Voyage dans la Lune', year: 1902 }
  check(validateSourceIdentity('A Trip to the Moon (1902) restored scene', movie).matches, 'Matching film rejected')
  check(validateSourceIdentity('Le Voyage dans la Lune - official clip', movie).matches, 'Exact original title rejected')
  check(!validateSourceIdentity('Moon Trip documentary 1902', movie).matches, 'Token overlap accepted as same film')
  check(validateSourceIdentity('A Trip to the Moon (2020)', movie).reason === 'wrong_year', 'Different explicit year accepted')
  for (const title of ['A Trip to the Moon review', 'A Trip to the Moon official trailer', 'A Trip to the Moon recap', 'A Trip to the Moon video essay', 'A Trip to the Moon рецензия']) {
    check(!validateSourceIdentity(title, movie).matches, `Wrong fragment type accepted: ${title}`)
  }
  check(validateSourceIdentity('A Trip to the Moon official trailer', movie, { useMode: 'trailer' }).matches, 'Trailer mode rejected trailer')
  check(!validateSourceIdentity('A Trip to the Moon scene', movie, { useMode: 'trailer' }).matches, 'Scene accepted as trailer')
  check(!validateSourceIdentity('A Trip to the Moon clip', movie, { sourceType: 'review' }).matches, 'Known review type bypassed title')
  check(sourceTitleMatch('Moon Trip documentary', movie) === 0, 'Rejected film has nonzero score')
})

Deno.test('short shared film names require the correct year and never match extended names', () => {
  for (const [title, year, otherTitle] of [
    ['The Kid', 1921, 'The Kid Detective 1921 clip'],
    ['Mother', 1926, 'Mother and Child 1926 scene'],
    ['The General', 1926, "The General's Daughter 1926 clip"],
  ] as const) {
    const movie = { title, year }
    check(!validateSourceIdentity(`${title} clip`, movie).matches, `Ambiguous title accepted without year: ${title}`)
    check(!validateSourceIdentity(`${title} ${year + 1} scene`, movie).matches, `Wrong short-title year accepted: ${title}`)
    check(!validateSourceIdentity(otherTitle, movie).matches, `Extended title accepted: ${otherTitle}`)
    check(validateSourceIdentity(`${title} (${year}) full film`, movie).matches, `Exact short title rejected: ${title}`)
    check(validateSourceIdentity(`${title} scene`, movie, { description: `${year} silent film` }).matches, 'Metadata year ignored')
  }
  check(!validateSourceIdentity('Mother 1926 full film', { title: 'Mother' }).matches, 'Unidentified short-title edition accepted')
  check(validateSourceIdentity('Metropolis 1927 film', { title: 'Metropolis', year: 1927 }).matches, 'One-word film with year rejected')
})

Deno.test('direct video URL allowlist rejects scheme, credentials, misleading suffixes and nonstandard ports', () => {
  for (const url of ['https://archive.org/download/a/a.mp4', 'https://ia800123.us.archive.org/a.mp4', 'https://upload.wikimedia.org/a.webm', 'https://commons.wikimedia.org/wiki/Special:FilePath/a.webm']) {
    check(isAllowedDirectVideoUrl(url), `Trusted repository rejected: ${url}`)
  }
  for (const url of ['http://archive.org/a.mp4', 'https://archive.org.evil.example/a.mp4', 'https://notarchive.org/a.mp4', 'https://.archive.org/a.mp4', 'https://archive.org:8443/a.mp4', 'https://user:pass@archive.org/a.mp4', 'https://127.0.0.1/a.mp4', 'https://[::1]/a.mp4', 'file:///a.mp4', 'https://wikimedia.org/a.mp4']) {
    check(!isAllowedDirectVideoUrl(url), `Unsafe URL accepted: ${url}`)
  }
})

Deno.test('direct video probe requests Range and accepts MP4/WebM MIME or magic bytes', async () => {
  for (const [body, mime, expected] of [
    [mp4, 'application/octet-stream', 'video/mp4'],
    [webm, 'application/octet-stream', 'video/webm'],
    [bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), 'video/mp4; codecs=avc1', 'video/mp4'],
    [webm, 'VIDEO/WEBM', 'video/webm'],
  ] as const) {
    let requests = 0
    const result = await probeDirectVideo('https://archive.org/a.mp4', {
      fetch: mockFetch((_url, init) => {
        requests++
        check(init.redirect === 'manual', 'Fetch can follow unvalidated redirect')
        check(new Headers(init.headers).get('range') === 'bytes=0-1023', 'Bounded Range missing')
        check(init.signal instanceof AbortSignal, 'Fetch has no abort signal')
        return new Response(body, { status: 206, headers: { 'content-type': mime } })
      }),
    })
    check(result.ok && result.mimeType === expected, `Video probe rejected supported type: ${mime}`)
    check(requests === 1 && result.bytesRead <= 1024, 'Probe exceeded bounded request')
  }
  for (const [body, mime] of [['<!doctype html><html>blocked', 'video/mp4'], ['login required', 'text/html'], ['', 'video/webm']] as const) {
    const result = await probeDirectVideo('https://archive.org/a.mp4', { fetch: mockFetch(() => new Response(body, { headers: { 'content-type': mime } })) })
    check(!result.ok, `Non-video payload accepted: ${mime} / ${body}`)
  }
})

Deno.test('video probe cancels a large response even when Range is ignored', async () => {
  let cancelled = false
  let reads = 0
  const large = new Uint8Array(256_000)
  large.set(mp4)
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(large) },
    cancel() { cancelled = true },
  }, { highWaterMark: 0 })
  const result = await probeDirectVideo('https://upload.wikimedia.org/a.mp4', { fetch: mockFetch(() => new Response(stream, { headers: { 'content-type': 'video/mp4' } })) })
  check(result.ok, 'Large MP4 prefix rejected')
  check(result.bytesRead === 1024, 'Probe retained oversized chunk')
  check(cancelled && reads === 1, 'Probe continued downloading entire film')
})

Deno.test('each redirect is manually validated and redirect count is bounded', async () => {
  const visited: string[] = []
  const safe = await probeDirectVideo('https://archive.org/a.mp4', {
    fetch: mockFetch(url => {
      visited.push(url)
      return visited.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://ia801234.archive.org/a.mp4' } }) : new Response(mp4)
    }),
  })
  check(safe.ok && visited.length === 2 && new URL(safe.url).hostname === 'ia801234.archive.org', 'Safe redirect failed')
  for (const target of ['http://archive.org/a.mp4', 'https://127.0.0.1/secret', 'https://evil.example/a.mp4', 'https://archive.org.evil.example/a.mp4', 'https://user:pass@archive.org/a.mp4']) {
    let calls = 0
    const denied = await probeDirectVideo('https://archive.org/a.mp4', { fetch: mockFetch(() => { calls++; return new Response(null, { status: 302, headers: { location: target } }) }) })
    check(!denied.ok && denied.reason === 'unsafe_url' && calls === 1, `Unsafe redirect requested: ${target}`)
  }
  let loopCalls = 0
  const loop = await probeDirectVideo('https://archive.org/loop', { maxRedirects: 2, fetch: mockFetch(() => { loopCalls++; return new Response(null, { status: 307, headers: { location: '/loop' } }) }) })
  check(!loop.ok && loop.reason === 'redirect_limit' && loopCalls === 3, 'Unbounded redirect loop')
  let badUrlCalls = 0
  const badUrl = await probeDirectVideo('https://evil.example/a.mp4', { fetch: mockFetch(() => { badUrlCalls++; return new Response(mp4) }) })
  check(!badUrl.ok && badUrlCalls === 0, 'Unsafe initial URL contacted')
})

Deno.test('video probe deadline covers stalled fetch and stalled body reads', async () => {
  const stalledFetch = await probeDirectVideo('https://archive.org/a.mp4', { timeoutMs: 10, fetch: (() => new Promise(() => {})) as typeof fetch })
  check(!stalledFetch.ok && stalledFetch.reason === 'timeout', 'Stalled fetch has no enforced deadline')
  let cancelled = false
  const stalledBody = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}) }, cancel() { cancelled = true } })
  const result = await probeDirectVideo('https://archive.org/a.mp4', { timeoutMs: 10, fetch: mockFetch(() => new Response(stalledBody, { headers: { 'content-type': 'video/mp4' } })) })
  check(!result.ok && result.reason === 'timeout' && cancelled, 'Stalled video body escaped deadline/cancellation')
})

Deno.test('country restrictions respect allowed and blocked lists', () => {
  check(isCountryAvailable(undefined), 'Unrestricted video blocked')
  check(isCountryAvailable({ allowed: [], blocked: [] }), 'Empty restrictions treated as deny')
  check(isCountryAvailable({ allowed: ['ru', 'US'] }), 'Country code normalization failed')
  check(!isCountryAvailable({ allowed: ['US'] }), 'Allowed list bypassed')
  check(!isCountryAvailable({ blocked: ['RU'] }), 'Blocked Russia accepted')
  check(!isCountryAvailable({ allowed: ['RU'], blocked: ['RU'] }), 'Allowed list overrode explicit block')
  check(!isCountryAvailable(undefined, ''), 'Unknown country accepted')
})
