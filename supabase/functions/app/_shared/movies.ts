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
  const languages=['en','ru','es','fr','de','it','pt','ja','ko','zh','pl','tr']
  const hitMap=new Map<string,any>()
  for(const language of languages){
    try{
      const qs=new URLSearchParams({action:'wbsearchentities',search:raw,language,format:'json',limit:'5',origin:'*'})
      const sr=await fetch(`https://www.wikidata.org/w/api.php?${qs}`,{headers:{'api-user-agent':'NasypateliCinema/1.0'}})
      if(!sr.ok)continue
      const sj=await sr.json()
      for(const hit of sj.search||[])if(hit?.id&&!hitMap.has(String(hit.id)))hitMap.set(String(hit.id),hit)
      if(hitMap.size>=10)break
    }catch{}
  }
  const hits=[...hitMap.values()].slice(0,12)
  const candidates:any[]=[]
  for(const hit of hits){
    if(!hit?.id)continue
    try{
      const er=await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`,{headers:{'api-user-agent':'NasypateliCinema/1.0'}})
      if(!er.ok)continue
      const ej=await er.json();const entity=ej.entities?.[hit.id]
      if(!entity)continue
      const descriptions=Object.values(entity.descriptions||{}) as any[]
      const description=String(entity.descriptions?.en?.value||entity.descriptions?.ru?.value||descriptions.find((x:any)=>x?.value)?.value||hit.description||'')
      if(!looksLikeFilm(entity,description))continue
      const runtime=claimNumber(entity,'P2047')
      if(!runtime||runtime<=0||runtime>600)continue
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
      if(titleScore<25)continue
      const yearScore=expectedYear&&year?Math.max(0,30-Math.abs(expectedYear-year)*8):10
      const preferredLabel=entity.labels?.en?.value||entity.labels?.ru?.value||(Object.values(entity.labels||{}) as any[]).find((x:any)=>x?.value)?.value||hit.label||raw
      const originalLabel=entity.labels?.mul?.value||entity.labels?.en?.value||preferredLabel
      candidates.push({
        score:titleScore+yearScore,title:String(preferredLabel),wikidataId:hit.id,description,runtimeMin:runtime,year,
        url:`https://www.wikidata.org/wiki/${hit.id}`,
        originalTitle:String(originalLabel),
        searchTitles:[...new Set([raw,...names])].slice(0,30)
      })
    }catch{}
  }
  candidates.sort((a,b)=>b.score-a.score)
  if(!candidates.length)return null
  const {score:_,...best}=candidates[0]
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

