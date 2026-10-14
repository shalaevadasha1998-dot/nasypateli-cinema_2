import { loadReusableMovieSources } from '../supabase/functions/app/_shared/sourceLibrary.ts'

function check(value: unknown, message: string) { if (!value) throw new Error(message) }
const movie = { provider: 'wikidata', provider_id: 'Q123', title: 'same title' }
const fresh = () => new Date(Date.now() - 1000).toISOString()
const row = (patch: Record<string, unknown> = {}) => ({
  id: 'original-source', movie_candidates: { provider: 'wikidata', provider_id: 'Q123' },
  use_mode: 'fragment', source_type: 'clip', source_platform: 'youtube',
  source_url: 'https://www.youtube.com/watch?v=abcdefghijk', video_id: 'abcdefghijk',
  title: 'scene', source_channel: 'channel', start_sec: 10, end_sec: 70,
  verified: true, embeddable: true, official: true, rights_status: 'allowed',
  availability_status: 'ready', confidence: '0.8', verified_at: fresh(), metadata: { license: 'CC', manual_selected: true },
  ...patch
})
function mockDb(rows: any[] = [], error: unknown = null, throws = false) {
  const calls: any[][] = []
  const chain: any = { then(resolve: any, reject: any) {
    return (throws ? Promise.reject(new Error('offline')) : Promise.resolve({ data: rows, error })).then(resolve, reject)
  } }
  for (const name of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'order', 'limit']) {
    chain[name] = (...args: any[]) => { calls.push([name, ...args]); return chain }
  }
  return { calls, from(table: string) { calls.push(['from', table]); return chain } }
}

Deno.test('source library uses exact provider identity and keeps source provenance without event approval', async () => {
  const original = row()
  const db = mockDb([original])
  const sources = await loadReusableMovieSources(db, movie)
  check(sources.length === 1, 'valid source was not reused')
  check(sources[0].startSec === 10 && sources[0].endSec === 70 && sources[0].confidence === .8, 'source values were not mapped')
  check(sources[0].metadata.cached === true && sources[0].metadata.cached_source_id === 'original-source', 'cache provenance missing')
  check(sources[0].metadata.license === 'CC', 'source license metadata lost')
  check(!('manual_selected' in sources[0].metadata), 'another event manual approval was copied')
  check(original.metadata.manual_selected === true, 'stored metadata was mutated')
  check(db.calls.some(call => call[0] === 'select' && call[1] === '*,movie_candidates!inner(provider,provider_id)'), 'identity join missing')
  check(db.calls.some(call => call[0] === 'eq' && call[1] === 'movie_candidates.provider' && call[2] === 'wikidata'), 'provider filter missing')
  check(db.calls.some(call => call[0] === 'eq' && call[1] === 'movie_candidates.provider_id' && call[2] === 'Q123'), 'movie ID filter missing')
  check(db.calls.some(call => call[0] === 'gte' && call[1] === 'verified_at'), 'freshness filter missing')
  check(db.calls.some(call => call[0] === 'limit' && call[1] === 20), 'query is not bounded')
  check(!db.calls.some(call => ['update', 'insert', 'delete', 'upsert'].includes(call[0])), 'library wrote to database')
})

Deno.test('source library never searches by a title when provider or ID is missing', async () => {
  for (const invalid of [{ title: 'same title' }, { ...movie, provider: 'tmdb' }, { ...movie, provider_id: '' }, { ...movie, provider_id: 'Q0' }, { ...movie, provider_id: 'Q123,provider_id.eq.Q999' }]) {
    const db = mockDb([row()])
    check((await loadReusableMovieSources(db, invalid)).length === 0, 'invalid identity returned source')
    check(db.calls.length === 0, 'invalid identity queried database')
  }
})

