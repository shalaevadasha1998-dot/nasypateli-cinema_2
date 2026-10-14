import { sourceTitleMatch, probeDirectVideo, isCountryAvailable } from './videoValidation.ts'
export type ValidatedMovie={title:string;wikidataId:string;description?:string;runtimeMin:number;year?:number;url:string}

function claimNumber(entity:any,prop:string){
  const c=entity?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value
  if(c&&typeof c.amount==='string') return Number(c.amount)
  return undefined
}
function claimYear(entity:any){
  const t=entity?.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time
  const m=typeof t==='string'&&t.match(/[+-](\d{4})-/)
  return m?Number(m[1]):undefined
}
function normalize(s:string){return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9а-яё]+/gi,' ').trim()}
function labelSet(entity:any){
  const vals:string[]=[]
  for(const label of Object.values(entity?.labels||{}) as any[]){if(label?.value)vals.push(String(label.value))}
  for(const aliases of Object.values(entity?.aliases||{}) as any[][]){for(const a of aliases||[])if(a?.value)vals.push(String(a.value))}
  return [...new Set(vals)]
}
function looksLikeFilm(entity:any,description=''){
  const ids=(entity?.claims?.P31||[]).map((x:any)=>x?.mainsnak?.datavalue?.value?.id).filter(Boolean)
  const direct=new Set(['Q11424','Q202866','Q506240'])
  return ids.some((x:string)=>direct.has(x))||/film|movie|animated film|motion picture|телефильм|фильм|мультфильм/i.test(description)
}

export async function validateMovieTitle(title:string,expectedYear?:number):Promise<ValidatedMovie|null>{
  const raw=String(title||'').trim()
  if(!raw)return null

  const getJson=async(url:string,ms=2600)=>{
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),ms)
    try{
      const r=await fetch(url,{headers:{'api-user-agent':'NasypateliCinema/1.0'},signal:controller.signal})
      if(!r.ok)return null
      return await r.json()
    }catch{return null}
    finally{clearTimeout(timeout)}
  }

  // Live-проверка должна занимать секунды, а не обходить языки и карточки
  // последовательно. Параллельно ищем одно и то же название в основных
  // индексах Wikidata, затем параллельно проверяем сами сущности.
  const languages=['en','ru','es','fr','de','it','pt','ja']
  const searchResults=await Promise.allSettled(languages.map(async language=>{
    const qs=new URLSearchParams({action:'wbsearchentities',search:raw,language,format:'json',limit:'4',origin:'*'})
    return await getJson('https://www.wikidata.org/w/api.php?'+qs.toString(),2200)
  }))
  const hitMap=new Map<string,any>()
  for(const result of searchResults){
    if(result.status!=='fulfilled')continue
    for(const hit of result.value?.search||[]){
      if(hit?.id&&!hitMap.has(String(hit.id)))hitMap.set(String(hit.id),hit)
      if(hitMap.size>=10)break
    }
    if(hitMap.size>=10)break
  }

  const hits=[...hitMap.values()].slice(0,10)
  if(!hits.length)return null
  const entityResults=await Promise.allSettled(hits.map(async hit=>{
    if(!hit?.id)return null
    const ej=await getJson('https://www.wikidata.org/wiki/Special:EntityData/'+encodeURIComponent(String(hit.id))+'.json',2400)
    const entity=ej?.entities?.[hit.id]
    if(!entity)return null
    const descriptions=Object.values(entity.descriptions||{}) as any[]
    const description=String(entity.descriptions?.en?.value||entity.descriptions?.ru?.value||descriptions.find((x:any)=>x?.value)?.value||hit.description||'')
    if(!looksLikeFilm(entity,description))return null
    const runtime=claimNumber(entity,'P2047')
    if(!runtime||runtime<=0||runtime>600)return null
    const year=claimYear(entity)
    const names=labelSet(entity)
    const target=normalize(raw)
    let titleScore=0
    for(const n of names){
      const nn=normalize(n)
      if(!nn)continue
      if(nn===target)titleScore=Math.max(titleScore,100)
      else if(nn.includes(target)||target.includes(nn))titleScore=Math.max(titleScore,78)
      else{
        const wanted=new Set(target.split(' ').filter(x=>x.length>1))
        const have=new Set(nn.split(' ').filter(x=>x.length>1))
        const overlap=[...wanted].filter(x=>have.has(x)).length/Math.max(1,wanted.size)
        titleScore=Math.max(titleScore,Math.round(overlap*65))
      }
    }
    if(titleScore<25)return null
    const yearScore=expectedYear&&year?Math.max(0,30-Math.abs(expectedYear-year)*8):10
    const preferredLabel=entity.labels?.en?.value||entity.labels?.ru?.value||(Object.values(entity.labels||{}) as any[]).find((x:any)=>x?.value)?.value||hit.label||raw
    const originalLabel=entity.labels?.mul?.value||entity.labels?.en?.value||preferredLabel
    return {
      score:titleScore+yearScore,title:String(preferredLabel),wikidataId:String(hit.id),description,runtimeMin:Number(runtime),year,
      url:'https://www.wikidata.org/wiki/'+String(hit.id),
      originalTitle:String(originalLabel),
      searchTitles:[...new Set([raw,...names])].slice(0,30)
    }
  }))

  const candidates=entityResults
    .flatMap(x=>x.status==='fulfilled'&&x.value?[x.value]:[])
    .sort((a:any,b:any)=>Number(b.score||0)-Number(a.score||0))
  if(!candidates.length)return null
  const {score:_,...best}=candidates[0] as any
  return best as ValidatedMovie
}