function sourceNormalize(value:string){
  return String(value||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9а-яё]+/gi,' ').trim()
}
function sourceTitleMatch(candidate:string,movie:any){
  const hay=sourceNormalize(candidate)
  const names=[movie?.title,movie?.original_title,movie?.originalTitle,...(Array.isArray(movie?.metadata?.search_titles)?movie.metadata.search_titles:[])].map((x:any)=>sourceNormalize(String(x||''))).filter(Boolean)
  if(!hay||!names.length)return 0
  if(names.some(n=>hay===n))return 1
  if(names.some(n=>hay.includes(n)||n.includes(hay)))return .85
  const tokens=new Set(hay.split(' ').filter(x=>x.length>2))
  let best=0
  for(const name of names){
    const wanted=name.split(' ').filter(x=>x.length>2)
    if(!wanted.length)continue
    const hit=wanted.filter(x=>tokens.has(x)).length/wanted.length
    best=Math.max(best,hit)
  }
  return best
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
      const match=sourceTitleMatch(title,movie)
      if(match<.42)return null
      if(mode==='fragment'&&/(trailer|teaser|трейлер|тизер)/i.test(title))return null
      const looksClip=/(official\s+clip|movie\s+clip|film\s+clip|scene|excerpt|fragment|фрагмент|сцена|extrait|escena|szene|scena)/i.test(title)
      const looksTeaser=/(teaser|тизер)/i.test(title)
      const looksTrailer=/(trailer|трейлер|bande-annonce|tráiler)/i.test(title)
      if(mode==='trailer'&&!looksTrailer&&!looksTeaser)return null
      const official=/\bofficial\b|официальн|officiel|oficial/i.test(title)
      const confidence=clamp01(.43+match*.36+(official?0.12:0)+((looksClip||looksTrailer||looksTeaser)?0.09:0))
      return {
        useMode:mode,
        sourceType:mode==='fragment'?'clip':looksTeaser?'teaser':'trailer',
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
        metadata:{discoveredBy:'youtube_public_search',query:idQuery.get(id)||''}
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
  const base=String(movie?.original_title||movie?.originalTitle||movie?.title||'').trim()
  const wanted=mode==='fragment'?base:`${base} trailer`
  if(!wanted)return []
  try{
    const q=`title:(${wanted.replace(/[()"]/g,' ')}) AND mediatype:movies`
    const qs=new URLSearchParams({q,output:'json',rows:'8',fl:'identifier,title,creator,year,licenseurl,description'})
    const r=await fetch('https://archive.org/advancedsearch.php?'+qs.toString(),{headers:{'user-agent':'NasypateliCinema/1.0'}})
    if(!r.ok)return []
    const j=await r.json()
    const docs=Array.isArray(j?.response?.docs)?j.response.docs:[]
    const rows:MovieSourceCandidate[]=[]
    for(const doc of docs){
      const identifier=String(doc?.identifier||'')
      if(!identifier)continue
      const title=String(doc?.title||identifier)
      const match=sourceTitleMatch(title,movie)
      if(match<.4)continue
      try{
        const mr=await fetch('https://archive.org/metadata/'+encodeURIComponent(identifier),{headers:{'user-agent':'NasypateliCinema/1.0'}})
        if(!mr.ok)continue
        const meta=await mr.json()
        const files=Array.isArray(meta?.files)?meta.files:[]
        const playable=files.filter((x:any)=>/\.(mp4|webm)$/i.test(String(x?.name||''))&&String(x?.source||'').toLowerCase()!=='metadata')
        const file=playable.find((x:any)=>/\.mp4$/i.test(String(x?.name||'')))||playable.find((x:any)=>/\.webm$/i.test(String(x?.name||'')))
        if(!file?.name)continue
        const sourceUrl='https://archive.org/download/'+encodeURIComponent(identifier)+'/'+String(file.name).split('/').map(encodeURIComponent).join('/')
        const license=String(doc?.licenseurl||meta?.metadata?.licenseurl||'')
        rows.push({
          useMode:mode,
          sourceType:mode==='fragment'?'full_film':/teaser/i.test(title)?'teaser':'trailer',
          sourcePlatform:'internet_archive',
          sourceUrl,
          title,
          sourceChannel:String(doc?.creator||meta?.metadata?.creator||'')||undefined,
          startSec:0,
          endSec:null,
          verified:true,
          embeddable:true,
          official:false,
          rightsStatus:license?'allowed':'unknown',
          confidence:clamp01(.35+match*.45+(license?0.1:0)),
          metadata:{identifier,licenseUrl:license||undefined,discoveredBy:'internet_archive',query:q}
        })
      }catch{}
    }
    return rows.sort((a,b)=>b.confidence-a.confidence).slice(0,5)
  }catch{return []}
}

async function searchWikimediaCommons(movie:any,mode:'fragment'|'trailer'):Promise<MovieSourceCandidate[]>{
  const query=sourceQuery(movie,mode)
  try{
    const qs=new URLSearchParams({
      action:'query',generator:'search',gsrsearch:query,gsrnamespace:'6',gsrlimit:'10',
      prop:'imageinfo',iiprop:'url|mime|extmetadata',format:'json',origin:'*'
    })
    const r=await fetch('https://commons.wikimedia.org/w/api.php?'+qs.toString(),{headers:{'api-user-agent':'NasypateliCinema/1.0'}})
    if(!r.ok)return []
    const j=await r.json()
    const pages=Object.values(j?.query?.pages||{}) as any[]
    const rows:MovieSourceCandidate[]=[]
    for(const page of pages){
      const info=page?.imageinfo?.[0]
      const mime=String(info?.mime||'')
      if(!['video/mp4','video/webm'].includes(mime))continue
      const title=String(page?.title||'').replace(/^File:/,'')
      const match=sourceTitleMatch(title,movie)
      if(match<.4)continue
      const low=title.toLowerCase()
      if(mode==='fragment'&&/(trailer|teaser|трейлер|тизер)/i.test(low))continue
      if(mode==='trailer'&&!/(trailer|teaser|трейлер|тизер)/i.test(low))continue
      const licenseName=String(info?.extmetadata?.LicenseShortName?.value||'')
      rows.push({
        useMode:mode,
        sourceType:mode==='fragment'?'clip':/teaser|тизер/i.test(low)?'teaser':'trailer',
        sourcePlatform:'wikimedia_commons',
        sourceUrl:String(info?.url||''),
        title,
        sourceChannel:'Wikimedia Commons',
        startSec:0,
        endSec:null,
        verified:!!info?.url,
        embeddable:true,
        official:false,
        rightsStatus:licenseName?'allowed':'unknown',
        confidence:clamp01(.35+match*.45+(licenseName?0.1:0)),
        metadata:{pageId:page?.pageid,license:licenseName||undefined,discoveredBy:'wikimedia_commons',query}
      })
    }
    return rows.sort((a,b)=>b.confidence-a.confidence).slice(0,5)
  }catch{return []}
}

async function discoverMode(movie:any,mode:'fragment'|'trailer'){
  const settled=await Promise.allSettled([
    searchYoutubePublic(movie,mode),
    searchInternetArchive(movie,mode),
    searchWikimediaCommons(movie,mode)
  ])
  return dedupeSources(settled.flatMap(x=>x.status==='fulfilled'?x.value:[]))
}

export async function discoverMovieSources(movie:any){
  const fragments=await discoverMode(movie,'fragment')
  const usableFragments=fragments.filter(x=>x.verified&&x.embeddable&&x.confidence>=.60)
  if(usableFragments.length)return {
    candidates:fragments,
    fallbackUsed:false,
    trace:{
      fragmentsSearched:true,
      fragmentCount:fragments.length,
      usableFragmentCount:usableFragments.length,
      trailersSearched:false,
      trailerCount:0
    }
  }
  const trailers=await discoverMode(movie,'trailer')
  return {
    candidates:dedupeSources([...fragments,...trailers]),
    fallbackUsed:true,
    trace:{
      fragmentsSearched:true,
      fragmentCount:fragments.length,
      usableFragmentCount:0,
      trailersSearched:true,
      trailerCount:trailers.length
    }
  }
}

export function preferredMovieSource(rows:MovieSourceCandidate[]){
  return [...rows]
    .filter(x=>x.verified&&x.embeddable&&x.rightsStatus!=='blocked')
    .sort((a,b)=>{
      const mode=(a.useMode==='fragment'?0:1)-(b.useMode==='fragment'?0:1)
      if(mode)return mode
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

