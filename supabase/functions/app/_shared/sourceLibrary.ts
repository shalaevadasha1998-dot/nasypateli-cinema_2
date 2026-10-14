import type { MovieSourceCandidate } from './movies.ts'

const MAX_AGE_MS = 24 * 60 * 60 * 1000
const SUPPORTED_PLATFORMS = ['youtube', 'internet_archive', 'wikimedia_commons', 'rutube']
const SOURCE_TYPES = ['clip', 'full_film', 'trailer', 'teaser', 'unknown']
const RIGHTS = ['unknown', 'allowed', 'restricted']

// Stored links still need validation: an old/manual row is not a URL allowlist.
function allowedSourceUrl(platform: string, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1500) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    if(['p','token','access_token','auth','key'].some(key=>url.searchParams.has(key)))return null
    const host = url.hostname.toLowerCase()
    if (platform === 'youtube') {
      let videoId: string | null = null
      if (host === 'youtu.be') videoId = url.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] || null
      else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
        videoId = url.pathname === '/watch'
          ? url.searchParams.get('v')
          : url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/)?.[1] || null
      } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
        videoId = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/)?.[1] || null
      }
      return videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? url.toString() : null
    }
    if (platform === 'internet_archive') {
      return host === 'archive.org' && /^\/download\/[^/]+\/.+\.(mp4|webm)$/i.test(url.pathname) ? url.toString() : null
    }
    if (platform === 'wikimedia_commons') {
      return host === 'upload.wikimedia.org' && /^\/wikipedia\/commons\/.+\.(mp4|webm)$/i.test(url.pathname) ? url.toString() : null
    }
    if (platform === 'rutube') {
      return ['rutube.ru', 'www.rutube.ru'].includes(host) && /^\/(video|play\/embed)\/[a-f0-9]{32}\/?$/i.test(url.pathname) ? url.toString() : null
    }
  } catch { /* Invalid persisted URL is ignored. */ }
  return null
}

/** Read only. Reuse recent sources for the exact Wikidata entity, never its title. */
export async function loadReusableMovieSources(db: any, movie: any): Promise<MovieSourceCandidate[]> {
  const provider = typeof movie?.provider === 'string' ? movie.provider : ''
  const providerId = typeof movie?.provider_id === 'string' ? movie.provider_id : ''
  if (provider !== 'wikidata' || !/^Q[1-9]\d*$/.test(providerId)) return []
  const now = Date.now()
  const cutoff = now - MAX_AGE_MS
  try {
    const result = await db.from('movie_source_candidates')
      .select('*,movie_candidates!inner(provider,provider_id)')
      .eq('movie_candidates.provider', provider)
      .eq('movie_candidates.provider_id', providerId)
      .eq('verified', true)
      .eq('embeddable', true)
      .eq('availability_status', 'ready')
      .neq('rights_status', 'blocked')
      .in('source_platform', SUPPORTED_PLATFORMS)
      .gte('verified_at', new Date(cutoff).toISOString())
      .lte('verified_at', new Date(now).toISOString())
      .order('verified_at', { ascending: false })
      .limit(20)
    if (result.error || !Array.isArray(result.data)) return []
    const rows: MovieSourceCandidate[] = []
    const seen = new Set<string>()
    for (const row of result.data.slice(0, 20)) {
      const identity = row?.movie_candidates
      if (!identity || Array.isArray(identity) || identity.provider !== provider || identity.provider_id !== providerId) continue
      const verifiedAt = typeof row.verified_at === 'string' ? Date.parse(row.verified_at) : NaN
      if (!Number.isFinite(verifiedAt) || verifiedAt < cutoff || verifiedAt > now) continue
      if (row.verified !== true || row.embeddable !== true || row.availability_status !== 'ready' || !RIGHTS.includes(row.rights_status)) continue
      if (!['fragment', 'trailer'].includes(row.use_mode) || !SOURCE_TYPES.includes(row.source_type)) continue
      const sourceUrl = allowedSourceUrl(row.source_platform, row.source_url)
      if (!sourceUrl || typeof row.id !== 'string' || !row.id) continue
      const startSec = Number(row.start_sec)
      const endSec = row.end_sec == null ? null : Number(row.end_sec)
      const confidence = Number(row.confidence)
      if (!Number.isInteger(startSec) || startSec < 0 || (endSec !== null && (!Number.isInteger(endSec) || endSec <= startSec))) continue
      if (!Number.isFinite(confidence) || confidence < 0.6 || confidence > 1) continue
      const videoId = typeof row.video_id === 'string' && row.video_id ? row.video_id : undefined
      if (['youtube', 'rutube'].includes(row.source_platform) && videoId) {
        const url = new URL(sourceUrl)
        const urlId = url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).at(-1)
        if (videoId !== urlId) continue
      }
      const key = [row.source_platform, sourceUrl, startSec, endSec ?? '', row.use_mode].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      const metadata: Record<string, unknown> = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? { ...row.metadata } : {}
      delete metadata.manual_selected
      delete metadata.manualSelected
      rows.push({
        useMode: row.use_mode,
        sourceType: row.source_type,
        sourcePlatform: row.source_platform,
        sourceUrl,
        videoId,
        title: typeof row.title === 'string' ? row.title : undefined,
        sourceChannel: typeof row.source_channel === 'string' ? row.source_channel : undefined,
        startSec,
        endSec,
        verified: true,
        embeddable: true,
        official: row.official === true,
        rightsStatus: row.rights_status,
        confidence,
        metadata: { ...metadata, cached: true, cached_source_id: row.id, cached_verified_at: row.verified_at }
      })
    }
    return rows
  } catch { return [] }
}
