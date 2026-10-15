/** A found video is not a reviewed question package. No film-plot fallback. */
export function mediaKey(f:any):string {
  const platform=String(f?.sourcePlatform||'')
  if(platform==='youtube'&&/^[\w-]{11}$/.test(String(f.videoId||'')))return `youtube:${f.videoId}`
  if(platform==='rutube'){
    if(/^[a-f0-9]{32}$/i.test(String(f.videoId||'')))return `rutube:${String(f.videoId).toLowerCase()}`
    try{const u=new URL(f.sourceUrl);const id=u.pathname.match(/^\/(?:video|play\/embed)\/([a-f0-9]{32})(?:\/|$)/i)?.[1];if(u.protocol==='https:'&&u.hostname==='rutube.ru'&&id)return `rutube:${id.toLowerCase()}`}catch{}
    return ''
  }
  if(['direct','internet_archive','wikimedia_commons'].includes(platform)){
    try{const u=new URL(f.sourceUrl);if(u.protocol==='https:'&&!u.username&&!u.password)return `${platform}:${u.href}`}catch{}
  }
  return ''
}
export function validMedia(f:any):boolean {
  return !!mediaKey(f)&&typeof f.startSec==='number'&&typeof f.endSec==='number'&&Number.isFinite(f.startSec)&&Number.isFinite(f.endSec)&&f.startSec>=0&&f.endSec>f.startSec&&f.endSec-f.startSec<=600
}
function mediaContent(f:any):any {
  return {key:mediaKey(f),start:f?.startSec,end:f?.endSec,backups:(Array.isArray(f?.backups)?f.backups:[]).map((b:any)=>({key:mediaKey(b),start:b.startSec,end:b.endSec,sameCut:b.sameCut===true}))}
}
export function sceneProblems(pack:any,questions:any[]):string[]{
  const issues:string[]=[];const fs=Array.isArray(pack?.fragments)?pack.fragments:[]
  const qs=[...questions].sort((a,b)=>Number(a.position)-Number(b.position))
  if(qs.length<1||qs.length>5)issues.push('нужно от 1 до 5 вопросов')
  if(fs.length!==qs.length+1)issues.push('нужны вводный фрагмент и отдельное продолжение каждого вопроса')
  for(let i=0;i<fs.length;i++){
    const f=fs[i]
    if(!validMedia(f))issues.push(`фрагмент ${i+1}: неверный источник или таймкоды`)
    if(i&&(mediaKey(f)!==mediaKey(fs[0])||Math.abs(Number(f.startSec)-Number(fs[i-1].endSec))>.25))issues.push(`фрагмент ${i+1}: другая версия или разрыв продолжения`)
    const backups=Array.isArray(f?.backups)?f.backups:[]
    if(backups.length>2)issues.push('не больше двух резервов')
    for(const b of backups)if(!validMedia(b)||!b.sameCut||mediaKey(b)===mediaKey(f)||b.startSec!==f.startSec||b.endSec!==f.endSec)issues.push(`фрагмент ${i+1}: резерв должен быть проверенной копией того же монтажа`)
  }
  for(let i=0;i<qs.length;i++){
    const q=qs[i],answer=q.correct_answer??q.correctAnswer,reveal=q.reveal_fragment??q.revealFragment,options=q.options
    if(Number(q.position)!==i+1||!String(q.prompt||'').trim()||typeof answer!=='string'||!answer.trim()||!String(q.reveal_text??q.revealText??'').trim())issues.push(`вопрос ${i+1}: неполный ответ или объяснение`)
    if(!Array.isArray(options)||options.length>8||(options.length>0&&(options.length<2||!options.includes(answer)||new Set(options).size!==options.length)))issues.push(`вопрос ${i+1}: правильного ответа нет в вариантах`)
    if(!validMedia(reveal)||JSON.stringify(mediaContent(reveal))!==JSON.stringify(mediaContent(fs[i+1])))issues.push(`вопрос ${i+1}: продолжение не совпадает с фрагментом`)
  }
  return [...new Set(issues)]
}
export async function sceneDigest(pack:any,questions:any[]):Promise<string>{
  const data={fragments:(pack.fragments||[]).map(mediaContent),questions:[...questions].sort((a,b)=>a.position-b.position).map(q=>({position:q.position,prompt:q.prompt,options:q.options,answer:q.correct_answer??q.correctAnswer,revealText:q.reveal_text??q.revealText,reveal:mediaContent(q.reveal_fragment??q.revealFragment)}))}
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)))
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')
}
export async function reviewedScene(pack:any,questions:any[],required=1):Promise<boolean>{
  const review=pack?.match_data?.sceneReview
  return pack?.status==='ready'&&questions.length>=required&&sceneProblems(pack,questions).length===0&&review?.version===1&&!!review.reviewedAt&&!!review.reviewedBy&&review.digest===await sceneDigest(pack,questions)
}
