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
  for(const lang of ['en','ru']){const label=entity?.labels?.[lang]?.value;if(label)vals.push(label);for(const a of entity?.aliases?.[lang]||[])if(a?.value)vals.push(a.value)}
  return vals
}
function looksLikeFilm(entity:any,description=''){
  const ids=(entity?.claims?.P31||[]).map((x:any)=>x?.mainsnak?.datavalue?.value?.id).filter(Boolean)
  const direct=new Set(['Q11424','Q202866','Q506240'])
  return ids.some((x:string)=>direct.has(x))||/film|movie|animated film|motion picture|телефильм|фильм|мультфильм/i.test(description)
}

export async function validateMovieTitle(title:string,expectedYear?:number):Promise<ValidatedMovie|null>{
  const qs=new URLSearchParams({action:'wbsearchentities',search:title,language:'en',format:'json',limit:'8',origin:'*'})
  const sr=await fetch(`https://www.wikidata.org/w/api.php?${qs}`)
  if(!sr.ok)return null
  const sj=await sr.json()
  const hits=(sj.search||[]).slice(0,8)
  const candidates:any[]=[]
  for(const hit of hits){
    if(!hit?.id)continue
    const er=await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`)
    if(!er.ok)continue
    const ej=await er.json();const entity=ej.entities?.[hit.id]
    if(!entity)continue
    const description=entity.descriptions?.en?.value||entity.descriptions?.ru?.value||hit.description||''
    if(!looksLikeFilm(entity,description))continue
    const runtime=claimNumber(entity,'P2047')
    if(!runtime||runtime<=0||runtime>600)continue
    const year=claimYear(entity)
    const names=labelSet(entity)
    const target=normalize(title)
    let titleScore=0
    for(const n of names){const nn=normalize(n);if(nn===target)titleScore=Math.max(titleScore,100);else if(nn.includes(target)||target.includes(nn))titleScore=Math.max(titleScore,75)}
    if(!titleScore)titleScore=40
    const yearScore=expectedYear&&year?Math.max(0,30-Math.abs(expectedYear-year)*10):10
    candidates.push({score:titleScore+yearScore,title:entity.labels?.en?.value||entity.labels?.ru?.value||hit.label||title,wikidataId:hit.id,description,runtimeMin:runtime,year,url:`https://www.wikidata.org/wiki/${hit.id}`})
  }
  candidates.sort((a,b)=>b.score-a.score)
  if(!candidates.length)return null
  const {score:_,...best}=candidates[0]
  return best as ValidatedMovie
}