export type MovieSourceCandidate={
  useMode:'fragment'|'trailer'
  sourceType:'clip'|'full_film'|'trailer'|'teaser'|'unknown'
  sourcePlatform:string
  sourceUrl:string
  videoId?:string
  title?:string
  sourceChannel?:string
  startSec:number
  endSec?:number|null
  verified:boolean
  embeddable:boolean
  official:boolean
  rightsStatus:'unknown'|'allowed'|'restricted'|'blocked'
  confidence:number
  metadata:Record<string,unknown>
}

function clamp01(n:number){return Math.max(0,Math.min(1,n))}
function dedupeSources(rows:MovieSourceCandidate[]){
  const seen=new Set<string>()
  return rows.filter(row=>{
    const key=[row.sourcePlatform,row.videoId||'',row.sourceUrl,row.startSec,row.endSec??''].join('|')
    if(seen.has(key))return false
    seen.add(key);return true
  })
}
function sourceQuery(movie:any,mode:'fragment'|'trailer'){
  const name=String(movie?.original_title||movie?.originalTitle||movie?.title||'').trim()
  const year=movie?.year?String(movie.year):''
  return mode==='fragment'
    ? `${name} ${year} official clip scene excerpt`.trim()
    : `${name} ${year} official trailer teaser`.trim()
}