Deno.test('source library rejects stale, unavailable, blocked, mismatched and unsafe rows', async () => {
  const patches = [
    { movie_candidates: { provider: 'wikidata', provider_id: 'Q999' } },
    { movie_candidates: { provider: 'tmdb', provider_id: 'Q123' } },
    { movie_candidates: null },
    { verified_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
    { verified_at: new Date(Date.now() + 60 * 1000).toISOString() },
    { verified_at: null }, { verified: false }, { embeddable: false },
    { availability_status: 'blocked' }, { availability_status: 'dead' }, { availability_status: 'candidate' },
    { rights_status: 'blocked' }, { source_platform: 'vimeo' },
    { source_url: 'https://youtube.com.evil.example/watch?v=abcdefghijk' },
    { source_url: 'https://www.youtube.com/redirect?q=https://evil.example' },
    { source_url: 'http://www.youtube.com/watch?v=abcdefghijk' },
    { source_url: 'https://user:password@www.youtube.com/watch?v=abcdefghijk' },
    { video_id: 'wrong-id-00' }, { start_sec: -1 }, { end_sec: 5 },
    { confidence: 'NaN' }, { metadata: { manual_selected: 'true' }, source_url: 'javascript:alert(1)' }
  ]
  for (const patch of patches) {
    const sources = await loadReusableMovieSources(mockDb([row(patch)]), movie)
    check(sources.length === 0, 'unsafe cached source was accepted: ' + JSON.stringify(patch))
  }
})

Deno.test('source library supports only the fixed video hosts and deduplicates cached sources', async () => {
  const youtube = row({ metadata: { manual_selected: 'true', manualSelected: true } })
  const rows = [youtube, row(),
    row({ id: 'archive', source_platform: 'internet_archive', source_url: 'https://archive.org/download/film/scene.mp4', video_id: null }),
    row({ id: 'commons', source_platform: 'wikimedia_commons', source_url: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Scene.webm', video_id: null }),
    row({ id: 'rutube', source_platform: 'rutube', source_url: 'https://rutube.ru/video/' + 'a'.repeat(32) + '/', video_id: 'a'.repeat(32) }),
    row({ source_platform: 'internet_archive', source_url: 'https://archive.org.evil.example/download/film/scene.mp4' }),
    row({ source_platform: 'wikimedia_commons', source_url: 'https://commons.wikimedia.org/wiki/File:Scene.webm' }),
    row({ source_platform: 'rutube', source_url: 'https://rutube.ru/redirect/?url=https://evil.example' }),
    row({ source_platform: 'rutube', source_url: 'https://rutube.ru/video/' + 'a'.repeat(32) + '/', video_id: 'b'.repeat(32) })
  ]
  const sources = await loadReusableMovieSources(mockDb(rows), movie)
  check(sources.length === 4, 'supported hosts or deduplication failed')
  check(sources.every(source => !('manual_selected' in source.metadata) && !('manualSelected' in source.metadata)), 'manual approval survived reuse')
})

Deno.test('source library gracefully handles database errors and respects the row bound', async () => {
  check((await loadReusableMovieSources(mockDb([], { message: 'not available' }), movie)).length === 0, 'database error escaped')
  check((await loadReusableMovieSources(mockDb([], null, true), movie)).length === 0, 'rejected database query escaped')
  check((await loadReusableMovieSources({ from() { throw new Error('not configured') } }, movie)).length === 0, 'builder exception escaped')
  const rows = Array.from({ length: 30 }, (_, index) => row({ id: String(index), start_sec: index, end_sec: index + 60 }))
  check((await loadReusableMovieSources(mockDb(rows), movie)).length === 20, 'in-memory row limit missing')
})

Deno.test('older direct files are rechecked before reuse rather than forgotten',async()=>{
 const row={id:'old-file',movie_candidates:{provider:'wikidata',provider_id:'Q123'},source_platform:'wikimedia_commons',source_url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/The_Kid.webm',video_id:null,use_mode:'fragment',source_type:'full_film',start_sec:0,end_sec:75,verified:true,embeddable:true,availability_status:'ready',rights_status:'allowed',confidence:.9,verified_at:new Date(Date.now()-3*86400000).toISOString(),metadata:{availabilityCheck:'video_bytes'}}
 const db={from:()=>{const q:any={};for(const method of ['select','eq','neq','in','gte','lte','order','limit'])q[method]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:[row]}).then(resolve);return q}}
 let checks=0
 const found=await loadReusableMovieSources(db,{provider:'wikidata',provider_id:'Q123'},{probe:async url=>{checks++;return {ok:true,url,bytesRead:8,mimeType:'video/webm'}}})
 check(checks===1&&found.length===1,'Old known file was not revalidated')
 check(Date.parse(String(found[0].metadata.cached_verified_at))>Date.parse(row.verified_at),'Stale verification was silently refreshed')
 const dead=await loadReusableMovieSources(db,{provider:'wikidata',provider_id:'Q123'},{probe:async url=>({ok:false,url,bytesRead:0,reason:'http_error'})})
 check(dead.length===0,'Dead old video was reused')
})