const SOURCE_HEADERS={'user-agent':'Mozilla/5.0 (compatible; NasypateliCinema/1.0)'}
async function sourceJson(url:string,timeoutMs=3500){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try{const r=await fetch(url,{headers:SOURCE_HEADERS,signal:controller.signal});if(!r.ok)return null;return await r.json()}
  catch{return null}finally{clearTimeout(timer)}
}
function allowedLicense(value:string){return /creativecommons\.org\/(?:licenses|publicdomain)\//i.test(value)||/^(?:public domain|cc0|cc by(?:[- ]sa)?)/i.test(value)}

async function searchYoutubePublic(movie:any,mode:'fragment'|'trailer'):Promise<MovieSourceCandidate[]>{
  const base=String(movie?.original_title||movie?.originalTitle||movie?.title||'').trim()
  const year=movie?.year?String(movie.year):''
  const altTitles=Array.isArray(movie?.metadata?.search_titles)?movie.metadata.search_titles.map((x:any)=>String(x).trim()).filter(Boolean).slice(0,2):[]
  const names=[base,...altTitles].filter(Boolean)
  const querySet=new Set<string>()
  for(const name of names){
    if(mode==='fragment'){
      querySet.add(`${name} ${year} official clip`.trim())
      querySet.add(`${name} ${year} scene`.trim())
    }else{
      querySet.add(`${name} ${year} official trailer`.trim())
      querySet.add(`${name} ${year} trailer`.trim())
    }
  }
  const queries=[...querySet].slice(0,4)
  const searchPages=await Promise.allSettled(queries.map(async query=>{
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),3500)
    try{
      const r=await fetch('https://www.youtube.com/results?search_query='+encodeURIComponent(query),{
        headers:{'user-agent':'Mozilla/5.0 (compatible; NasypateliCinema/1.0)'},
        signal:controller.signal
      })
      if(!r.ok)return {query,ids:[] as string[]}
      const html=await r.text()
      const ids:string[]=[]
      for(const m of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)){
        if(!ids.includes(m[1]))ids.push(m[1])
        if(ids.length>=5)break
      }
      return {query,ids}
    }catch{return {query,ids:[] as string[]}}
    finally{clearTimeout(timeout)}
  }))
  const idQuery=new Map<string,string>()
  for(const page of searchPages){
    if(page.status!=='fulfilled')continue
    for(const id of page.value.ids)if(!idQuery.has(id))idQuery.set(id,page.value.query)
  }
  const ids=[...idQuery.keys()].slice(0,12)
  const metaRows=await Promise.allSettled(ids.map(async id=>{
    const controller=new AbortController()
    const timeout=setTimeout(()=>controller.abort(),2500)
    try{
      const o=await fetch('https://www.youtube.com/oembed?url='+encodeURIComponent('https://www.youtube.com/watch?v='+id)+'&format=json',{signal:controller.signal})
      if(!o.ok)return null
      const meta=await o.json()
      const title=String(meta?.title||'')
      const match=sourceTitleMatch(title,movie,{useMode:mode,description:String(meta?.description||'')})
      if(match<.42)return null
      if(/(?:#|\b)(?:shorts?|ytshorts|vertical|reels)(?:\b|$)|вертикальн|короткое видео|9\s*[:хx×]\s*16/i.test(title))return null
      if(mode==='fragment'&&/(trailer|teaser|трейлер|тизер)/i.test(title))return null
      const looksClip=/(official\s+clip|movie\s+clip|film\s+clip|scene|excerpt|fragment|фрагмент|сцена|extrait|escena|szene|scena)/i.test(title)
      const looksTeaser=/(teaser|тизер)/i.test(title)
      const looksTrailer=/(trailer|трейлер|bande-annonce|tráiler)/i.test(title)
      if(mode==='trailer'&&!looksTrailer&&!looksTeaser)return null
      const official=/\bofficial\b|официальн|officiel|oficial/i.test(title)
      const confidence=clamp01(.43+match*.36+(official?0.12:0)+((looksClip||looksTrailer||looksTeaser)?0.09:0))
      return {
        useMode:mode,
        sourceType:mode==='fragment'?(/full (?:movie|film)|полный фильм/i.test(title)?'full_film':looksClip?'clip':'unknown'):looksTeaser?'teaser':'trailer',
        sourcePlatform:'youtube',
        sourceUrl:'https://www.youtube.com/watch?v='+id,
        videoId:id,
        title,
        sourceChannel:String(meta?.author_name||'')||undefined,
        startSec:0,
        endSec:mode==='fragment'?60:75,
        verified:true,
        embeddable:true,
        official,
        rightsStatus:'unknown',
        confidence,
        metadata:{discoveredBy:'youtube_public_search',query:idQuery.get(id)||'',availabilityCheck:'embed_metadata',countryCheck:'unknown'}
      } as MovieSourceCandidate
    }catch{return null}
    finally{clearTimeout(timeout)}
  }))
  return metaRows
    .flatMap(x=>x.status==='fulfilled'&&x.value?[x.value]:[])
    .sort((a,b)=>b.confidence-a.confidence)
    .slice(0,8)
}
async function searchInternetArchive(movie:any,mode:'fragment'|'trailer'):Promise<MovieSourceCandidate[]>{
  const names=[movie?.original_title||movie?.originalTitle||movie?.title,...(movie?.metadata?.search_titles||[])].filter(Boolean).slice(0,2)
  if(!names.length)return []
  const titles=names.map(name=>`title:("${String(name).replace(/["()]/g,' ')}")`).join(' OR ')
  const year=Number(movie?.year);const yearFilter=Number.isInteger(year)&&year>=1888?' AND year:'+year:''
  const q=`(${titles}) AND mediatype:movies${yearFilter}${mode==='trailer'?' AND (title:trailer OR title:teaser)':''}`
  const qs=new URLSearchParams({q,output:'json',rows:'8',fl:'identifier,title,creator,year,licenseurl,description'})
  const j=await sourceJson('https://archive.org/advancedsearch.php?'+qs)
  const docs=(Array.isArray(j?.response?.docs)?j.response.docs:[]).filter((doc:any)=>sourceTitleMatch(String(doc.title||''),movie,{useMode:mode,description:String(doc.year||'')+' '+String(doc.description||'')})>=.6).slice(0,4)
  const rows=await Promise.all(docs.map(async(doc:any):Promise<MovieSourceCandidate|null>=>{
    const identifier=String(doc.identifier||'');if(!identifier)return null
    const meta=await sourceJson('https://archive.org/metadata/'+encodeURIComponent(identifier))
    if(!meta||meta.is_dark||meta.metadata?.access==='restricted')return null
    const title=String(doc.title||meta.metadata?.title||'')
    const match=sourceTitleMatch(title,movie,{useMode:mode,description:String(doc.year||meta.metadata?.year||'')+' '+String(doc.description||'')})
    const files=(Array.isArray(meta.files)?meta.files:[]).filter((f:any)=>/\.(?:mp4|webm)$/i.test(String(f.name||''))&&!f.private&&Number(f.size||0)>1024)
      .sort((a:any,b:any)=>(/\.mp4$/i.test(a.name)?0:1)-(/\.mp4$/i.test(b.name)?0:1))
    for(const file of files.slice(0,2)){
      const url='https://archive.org/download/'+encodeURIComponent(identifier)+'/'+String(file.name).split('/').map(encodeURIComponent).join('/')
      const probe=await probeDirectVideo(url,{timeoutMs:2500});if(!probe.ok)continue
      const license=String(doc.licenseurl||meta.metadata?.licenseurl||'')
      return {useMode:mode,sourceType:mode==='fragment'?'full_film':'trailer',sourcePlatform:'internet_archive',sourceUrl:url,title,sourceChannel:String(doc.creator||meta.metadata?.creator||'')||undefined,startSec:0,endSec:75,verified:true,embeddable:true,official:false,rightsStatus:allowedLicense(license)?'allowed':'unknown',confidence:clamp01(.42+match*.48+(allowedLicense(license)?.1:0)),metadata:{identifier,licenseUrl:license,discoveredBy:'internet_archive',availabilityCheck:'video_bytes',checkedAt:new Date().toISOString(),query:q}}
    }
    return null
  }))
  return rows.filter((x):x is MovieSourceCandidate=>!!x)
}

async function searchWikimediaCommons(movie:any,mode:'fragment'|'trailer'):Promise<MovieSourceCandidate[]>{
  const name=String(movie?.original_title||movie?.originalTitle||movie?.title||'').replace(/"/g,' ')
  if(!name)return []
  const query=`filetype:video "${name}"${mode==='trailer'?' trailer':''}`
  const qs=new URLSearchParams({action:'query',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'8',prop:'videoinfo',viprop:'url|mime|size|derivatives|extmetadata',format:'json'})
  const j=await sourceJson('https://commons.wikimedia.org/w/api.php?'+qs)
  const pages=(Object.values(j?.query?.pages||{}) as any[]).filter(page=>{
    const info=page.videoinfo?.[0]||page.imageinfo?.[0]
    return info&&sourceTitleMatch(String(page.title||'').replace(/^File:/,''),movie,{useMode:mode,description:String(info.extmetadata?.DateTimeOriginal?.value||'')+' '+String(info.extmetadata?.ImageDescription?.value||'')})>=.6
  }).slice(0,4)
  const rows=await Promise.all(pages.map(async(page:any):Promise<MovieSourceCandidate|null>=>{
    const info=page.videoinfo?.[0]||page.imageinfo?.[0];if(info.extmetadata?.DeletionRequest)return null
    const title=String(page.title).replace(/^File:/,'');const description=String(info.extmetadata?.DateTimeOriginal?.value||'')+' '+String(info.extmetadata?.ImageDescription?.value||'')
    const match=sourceTitleMatch(title,movie,{useMode:mode,description})
    const files=[...(Array.isArray(info.derivatives)?info.derivatives:[]),{src:info.url,type:info.mime}].filter(f=>/^video\/(?:mp4|webm)/.test(String(f.type||'')))
      .sort((a:any,b:any)=>(a.type==='video/mp4'?0:1)-(b.type==='video/mp4'?0:1)||Number(b.height||0)-Number(a.height||0))
    for(const file of files.slice(0,2)){
      const probe=await probeDirectVideo(String(file.src||file.url||''),{timeoutMs:2500});if(!probe.ok)continue
      const license=String(info.extmetadata?.LicenseShortName?.value||'')
      return {useMode:mode,sourceType:mode==='fragment'?'full_film':'trailer',sourcePlatform:'wikimedia_commons',sourceUrl:String(file.src||file.url),title,sourceChannel:'Wikimedia Commons',startSec:0,endSec:75,verified:true,embeddable:true,official:false,rightsStatus:allowedLicense(license)?'allowed':'unknown',confidence:clamp01(.42+match*.48+(allowedLicense(license)?.1:0)),metadata:{pageId:page.pageid,license,discoveredBy:'wikimedia_commons',availabilityCheck:'video_bytes',checkedAt:new Date().toISOString(),query}}
    }
    return null
  }))
  return rows.filter((x):x is MovieSourceCandidate=>!!x)
}

async function searchRutube(movie:any,mode:'fragment'|'trailer'):Promise<MovieSourceCandidate[]>{
  const name=String(movie?.title||movie?.original_title||movie?.originalTitle||'')
  const query=`${name} ${movie?.year||''} ${mode==='fragment'?'фрагмент сцена':'трейлер'}`.trim()
  const j=await sourceJson('https://rutube.ru/api/search/video/?'+new URLSearchParams({query,page:'1'}))
  const results=(Array.isArray(j?.results)?j.results:[]).filter((x:any)=>!x.is_locked&&/^[a-f0-9]{32}$/i.test(String(x.id||''))).slice(0,5)
  const rows=await Promise.all(results.map(async(row:any):Promise<MovieSourceCandidate|null>=>{
    const meta=await sourceJson('https://rutube.ru/api/video/'+row.id+'/')
    if(!meta||meta.is_hidden||meta.is_deleted||meta.is_paid||meta.is_adult||meta.is_club||meta.is_livestream||Number(meta.action_reason?.id||0)!==0)return null
    const country=meta.restrictions?.country||{}
    if(!isCountryAvailable({allowed:country.allowed,blocked:country.restricted},'RU'))return null
    const description=String(meta.description||'');const match=sourceTitleMatch(String(meta.title||''),movie,{useMode:mode,description})
    if(match<.6||Number(meta.duration||0)<15)return null
    if(mode==='fragment'&&!/(фрагмент|сцена|scene|clip|excerpt|full movie|полный фильм)/i.test(String(meta.title)+' '+description))return null
    return {useMode:mode,sourceType:mode==='fragment'?(/full (?:movie|film)|полный фильм/i.test(String(meta.title)+' '+description)?'full_film':'clip'):'trailer',sourcePlatform:'rutube',sourceUrl:'https://rutube.ru/video/'+row.id+'/',videoId:row.id,title:String(meta.title),sourceChannel:meta.author?.name,startSec:0,endSec:Math.min(75,Number(meta.duration)),verified:true,embeddable:true,official:false,rightsStatus:'unknown',confidence:clamp01(.43+match*.48),metadata:{discoveredBy:'rutube_public_search',availabilityCheck:'public_metadata',countryCheck:country.allowed?.length?'allowed_RU':'not_restricted_RU',hdAvailable:meta.has_high_quality===true,query}}
  }))
  return rows.filter((x):x is MovieSourceCandidate=>!!x)
}

const PROVIDERS=['youtube','internet_archive','wikimedia_commons','rutube'] as const
async function discoverMode(movie:any,mode:'fragment'|'trailer',budgetMs=7000){
  const jobs=[searchYoutubePublic(movie,mode),searchInternetArchive(movie,mode),searchWikimediaCommons(movie,mode),searchRutube(movie,mode)]
  const rows=await Promise.all(jobs.map(p=>new Promise<MovieSourceCandidate[]>(resolve=>{
    const timer=setTimeout(()=>resolve([]),budgetMs)
    p.then(value=>{clearTimeout(timer);resolve(value)},()=>{clearTimeout(timer);resolve([])})
  })))
  return {candidates:dedupeSources(rows.flat()),providers:Object.fromEntries(PROVIDERS.map((name,i)=>[name,rows[i].length]))}
}
async function discoverSources(movie:any,budgetMs:number){
  const fragments=await discoverMode(movie,'fragment',budgetMs)
  const usable=fragments.candidates.filter(x=>x.verified&&x.embeddable&&x.confidence>=.60)
  if(usable.length)return {candidates:fragments.candidates,fallbackUsed:false,trace:{mode:'multi_source',providers:fragments.providers,fragmentsSearched:true,fragmentCount:fragments.candidates.length,usableFragmentCount:usable.length,trailersSearched:false,trailerCount:0}}
  const trailers=await discoverMode(movie,'trailer',Math.min(budgetMs,4500))
  return {candidates:dedupeSources([...fragments.candidates,...trailers.candidates]),fallbackUsed:true,trace:{mode:'multi_source',providers:Object.fromEntries(PROVIDERS.map(name=>[name,(fragments.providers[name]||0)+(trailers.providers[name]||0)])),fragmentsSearched:true,fragmentCount:fragments.candidates.length,usableFragmentCount:0,trailersSearched:true,trailerCount:trailers.candidates.length}}
}
export async function discoverMovieSourcesFast(movie:any){return await discoverSources(movie,7000)}
export async function discoverMovieSources(movie:any){return await discoverSources(movie,9000)}

export function preferredMovieSource(rows:MovieSourceCandidate[]){
  return [...rows]
    .filter(x=>x.verified&&x.embeddable&&x.rightsStatus!=='blocked')
    .sort((a,b)=>{
      const mode=(a.useMode==='fragment'?0:1)-(b.useMode==='fragment'?0:1)
      if(mode)return mode
      const checked=(a.metadata?.availabilityCheck==='video_bytes'?0:1)-(b.metadata?.availabilityCheck==='video_bytes'?0:1)
      if(checked)return checked
      const type=(a.sourceType==='clip'?0:a.sourceType==='full_film'?1:a.sourceType==='trailer'?2:a.sourceType==='teaser'?3:4)
        -(b.sourceType==='clip'?0:b.sourceType==='full_film'?1:b.sourceType==='trailer'?2:b.sourceType==='teaser'?3:4)
      if(type)return type
      const rights=(a.rightsStatus==='allowed'?0:a.rightsStatus==='unknown'?1:a.rightsStatus==='restricted'?2:3)
        -(b.rightsStatus==='allowed'?0:b.rightsStatus==='unknown'?1:b.rightsStatus==='restricted'?2:3)
      if(rights)return rights
      if(a.official!==b.official)return a.official?-1:1
      return b.confidence-a.confidence
    })[0]||null
}

