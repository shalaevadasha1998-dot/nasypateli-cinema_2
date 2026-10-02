import { adminDb } from '../_shared/db.ts'
import { cors, err, json } from '../_shared/http.ts'
import { telegramUserFromRequest, isConfiguredAdmin } from '../_shared/telegram.ts'
import { secureIndex } from '../_shared/random.ts'
import { structuredResponse, transcribeAudio } from '../_shared/openai.ts'
import { creatureState, emitStoryTrigger, ensureCreature } from '../_shared/stories.ts'
import { allowedGender, connectionKind, datingState, intentsCompatible } from '../_shared/dating.ts'
import { JIPITINA, jipitinaInstructions } from '../_shared/jipitina.ts'
import { discoverMovieSources, validateMovieTitle } from '../_shared/movies.ts'
import { buildEventState, buildShowState, eventBySlug, nextEvent, nonexistentFilmEnabled } from '../_shared/state.ts'

const manualTransitions:Record<string,string>={
  DRAFT:'SALES_OPEN',SALES_OPEN:'CHECKIN',CHECKIN:'IDEAS_OPEN',IDEAS_OPEN:'IDEAS_LOCKED',
  PREDICTIONS_OPEN:'PREDICTIONS_LOCKED',PREDICTIONS_LOCKED:'WATCHING',PREDICTIONS_SCORED:'DISCUSSION',
  DISCUSSION:'FINAL_REVIEW',FINAL_REVIEW:'FEEDBACK',FEEDBACK:'CLOSED'
}
const checkinOpenStatuses=new Set([
  'CHECKIN','IDEAS_OPEN','IDEAS_LOCKED','TOP3_READY','IDEA_RANDOMIZED','MOVIE_SEARCH','MOVIE_FINALISTS',
  'MOVIE_SELECTED','PREDICTIONS_OPEN','PREDICTIONS_LOCKED','WATCHING','PREDICTIONS_SCORED','DISCUSSION','FINAL_REVIEW','FEEDBACK'
])

const defaultTaste={weirdness:50,heaviness:50,atmosphere:50,oldness:50,experimental:50,slowness:50,surrealism:50}
const allowedChatModes=new Set(['general','idea_coach','post_film','taste'])

function splitList(x:any){
  if(Array.isArray(x))return x.map(v=>String(v).trim()).filter(Boolean).slice(0,30)
  return String(x||'').split(',').map((s:string)=>s.trim()).filter(Boolean).slice(0,30)
}
function clamp100(x:any){const n=Number(x);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):50}

async function resolvedMovieSource(db:any,movieId:string){
  const resolved=await db.rpc('resolve_movie_source',{p_movie_candidate_id:movieId})
  if(resolved.error)throw resolved.error
  const raw=resolved.data?.[0]
  if(!raw)return null
  return {
    id:String(raw.id),useMode:raw.use_mode,sourceType:raw.source_type,sourcePlatform:raw.source_platform,sourceUrl:raw.source_url,
    videoId:raw.video_id||undefined,title:raw.title||undefined,sourceChannel:raw.source_channel||undefined,
    startSec:Number(raw.start_sec||0),endSec:raw.end_sec==null?null:Number(raw.end_sec),
    verified:raw.verified===true,embeddable:raw.embeddable===true,official:raw.official===true,
    rightsStatus:raw.rights_status,confidence:Number(raw.confidence||0),metadata:raw.metadata||{}
  }
}

async function applyMovieSourceToCandidate(db:any,event:any,movieId:string,preferred:any|null){
  const now=new Date().toISOString()
  const patch:any=preferred?{
    source_type:preferred.sourceType,
    source_platform:preferred.sourcePlatform,
    source_url:preferred.sourceUrl,
    video_id:preferred.videoId||null,
    start_sec:Math.max(0,Math.round(Number(preferred.startSec)||0)),
    end_sec:preferred.endSec==null?null:Math.max(0,Math.round(Number(preferred.endSec)||0)),
    source_channel:preferred.sourceChannel||null,
    source_verified:true,
    verified_at:now,
    usage_status:'ready'
  }:{
    source_type:null,source_platform:null,source_url:null,video_id:null,start_sec:0,end_sec:null,source_channel:null,
    source_verified:false,verified_at:null,usage_status:'no_video',clip_status:'missing',trailer_status:'missing'
  }
  if(preferred?.useMode==='fragment')patch.clip_status='ready'
  if(preferred?.useMode==='trailer')patch.trailer_status='ready'
  const updated=await db.from('movie_candidates').update(patch).eq('id',movieId).eq('event_id',event.id).select('id').maybeSingle()
  if(updated.error)throw updated.error
  if(!updated.data)throw new Error('movie candidate not found while applying source')
  return preferred
}

async function discoverAndPersistMovieSources(db:any,event:any,movie:any){
  const discovery=await discoverMovieSources(movie)
  const existing=await db.from('movie_source_candidates').select('*').eq('event_id',event.id).eq('movie_candidate_id',movie.id)
  if(existing.error)throw existing.error
  const byKey=new Map((existing.data||[]).map((x:any)=>[
    [String(x.source_url||''),Number(x.start_sec||0),x.end_sec==null?'':Number(x.end_sec)].join('|'),x
  ]))
  const now=new Date().toISOString()
  for(const x of discovery.candidates||[]){
    const sourceUrl=String(x.sourceUrl||'').slice(0,1500)
    if(!sourceUrl)continue
    const startSec=Math.max(0,Math.round(Number(x.startSec)||0))
    const endSec=x.endSec==null?null:Math.max(0,Math.round(Number(x.endSec)||0))
    const key=[sourceUrl,startSec,endSec==null?'':endSec].join('|')
    const old:any=byKey.get(key)
    const metadata={
      ...(old?.metadata&&typeof old.metadata==='object'?old.metadata:{}),
      ...(x.metadata&&typeof x.metadata==='object'?x.metadata:{}),
      ...(old?.metadata?.manual_selected===true||old?.metadata?.manual_selected==='true'?{manual_selected:true}:{})
    }
    const row={
      event_id:event.id,
      movie_candidate_id:movie.id,
      use_mode:x.useMode,
      source_type:x.sourceType,
      source_platform:String(x.sourcePlatform||'unknown').slice(0,80),
      source_url:sourceUrl,
      video_id:x.videoId?String(x.videoId).slice(0,200):null,
      title:x.title?String(x.title).slice(0,300):null,
      source_channel:x.sourceChannel?String(x.sourceChannel).slice(0,300):null,
      start_sec:startSec,
      end_sec:endSec,
      verified:x.verified===true,
      embeddable:x.embeddable===true,
      official:x.official===true,
      rights_status:['unknown','allowed','restricted','blocked'].includes(String(x.rightsStatus))?String(x.rightsStatus):'unknown',
      availability_status:x.verified===true&&x.embeddable===true&&Number(x.confidence)>=.60?'ready':'candidate',
      confidence:Math.max(0,Math.min(1,Number(x.confidence)||0)),
      metadata,
      verified_at:x.verified===true?now:null,
      updated_at:now
    }
    if(old?.id){
      if(['dead','blocked'].includes(String(old.availability_status)))row.availability_status=old.availability_status
      const u=await db.from('movie_source_candidates').update(row).eq('id',old.id).eq('event_id',event.id)
      if(u.error)throw u.error
    }else{
      const ins=await db.from('movie_source_candidates').insert(row)
      if(ins.error)throw ins.error
    }
  }
  const preferred=await resolvedMovieSource(db,movie.id)
  await applyMovieSourceToCandidate(db,event,movie.id,preferred)
  return {discovery,preferred}
}

function normalizeProfile(user:any,row:any,registration:any,tg:any){
  const j=row?.profile_json||{}
  const t=j.taste||{}
  return {
    completed:j.completed===true,completedAt:j.completed_at||undefined,onboardingStep:Number(j.onboarding_step||0),
    displayName:user?.display_name||'',ageRange:String(j.age_range||''),city:String(j.city||''),about:String(j.about||''),telegramPhotoUrl:String(j.telegram_photo_url||tg?.photo_url||''),
    favoriteFilms:Array.isArray(row?.favorite_films)?row.favorite_films:[],favoriteGenres:Array.isArray(row?.favorite_genres)?row.favorite_genres:[],
    dislikedFilm:String(j.disliked_film||''),lastLovedFilm:String(j.last_loved_film||''),avoid:Array.isArray(row?.avoid)?row.avoid:[],
    taste:{weirdness:clamp100(t.weirdness),heaviness:clamp100(t.heaviness),atmosphere:clamp100(t.atmosphere),oldness:clamp100(t.oldness),experimental:clamp100(t.experimental),slowness:clamp100(t.slowness),surrealism:clamp100(t.surrealism)},
    watchReasons:splitList(j.watch_reasons),clubGoal:['cinema','people','both'].includes(String(j.club_goal))?String(j.club_goal):'',clubWants:splitList(j.club_wants),clubAvoid:String(j.club_avoid||''),
    openToMeet:!!j.open_to_meet,publicProfile:!!j.public_profile,dataConsent:j.data_consent===true,rulesConsent:j.rules_consent===true,
    photoVideoConsent:typeof j.photo_video_consent==='boolean'?j.photo_video_consent:(typeof registration?.photo_video_consent==='boolean'?registration.photo_video_consent:null),selfGender:['woman','man'].includes(String(j.self_gender))?String(j.self_gender):''
  }
}
function profileErrors(p:any){
  const e:string[]=[]
  if(String(p.displayName||'').trim().length<2)e.push('имя')
  if(!['woman','man'].includes(String(p.selfGender||'')))e.push('как к вам обращаться')
  if(!['18-24','25-34','35-44','45+'].includes(String(p.ageRange||'')))e.push('возраст')
  if(String(p.city||'').trim().length<2)e.push('город')
  if(String(p.about||'').trim().length<3)e.push('о себе')
  if(splitList(p.favoriteFilms).length<3)e.push('минимум 3 любимых фильма')
  if(splitList(p.favoriteGenres).length<2)e.push('минимум 2 жанра')
  if(!String(p.dislikedFilm||'').trim())e.push('анти-фильм')
  if(!String(p.lastLovedFilm||'').trim())e.push('последний понравившийся фильм')
  if(splitList(p.avoid).length<1)e.push('что не показывать')
  if(splitList(p.watchReasons).length<1)e.push('зачем вы смотрите кино')
  if(splitList(p.clubWants).length<1)e.push('что хочется от клуба')
  if(p.dataConsent!==true)e.push('согласие на обработку данных')
  if(p.rulesConsent!==true)e.push('правила клуба')
  if(typeof p.photoVideoConsent!=='boolean')e.push('решение по фото/видео')
  return e
}
function mechanicsRequired(event:any){if(!nonexistentFilmEnabled(event))throw new Error('Режим «несуществующий фильм» не включён организатором')}
async function withEventOperation<T>(db:any,eventId:string,operation:string,work:()=>Promise<T>,ttlSeconds=180):Promise<T>{
  const lock=await db.rpc('acquire_event_operation',{p_event_id:eventId,p_operation:operation,p_ttl_seconds:ttlSeconds})
  if(lock.error)throw lock.error
  const lease=String(lock.data||'')
  if(!lease){const e:any=new Error('EVENT_OPERATION_BUSY');e.operation=operation;throw e}
  try{return await work()}
  finally{
    const release=await db.rpc('release_event_operation',{p_event_id:eventId,p_operation:operation,p_lease_token:lease})
    if(release.error)console.error('event operation release failed',operation,release.error)
  }
}


function sanitizeProgramBlocks(input:any){
  if(!Array.isArray(input))return null
  const seen=new Set<string>()
  const out:any[]=[]
  for(const raw of input.slice(0,20)){
    const id=String(raw?.id||'').trim().toLowerCase().replace(/[^a-z0-9_\-]/g,'_').slice(0,60)
    if(!id||seen.has(id))continue
    seen.add(id)
    const type=String(raw?.type||id).trim().toLowerCase().replace(/[^a-z0-9_\-]/g,'_').slice(0,60)
    const title=String(raw?.title||id).trim().slice(0,120)
    const duration=Math.max(0,Math.min(240,Math.round(Number(raw?.durationMin??raw?.duration_min??0)||0)))
    const rounds=Math.max(0,Math.min(20,Math.round(Number(raw?.roundsTarget??raw?.rounds_target??0)||0)))
    out.push({id,type,title,duration_min:duration,rounds_target:rounds,enabled:raw?.enabled!==false})
  }
  return out.filter(x=>x.enabled)
}

async function writeRuntime(db:any,event:any,actorUserId:string|null,action:string,patch:any){
  return await withEventOperation(db,event.id,'show-runtime',async()=>{
    const current=await db.from('event_runtime').select('*').eq('event_id',event.id).single()
    if(current.error)throw current.error
    const from=current.data
    const next={...patch,revision:Number(from.revision||0)+1,updated_at:new Date().toISOString()}
    const updated=await db.from('event_runtime').update(next).eq('event_id',event.id).eq('revision',from.revision).select('*').maybeSingle()
    if(updated.error)throw updated.error
    if(!updated.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
    const log=await db.from('event_runtime_log').insert({event_id:event.id,action,actor_user_id:actorUserId,from_state:from,to_state:updated.data})
    if(log.error)console.error('show runtime log failed',log.error)
    return json({ok:true,show:await buildShowState(db,event)})
  })
}

function normalizeQuestion(body:any){
  const prompt=String(body?.prompt||'').trim().slice(0,500)
  const options=(Array.isArray(body?.options)?body.options:[]).map((x:any)=>String(x).trim()).filter(Boolean).slice(0,8)
  const key=String(body?.key||'question').trim().replace(/[^a-zA-Z0-9_\-]/g,'_').slice(0,80)||'question'
  if(!prompt)return null
  return {key,prompt,options}
}

async function getOrCreateUser(db:any,tg:any){
  const existing=await db.from('users').select('*').eq('telegram_id',tg.id).maybeSingle()
  if(existing.error)throw existing.error
  if(existing.data){
    const telegramDisplay=[tg.first_name,tg.last_name].filter(Boolean).join(' ')||null
    const patch:any={}
    if(existing.data.telegram_username!==(tg.username||null))patch.telegram_username=tg.username||null
    // A profile display name is user-controlled. Only seed it from Telegram when it is still empty.
    if(!existing.data.display_name&&telegramDisplay)patch.display_name=telegramDisplay
    if(Object.keys(patch).length){
      patch.updated_at=new Date().toISOString()
      const u=await db.from('users').update(patch).eq('id',existing.data.id).select('*').single()
      if(u.error)throw u.error
      return u.data
    }
    return existing.data
  }
  const created=await db.from('users').insert({telegram_id:tg.id,telegram_username:tg.username||null,display_name:[tg.first_name,tg.last_name].filter(Boolean).join(' ')||null}).select('*').single()
  if(created.error){
    if(String(created.error.code||'')==='23505'){
      const raced=await db.from('users').select('*').eq('telegram_id',tg.id).single()
      if(raced.error)throw raced.error
      return raced.data
    }
    throw created.error
  }
  return created.data
}
async function mustAdmin(db:any,user:any,tg:any){
  if(isConfiguredAdmin(tg))return
  const direct=await db.from('admins').select('role').eq('user_id',user.id).maybeSingle()
  if(direct.error)throw direct.error
  if(direct.data)return
  const username=String(tg?.username||'').trim().replace(/^@/,'').toLowerCase()
  if(username){
    const handle=await db.from('admin_handles').select('role').eq('username',username).maybeSingle()
    if(handle.error)throw handle.error
    if(handle.data){
      const grant=await db.from('admins').upsert({user_id:user.id,role:handle.data.role},{onConflict:'user_id'})
      if(grant.error)throw grant.error
      return
    }
  }
  throw new Error('Admin access required')
}
async function hasPaidAccess(db:any,eventId:string,userId:string){const r=await db.from('registrations').select('status').eq('event_id',eventId).eq('user_id',userId).maybeSingle();if(r.error)throw r.error;return ['paid','attended'].includes(r.data?.status||'')}
function effectiveRegistrationStatus(reg:any){const status=String(reg?.status||'none');if(status==='reserved'){const expires=reg?.reservation_expires_at?new Date(reg.reservation_expires_at).getTime():0;if(!expires||expires<=Date.now())return 'none'}return status}
async function activeSeatCount(db:any,eventId:string){
  const now=new Date().toISOString()
  const [paid,reserved]=await Promise.all([
    db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',eventId).in('status',['paid','attended']),
    db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',eventId).eq('status','reserved').gt('reservation_expires_at',now)
  ])
  if(paid.error)throw paid.error
  if(reserved.error)throw reserved.error
  return Number(paid.count||0)+Number(reserved.count||0)
}

function normalizeFilmWord(value:any){
  return String(value||'').trim().toLowerCase().replace(/[.,!?;:()[\]{}"'«»]+/g,'').replace(/\s+/g,' ').slice(0,80)
}

async function userFilmAssignments(db:any,userId:string){
  const assignments=await db.from('film_assignments').select('*').eq('user_id',userId).order('assigned_at',{ascending:false}).limit(20)
  if(assignments.error)throw assignments.error
  const packageIds=[...new Set((assignments.data||[]).map((x:any)=>String(x.film_package_id)))]
  const packages=packageIds.length?await db.from('film_packages').select('id,title_snapshot,movie_candidate_id').in('id',packageIds):{data:[],error:null} as any
  if(packages.error)throw packages.error
  const packageMap=new Map((packages.data||[]).map((x:any)=>[String(x.id),x]))
  return (assignments.data||[]).map((a:any)=>{
    const p:any=packageMap.get(String(a.film_package_id))||{}
    const daysLeft=Math.ceil((new Date(a.due_at).getTime()-Date.now())/86400000)
    return {
      id:String(a.id),filmPackageId:String(a.film_package_id),filmTitle:String(p.title_snapshot||'фильм'),
      status:String(a.status),assignedAt:a.assigned_at,dueAt:a.due_at,daysLeft,
      beforeWord:String(a.before_word||''),afterWord:a.after_word||undefined,
      correctCount:Number(a.correct_count||0),totalQuestions:Number(a.total_questions||5),
      watchedAt:a.watched_at||undefined,submittedAt:a.submitted_at||undefined
    }
  })
}

async function filmLiveState(db:any,event:any,userId?:string){
  const projector=await db.from('event_projector_state').select('*').eq('event_id',event.id).maybeSingle()
  if(projector.error)throw projector.error
  const p:any=projector.data
  if(!p||['idle','arrival'].includes(String(p.state||'')))return undefined
  let packageRow:any=null
  if(p.film_package_id){
    const r=await db.from('film_packages').select('id,title_snapshot,fragments,status').eq('id',p.film_package_id).eq('event_id',event.id).maybeSingle()
    if(r.error)throw r.error
    packageRow=r.data
  }
  let myWord:any=undefined,myAnswers:any[]=[],myPitch:any=undefined,questionTarget=3
  if(p.round_id){
    const round=await db.from('event_rounds').select('question_target').eq('id',p.round_id).eq('event_id',event.id).maybeSingle()
    if(round.error)throw round.error
    questionTarget=Math.max(1,Math.min(5,Number(round.data?.question_target||3)))
  }
  if(userId&&p.round_id){
    const pitch=await db.from('invented_films').select('id,title,description,updated_at').eq('round_id',p.round_id).eq('user_id',userId).maybeSingle()
    if(pitch.error)throw pitch.error
    if(pitch.data)myPitch={id:String(pitch.data.id),title:String(pitch.data.title),description:String(pitch.data.description),updatedAt:pitch.data.updated_at}
  }
  if(userId&&p.round_id&&p.film_package_id){
    const [impression,preds]=await Promise.all([
      db.from('film_impressions').select('word').eq('round_id',p.round_id).eq('user_id',userId).maybeSingle(),
      db.from('film_predictions').select('question_id,answer,is_correct').eq('round_id',p.round_id).eq('user_id',userId)
    ])
    if(impression.error)throw impression.error;if(preds.error)throw preds.error
    myWord=impression.data?.word||undefined
    myAnswers=preds.data||[]
  }
  return {
    state:String(p.state),revision:Number(p.revision||0),roundId:p.round_id||undefined,filmPackageId:p.film_package_id||undefined,
    filmTitle:packageRow?.title_snapshot||undefined,payload:p.payload||{},myWord,myAnswers,myPitch,questionTarget
  }
}

async function projectorPublicState(db:any,event:any){
  const row=await db.from('event_projector_state').select('*').eq('event_id',event.id).maybeSingle()
  if(row.error)throw row.error
  const p:any=row.data
  if(!p)return {state:'idle',revision:0,payload:{}}
  let payload:any={...(p.payload||{})}
  if(p.film_package_id){
    const pack=await db.from('film_packages').select('title_snapshot,fragments').eq('id',p.film_package_id).eq('event_id',event.id).maybeSingle()
    if(pack.error)throw pack.error
    if(pack.data)payload={...payload,filmTitle:pack.data.title_snapshot}
  }
  if(p.round_id&&p.film_package_id&&['one_word_collecting','one_word_results'].includes(String(p.state))){
    const impressions=await db.from('film_impressions').select('word,normalized_word,animal_name_snapshot').eq('event_id',event.id).eq('round_id',p.round_id).eq('film_package_id',p.film_package_id)
    if(impressions.error)throw impressions.error
    const groups=new Map<string,{word:string;count:number;animals:string[]}>()
    for(const row of impressions.data||[]){
      const key=String(row.normalized_word||'')
      if(!key)continue
      const current=groups.get(key)||{word:String(row.word||key),count:0,animals:[]}
      current.count++
      if(row.animal_name_snapshot)current.animals.push(String(row.animal_name_snapshot))
      groups.set(key,current)
    }
    payload={...payload,wordGroups:[...groups.values()].sort((a,b)=>b.count-a.count||a.word.localeCompare(b.word,'ru')).slice(0,40)}
  }
  return {state:String(p.state||'idle'),revision:Number(p.revision||0),payload,updatedAt:p.updated_at}
}

async function setProjectorState(db:any,event:any,state:string,roundId:string|null,filmPackageId:string|null,payload:any){
  const current=await db.from('event_projector_state').select('revision').eq('event_id',event.id).maybeSingle()
  if(current.error)throw current.error
  const saved=await db.from('event_projector_state').upsert({
    event_id:event.id,state,round_id:roundId,film_package_id:filmPackageId,payload:payload||{},
    revision:Number(current.data?.revision||0)+1,updated_at:new Date().toISOString()
  },{onConflict:'event_id'})
  if(saved.error)throw saved.error
  return await projectorPublicState(db,event)
}

async function filmAdminPackages(db:any,eventId:string){
  const packages=await db.from('film_packages').select('*').eq('event_id',eventId).order('created_at')
  if(packages.error)throw packages.error
  const ids=(packages.data||[]).map((x:any)=>String(x.id))
  const questions=ids.length?await db.from('film_questions').select('*').in('film_package_id',ids).order('position'):{data:[],error:null} as any
  if(questions.error)throw questions.error
  const byPackage=new Map<string,any[]>()
  for(const q of questions.data||[]){const key=String(q.film_package_id);byPackage.set(key,[...(byPackage.get(key)||[]),q])}
  return (packages.data||[]).map((p:any)=>({
    id:String(p.id),movieCandidateId:String(p.movie_candidate_id),title:String(p.title_snapshot),
    fragments:Array.isArray(p.fragments)?p.fragments:[],status:String(p.status),
    questions:(byPackage.get(String(p.id))||[]).map((q:any)=>({
      id:String(q.id),position:Number(q.position),prompt:String(q.prompt),options:q.options||[],
      correctAnswer:q.correct_answer,revealText:String(q.reveal_text||''),revealFragment:q.reveal_fragment||{}
    }))
  }))
}

async function filmAdminReviews(db:any,eventId:string){
  const assignments=await db.from('film_assignments').select('*').eq('event_id',eventId).order('assigned_at',{ascending:false})
  if(assignments.error)throw assignments.error
  const assignmentIds=(assignments.data||[]).map((x:any)=>String(x.id))
  const userIds=[...new Set((assignments.data||[]).map((x:any)=>String(x.user_id)))]
  const packageIds=[...new Set((assignments.data||[]).map((x:any)=>String(x.film_package_id)))]
  const [reviews,users,packages,impressions,predictions]=await Promise.all([
    assignmentIds.length?db.from('submitted_reviews').select('*').in('assignment_id',assignmentIds).order('submitted_at',{ascending:false}):Promise.resolve({data:[],error:null}),
    userIds.length?db.from('users').select('id,display_name,telegram_username').in('id',userIds):Promise.resolve({data:[],error:null}),
    packageIds.length?db.from('film_packages').select('id,title_snapshot').in('id',packageIds):Promise.resolve({data:[],error:null}),
    assignmentIds.length?db.from('film_impressions').select('round_id,normalized_word,word').eq('event_id',eventId):Promise.resolve({data:[],error:null}),
    assignmentIds.length?db.from('film_predictions').select('round_id,user_id,question_id,answer,is_correct').eq('event_id',eventId):Promise.resolve({data:[],error:null})
  ])
  for(const x of [reviews,users,packages,impressions,predictions])if((x as any).error)throw (x as any).error
  const reviewByAssignment=new Map<string,any>()
  for(const x of (reviews as any).data||[]){if(!reviewByAssignment.has(String(x.assignment_id)))reviewByAssignment.set(String(x.assignment_id),x)}
  const userMap=new Map(((users as any).data||[]).map((x:any)=>[String(x.id),x]))
  const packageMap=new Map(((packages as any).data||[]).map((x:any)=>[String(x.id),x]))
  const questionIds=[...new Set(((predictions as any).data||[]).map((x:any)=>String(x.question_id)).filter(Boolean))]
  const questionRows=questionIds.length?await db.from('film_questions').select('id,position,prompt,correct_answer,reveal_text').in('id',questionIds):{data:[],error:null} as any
  if(questionRows.error)throw questionRows.error
  const questionMap=new Map((questionRows.data||[]).map((x:any)=>[String(x.id),x]))
  return (assignments.data||[]).map((a:any)=>{
    const review:any=reviewByAssignment.get(String(a.id));const u:any=userMap.get(String(a.user_id))||{};const p:any=packageMap.get(String(a.film_package_id))||{}
    return {
      assignmentId:String(a.id),animalName:String(a.animal_name_snapshot),filmTitle:String(p.title_snapshot||'фильм'),
      assignedAt:a.assigned_at,dueAt:a.due_at,assignmentStatus:String(a.status),beforeWord:String(a.before_word||''),afterWord:a.after_word||undefined,
      correctCount:Number(a.correct_count||0),totalQuestions:Number(a.total_questions||5),
      oldPredictions:((predictions as any).data||[]).filter((x:any)=>String(x.round_id)===String(a.round_id)&&String(x.user_id)===String(a.user_id)).map((x:any)=>{
        const q:any=questionMap.get(String(x.question_id))||{}
        return {position:Number(q.position||0),prompt:String(q.prompt||''),answer:x.answer,isCorrect:x.is_correct===true,correctAnswer:q.correct_answer,revealText:String(q.reveal_text||'')}
      }).sort((x:any,y:any)=>x.position-y.position),
      reviewId:review?String(review.id):undefined,reviewStatus:review?.status||undefined,submittedAt:review?.submitted_at||undefined,
      snapshot:review?.snapshot||undefined,adminComment:review?.admin_comment||undefined,
      user:{displayName:String(u.display_name||''),telegramUsername:u.telegram_username?String(u.telegram_username):''}
    }
  })
}

async function reviewPersonalQuestion(db:any,assignment:any){
  const preds=await db.from('film_predictions').select('answer,is_correct,question_id').eq('round_id',assignment.round_id).eq('user_id',assignment.user_id).eq('film_package_id',assignment.film_package_id)
  if(preds.error)throw preds.error
  const chosen=(preds.data||[]).find((x:any)=>x.is_correct===false)||(preds.data||[])[0]
  if(!chosen)return 'какой из твоих прогнозов сильнее всего изменился после полного просмотра?'
  const q=await db.from('film_questions').select('prompt,correct_answer,reveal_text').eq('id',chosen.question_id).maybeSingle()
  if(q.error)throw q.error
  const answer=typeof chosen.answer==='string'?chosen.answer:JSON.stringify(chosen.answer)
  const actual=String(q.data?.reveal_text||'').trim()||(typeof q.data?.correct_answer==='string'?q.data.correct_answer:JSON.stringify(q.data?.correct_answer))
  return `ты отвечал на «${String(q.data?.prompt||'вопрос')}» так: «${answer}». на самом деле ${actual}. после полного фильма это стало понятнее?`
}

async function reviewQuestionForStep(db:any,assignment:any,step:number){
  const base=[
    ['after_word','одно слово после полного просмотра. что это за фильм теперь?'],
    ['expectations','он совпал с тем, чего ты ждал после первого фрагмента?'],
    ['memorable','какой момент или образ сильнее всего остался в голове?'],
    ['worked','что в фильме сработало лучше всего?'],
    ['didnt_work','что не сработало или раздражало?'],
    ['recommend','кому бы ты посоветовал этот фильм?'],
    ['crumbs','сколько крошек из 5? напиши число от 1 до 5.']
  ] as [string,string][]
  if(step===1){
    const pack=await db.from('film_packages').select('origin_submission_id').eq('id',assignment.film_package_id).maybeSingle()
    if(pack.error)throw pack.error
    if(pack.data?.origin_submission_id){
      const pitch=await db.from('invented_films').select('title,description').eq('id',pack.data.origin_submission_id).maybeSingle()
      if(pitch.error)throw pitch.error
      if(pitch.data)return {key:'expectations',text:`в начале вечера была идея «${pitch.data.title}»: ${pitch.data.description}. насколько найденный фильм совпал с ожиданиями и с этой идеей?`,kind:'text'}
    }
  }
  if(step<base.length)return {key:base[step][0],text:base[step][1],kind:base[step][0]==='crumbs'?'rating':'text'}
  return {key:'personal',text:await reviewPersonalQuestion(db,assignment),kind:'text'}
}

async function buildReviewDraft(db:any,assignment:any,answers:any){
  const pack=await db.from('film_packages').select('title_snapshot,origin_submission_id,match_data').eq('id',assignment.film_package_id).single()
  if(pack.error)throw pack.error
  const [impressions,preds]=await Promise.all([
    db.from('film_impressions').select('word,normalized_word').eq('event_id',assignment.event_id).eq('round_id',assignment.round_id),
    db.from('film_predictions').select('question_id,answer,is_correct').eq('event_id',assignment.event_id).eq('round_id',assignment.round_id).eq('film_package_id',assignment.film_package_id).eq('user_id',assignment.user_id)
  ])
  if(impressions.error)throw impressions.error
  if(preds.error)throw preds.error
  const counts=new Map<string,number>()
  for(const x of impressions.data||[]){const k=String(x.normalized_word||'');if(k)counts.set(k,(counts.get(k)||0)+1)}
  const collectiveWords=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([word,count])=>({word,count}))
  const questionIds=(preds.data||[]).map((x:any)=>String(x.question_id))
  const questions=questionIds.length?await db.from('film_questions').select('id,position,prompt,correct_answer,reveal_text').in('id',questionIds):{data:[],error:null} as any
  if(questions.error)throw questions.error
  const questionMap=new Map((questions.data||[]).map((x:any)=>[String(x.id),x]))
  const predictionContext=(preds.data||[]).map((x:any)=>{
    const q:any=questionMap.get(String(x.question_id))||{}
    return {position:Number(q.position||0),prompt:String(q.prompt||''),answer:x.answer,isCorrect:x.is_correct===true,correctAnswer:q.correct_answer,revealText:String(q.reveal_text||'')}
  }).sort((a:any,b:any)=>a.position-b.position)
  let inventedIdea:any=undefined
  if(pack.data.origin_submission_id){
    const pitch=await db.from('invented_films').select('title,description,animal_name_snapshot').eq('id',pack.data.origin_submission_id).maybeSingle()
    if(pitch.error)throw pitch.error
    if(pitch.data)inventedIdea={title:pitch.data.title,description:pitch.data.description,animalName:pitch.data.animal_name_snapshot}
  }
  const deterministic={
    animalName:String(assignment.animal_name_snapshot),filmTitle:String(pack.data.title_snapshot),
    inventedIdea,matchReason:String(pack.data.match_data?.alternatives?.[0]?.reason||''),
    beforeWord:String(assignment.before_word||''),afterWord:String(answers.after_word||''),
    crumbs:Math.max(1,Math.min(5,Number(answers.crumbs)||1)),whatStayed:String(answers.memorable||''),
    worked:String(answers.worked||''),didntWork:String(answers.didnt_work||''),recommendTo:String(answers.recommend||''),
    correctCount:Number(assignment.correct_count||0),totalQuestions:Number(assignment.total_questions||5),collectiveWords,predictions:predictionContext
  }
  try{
    const ai=await structuredResponse<any>({
      name:'film_review_draft',
      schema:{type:'object',additionalProperties:false,properties:{
        userReview:{type:'string'},animalTake:{type:'string'},publishText:{type:'string'}
      },required:['userReview','animalTake','publishText']},
      instructions:'Собери короткую русскую рецензию для киноклуба. Не выдумывай факты фильма. Не спорь со вкусом человека. Сохраняй его лексику. Публичная версия без спойлеров. userReview — 2–4 предложения от лица пользователя. animalTake — 1–2 предложения от животинки. publishText — компактная готовая карточка без человеческого имени, только имя животинки.',
      input:JSON.stringify({filmTitle:deterministic.filmTitle,inventedIdea:deterministic.inventedIdea,matchReason:deterministic.matchReason,answers,predictions:predictionContext,correctCount:deterministic.correctCount,totalQuestions:deterministic.totalQuestions}),
      maxOutputTokens:900,
      reasoningEffort:'minimal'
    })
    return {...deterministic,...ai}
  }catch{
    const userReview=[deterministic.whatStayed,deterministic.worked,deterministic.didntWork].filter(Boolean).join(' ')
    const animalTake=`до просмотра было «${deterministic.beforeWord}», после — «${deterministic.afterWord}». ${deterministic.correctCount}/${deterministic.totalQuestions} прогнозов совпали.`
    return {...deterministic,userReview:userReview||String(answers.expectations||''),animalTake,publishText:`${deterministic.animalName} × ${deterministic.filmTitle}. до: «${deterministic.beforeWord}». после: «${deterministic.afterWord}». ${deterministic.crumbs}/5 крошек. ${userReview}`}
  }
}

async function adminParticipantRows(db:any,eventId:string){
  const regs=await db.from('registrations').select('id,user_id,status,queue_position,photo_video_consent,paid_at,reservation_expires_at,created_at').eq('event_id',eventId).order('created_at')
  if(regs.error)throw regs.error
  const ids=(regs.data||[]).map((x:any)=>x.user_id)
  if(!ids.length)return []
  const [users,profiles]=await Promise.all([
    db.from('users').select('id,display_name,telegram_username,deleted_at').in('id',ids),
    db.from('cinema_profiles').select('user_id,profile_json').in('user_id',ids)
  ])
  if(users.error)throw users.error
  if(profiles.error)throw profiles.error
  const userMap=new Map((users.data||[]).map((x:any)=>[x.id,x]))
  const profileMap=new Map((profiles.data||[]).map((x:any)=>[x.user_id,x.profile_json||{}]))
  return (regs.data||[]).map((r:any)=>{
    const u:any=userMap.get(r.user_id)||{}
    const p:any=profileMap.get(r.user_id)||{}
    const deleted=!!u.deleted_at
    return {
      registrationId:r.id,
      displayName:deleted?'удалённый участник':u.display_name||u.telegram_username||'участник',
      telegramUsername:deleted?'':u.telegram_username?('@'+u.telegram_username):'',
      deleted,
      profileComplete:!deleted&&p.completed===true,
      onboardingStep:deleted?0:Number(p.onboarding_step||0),
      status:String(r.status||''),
      queuePosition:r.queue_position??undefined,
      reservationExpiresAt:r.reservation_expires_at||undefined,
      photoVideoConsent:r.photo_video_consent===true,
      paidAt:r.paid_at||undefined,
      registeredAt:r.created_at
    }
  })
}
async function chatRateLimit(db:any,userId:string){
  const minuteAgo=new Date(Date.now()-60_000).toISOString()
  const dayAgo=new Date(Date.now()-86_400_000).toISOString()
  const [minute,day]=await Promise.all([
    db.from('jipitina_messages').select('*',{count:'exact',head:true}).eq('user_id',userId).eq('role','user').gte('created_at',minuteAgo),
    db.from('jipitina_messages').select('*',{count:'exact',head:true}).eq('user_id',userId).eq('role','user').gte('created_at',dayAgo)
  ])
  if(minute.error)throw minute.error
  if(day.error)throw day.error
  if(Number(minute.count||0)>=12)return 'Слишком много сообщений подряд. Попробуйте через минуту.'
  if(Number(day.count||0)>=150)return 'На сегодня сообщений уже очень много. Попробуйте завтра.'
  return ''
}

function tokenMatches(req:Request,header:string,envName:string){
  const expected=Deno.env.get(envName)||'';const got=req.headers.get(header)||''
  if(!expected||!got||expected.length!==got.length)return false
  let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^got.charCodeAt(i);return diff===0
}
function isUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
function notificationQuietUntil(pref:any){
  if(pref?.quiet_hours!==true)return null
  const zone=Deno.env.get('NOTIFICATION_TIMEZONE')||'Europe/Moscow'
  try{
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date())
    const hour=Number(parts.find(x=>x.type==='hour')?.value||0)%24
    const minute=Number(parts.find(x=>x.type==='minute')?.value||0)
    if(hour<9||hour>=22){
      const localMinutes=hour*60+minute
      const waitMinutes=hour>=22?(24*60-localMinutes)+9*60:9*60-localMinutes
      return new Date(Date.now()+Math.max(1,waitMinutes)*60_000).toISOString()
    }
  }catch{}
  return null
}
function notificationRetryAt(attempt:number){
  const minutes=Math.min(30,Math.max(5,attempt*5))
  return new Date(Date.now()+minutes*60_000).toISOString()
}
function notificationErrorIsPermanent(error:unknown){
  const message=String(error||'').toLowerCase()
  return ['blocked by the user','chat not found','user is deactivated','bot was blocked'].some(x=>message.includes(x))
}
async function notificationRelevance(db:any,n:any){
  const now=Date.now()
  if(n.expires_at&&new Date(n.expires_at).getTime()<=now)return {ok:false,reason:'notification expired'}
  if(n.kind==='reminders'){
    const reminderKey=String(n.dedupe_key||'')
    if(reminderKey.startsWith('film_assignment:')){
      const parts=reminderKey.split(':')
      const assignmentId=parts[1]||''
      const code=parts[2]||''
      if(!isUuid(assignmentId))return {ok:false,reason:'film assignment missing'}
      const assignment=await db.from('film_assignments').select('status,due_at').eq('id',assignmentId).eq('user_id',n.user_id).maybeSingle()
      if(assignment.error)throw assignment.error
      if(!assignment.data)return {ok:false,reason:'film assignment missing'}
      const status=String(assignment.data.status||'')
      if(code==='overdue')return status==='overdue'?{ok:true,reason:''}:{ok:false,reason:'film assignment no longer overdue'}
      if(code==='due')return !['submitted','approved','published'].includes(status)?{ok:true,reason:''}:{ok:false,reason:'review already submitted'}
      if(code.startsWith('changes_'))return status==='changes_requested'?{ok:true,reason:''}:{ok:false,reason:'review changes no longer requested'}
      if(code==='3d'||code==='24h')return ['assigned','watching'].includes(status)?{ok:true,reason:''}:{ok:false,reason:'film already watched or review started'}
      return ['assigned','watching','overdue'].includes(status)?{ok:true,reason:''}:{ok:false,reason:'film assignment already progressed'}
    }
    if(!n.event_id)return {ok:false,reason:'reminder event missing'}
    const [event,registration]=await Promise.all([
      db.from('events').select('status,starts_at').eq('id',n.event_id).maybeSingle(),
      db.from('registrations').select('status').eq('event_id',n.event_id).eq('user_id',n.user_id).maybeSingle()
    ])
    if(event.error)throw event.error;if(registration.error)throw registration.error
    if(!event.data||event.data.status==='CLOSED'||new Date(event.data.starts_at).getTime()<=now)return {ok:false,reason:'event already finished'}
    if(!['paid','attended'].includes(String(registration.data?.status||'')))return {ok:false,reason:'registration no longer eligible'}
    const code=String(n.dedupe_key||'').split(':').pop()
    const offset=code==='24h'?24*60*60_000:code==='2h'?2*60*60_000:0
    if(offset){
      const expected=new Date(event.data.starts_at).getTime()-offset
      const queued=new Date(n.send_after).getTime()
      if(!Number.isFinite(queued)||Math.abs(queued-expected)>60_000)return {ok:false,reason:'event schedule changed'}
    }
  }
  if(n.kind==='events'&&n.event_id){
    const event=await db.from('events').select('status,starts_at').eq('id',n.event_id).maybeSingle();if(event.error)throw event.error
    if(!event.data||['DRAFT','CLOSED'].includes(String(event.data.status||''))||new Date(event.data.starts_at).getTime()<=now)return {ok:false,reason:'event announcement no longer current'}
  }
  if(n.kind==='matches'&&String(n.dedupe_key||'').startsWith('match:')){
    const id=String(n.dedupe_key).slice(6)
    if(isUuid(id)){
      const connection=await db.from('social_connections').select('status,metadata').eq('id',id).maybeSingle();if(connection.error)throw connection.error
      const hidden=Array.isArray(connection.data?.metadata?.hidden_by)?connection.data.metadata.hidden_by:[]
      if(!connection.data||connection.data.status!=='active'||hidden.includes(n.user_id))return {ok:false,reason:'match no longer active'}
    }
  }
  return {ok:true,reason:''}
}

async function telegramRuntimeReady(){
  const token=String(Deno.env.get('TELEGRAM_BOT_TOKEN')||'').trim()
  const webAppUrl=String(Deno.env.get('TELEGRAM_WEBAPP_URL')||'').trim()
  const webhookSecret=String(Deno.env.get('TELEGRAM_WEBHOOK_SECRET')||'').trim()
  if(!token||!webAppUrl||!webhookSecret)return false
  try{
    const web=new URL(webAppUrl)
    if(web.protocol!=='https:')return false
    const [me,hook]=await Promise.all([telegramBot('getMe',{}),telegramBot('getWebhookInfo',{})])
    const expectedBot='nasipateli_v_kinobot'
    const botOk=String(me?.username||'').replace(/^@/,'').toLowerCase()===expectedBot
    const supabaseUrl=String(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'')
    const expectedHook=supabaseUrl?`${supabaseUrl}/functions/v1/app?mode=telegram`:''
    const actualHook=String(hook?.url||'').replace(/\/$/,'')
    return botOk&&!!actualHook&&(!expectedHook||actualHook===expectedHook)
  }catch{return false}
}

async function runtimeHealth(db:any){
  const requiredTables=['users','cinema_profiles','events','registrations','payment_refunds','event_operation_locks','creatures','creature_tasks','user_creature_tasks','creature_game_config','crumb_ledger','story_definitions','dating_profiles','notification_preferences','notification_queue','encounter_tokens','film_packages','film_questions','film_impressions','film_predictions','film_assignments','review_sessions','submitted_reviews','event_projector_state','invented_films']
  const [tableChecks,pilot,telegram,gameConfig,testTask]=await Promise.all([
    Promise.all(requiredTables.map(async table=>{const r=await db.from(table).select('*',{head:true}).limit(1);return !r.error})),
    db.from('events').select('slug,capacity,ticket_price_rub,starts_at,venue_name').eq('slug','2026-10-03').maybeSingle(),
    telegramRuntimeReady(),
    db.from('creature_game_config').select('feeding_cost,feeding_growth,stage_thresholds').eq('id','default').maybeSingle(),
    db.from('creature_tasks').select('id,status,active,reward_crumbs,completion_type').eq('id','first_test_task').maybeSingle()
  ])
  const env=(name:string)=>!!String(Deno.env.get(name)||'').trim()
  const pilotOk=!pilot.error&&pilot.data?.slug==='2026-10-03'&&Number(pilot.data?.capacity)===50&&Number(pilot.data?.ticket_price_rub)===0&&new Date(pilot.data?.starts_at||0).toISOString()==='2026-10-03T13:00:00.000Z'&&String(pilot.data?.venue_name||'').toLowerCase()==='хлебозавод №9'
  const thresholds=gameConfig.data?.stage_thresholds||{}
  const thresholdValues=['stage_0','stage_1','stage_2','stage_3','stage_4'].map(stage=>Number(thresholds?.[stage]))
  const thresholdsOk=
    thresholdValues.every(Number.isFinite)&&
    thresholdValues[0]===0&&
    thresholdValues.every((value,index)=>index===0||value>thresholdValues[index-1])
  const gameLoop=
    !gameConfig.error&&!!gameConfig.data&&
    Number(gameConfig.data.feeding_cost)>0&&
    Number(gameConfig.data.feeding_growth)>0&&
    thresholdsOk&&
    !testTask.error&&
    testTask.data?.id==='first_test_task'&&
    testTask.data?.status==='active'&&
    testTask.data?.active===true&&
    Number(testTask.data?.reward_crumbs)>0&&
    testTask.data?.completion_type==='manual'

  const checks={
    database:tableChecks.every(Boolean),
    gameLoop,
    pilot:pilotOk,
    telegram,
    payments:env('TELEGRAM_PROVIDER_TOKEN'),
    openai:env('OPENAI_API_KEY'),
    admin:env('ADMIN_ACCESS_TOKEN')||env('ADMIN_TELEGRAM_IDS')||env('ADMIN_TELEGRAM_USERNAMES'),
    screen:env('SCREEN_ACCESS_TOKEN'),
    cron:env('CRON_ACCESS_TOKEN'),
    demoOff:Deno.env.get('ALLOW_DEMO_AUTH')!=='true'
  }
  return {ok:true,version:'0.9.0',service:'nasypateli-cinema',ready:Object.values(checks).every(Boolean),checks}
}

async function telegramBot(method:string,body:Record<string,unknown>){
  const token=Deno.env.get('TELEGRAM_BOT_TOKEN');if(!token)throw new Error('TELEGRAM_BOT_TOKEN missing')
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const j=await r.json();if(!j.ok)throw new Error(j.description||method);return j.result
}
async function telegramStartLink(payload:string){
  try{const me=await telegramBot('getMe',{});const username=String(me?.username||'').replace(/^@/,'');return username?`https://t.me/${username}?start=${encodeURIComponent(payload)}`:null}catch(e){console.warn('telegram start link unavailable',e);return null}
}

async function refreshLeaderboard(db:any,userIds:string[]){
  for(const uid of [...new Set(userIds)]){
    const [scores,wins,attended]=await Promise.all([
      db.from('event_scores').select('points').eq('user_id',uid),
      db.from('events').select('*',{count:'exact',head:true}).eq('winner_user_id',uid),
      db.from('registrations').select('*',{count:'exact',head:true}).eq('user_id',uid).eq('status','attended')
    ])
    for(const r of [scores,wins,attended])if(r.error)throw r.error
    await db.from('leaderboard').upsert({user_id:uid,events_attended:attended.count||0,prediction_points:(scores.data||[]).reduce((n:number,x:any)=>n+Number(x.points||0),0),wins:wins.count||0,updated_at:new Date().toISOString()})
  }
}

async function userExtras(db:any,userId:string){
  const [leader,ideas,attendance,messages]=await Promise.all([
    db.from('leaderboard').select('events_attended,prediction_points,wins').eq('user_id',userId).maybeSingle(),
    db.from('film_ideas').select('id').eq('user_id',userId),
    db.from('registrations').select('event_id').eq('user_id',userId).eq('status','attended'),
    db.from('jipitina_messages').select('id,role,text,mode,request_id,delivery_status,created_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(30)
  ])
  for(const [label,r] of [['leaderboard',leader],['ideas',ideas],['attendance',attendance],['messages',messages]] as const){
    if(r.error)console.warn('optional bootstrap query failed',label,String(r.error.message||r.error))
  }
  const attendedIds=[...new Set((attendance.error?[]:(attendance.data||[])).map((x:any)=>x.event_id).filter(Boolean))]
  const past=attendedIds.length
    ?await db.from('events').select('id,slug,title,starts_at,status').in('id',attendedIds).eq('status','CLOSED').order('starts_at',{ascending:false}).limit(12)
    :{data:[],error:null}
  if(past.error)console.warn('optional bootstrap query failed','past-events',String(past.error.message||past.error))
  const eventIds=(past.error?[]:(past.data||[])).map((x:any)=>x.id)
  const [movies,reviews,scores,myReviews]=eventIds.length?await Promise.all([
    db.from('event_movie').select('event_id,movie_candidates(title,year)').in('event_id',eventIds),
    db.from('event_outputs').select('event_id,payload').in('event_id',eventIds).eq('output_key','collective_review').eq('approved',true),
    db.from('event_scores').select('event_id,correct,total,points,rank').eq('user_id',userId).in('event_id',eventIds),
    db.from('final_reviews').select('event_id,rating,final_sentence').eq('user_id',userId).in('event_id',eventIds)
  ]):[
    {data:[],error:null},{data:[],error:null},{data:[],error:null},{data:[],error:null}
  ]
  for(const [label,r] of [['movies',movies],['reviews',reviews],['scores',scores],['my-reviews',myReviews]] as const){
    if(r.error)console.warn('optional bootstrap query failed',label,String(r.error.message||r.error))
  }
  const movieMap=new Map((movies.error?[]:(movies.data||[])).map((x:any)=>[x.event_id,x.movie_candidates]))
  const reviewMap=new Map((reviews.error?[]:(reviews.data||[])).map((x:any)=>[x.event_id,x.payload]))
  const scoreMap=new Map((scores.error?[]:(scores.data||[])).map((x:any)=>[x.event_id,x]))
  const myReviewMap=new Map((myReviews.error?[]:(myReviews.data||[])).map((x:any)=>[x.event_id,x]))
  const pastEvents=(past.data||[]).map((ev:any)=>{
    const score:any=scoreMap.get(ev.id)
    const own:any=myReviewMap.get(ev.id)
    return {
      id:ev.id,slug:ev.slug,title:ev.title,startsAt:ev.starts_at,
      movie:movieMap.get(ev.id)||undefined,
      review:reviewMap.get(ev.id)||undefined,
      prediction:score?{correct:Number(score.correct||0),total:Number(score.total||0),points:Number(score.points||0),rank:Number(score.rank||0)}:undefined,
      myReview:own?{rating:Number(own.rating||0),sentence:String(own.final_sentence||'')}:undefined
    }
  })
  return {
    profileStats:{eventsAttended:Number(leader.error?0:(leader.data?.events_attended||0)),predictionPoints:Number(leader.error?0:(leader.data?.prediction_points||0)),wins:Number(leader.error?0:(leader.data?.wins||0)),ideasSubmitted:ideas.error?0:(ideas.data||[]).length},
    pastEvents,
    jipitinaMessages:(messages.error?[]:(messages.data||[])).reverse().map((m:any)=>({id:m.id,role:m.role,text:m.text,mode:m.mode,requestId:m.request_id||undefined,deliveryStatus:m.delivery_status||undefined,createdAt:m.created_at}))
  }
}

async function chatContext(db:any,event:any,user:any,profile:any){
  const [memories,clubMem,registration,movie,answers,reaction,review]=await Promise.all([
    db.from('jipitina_memory').select('memory_key,memory_text').eq('scope','user').eq('scope_id',user.id).limit(30),
    db.from('jipitina_memory').select('memory_key,memory_text').eq('scope','club').limit(30),
    db.from('registrations').select('status,reservation_expires_at').eq('event_id',event.id).eq('user_id',user.id).maybeSingle(),
    db.from('event_movie').select('movie_candidates(title,year,runtime_min,reason)').eq('event_id',event.id).maybeSingle(),
    db.from('prediction_answers').select('question_id,answer,prediction_questions(text,actual)').eq('event_id',event.id).eq('user_id',user.id),
    db.from('post_film_reactions').select('*').eq('event_id',event.id).eq('user_id',user.id).maybeSingle(),
    db.from('final_reviews').select('rating,final_sentence').eq('event_id',event.id).eq('user_id',user.id).maybeSingle()
  ])
  for(const r of [memories,clubMem,registration,movie,answers,reaction,review])if(r.error)throw r.error
  const creature=await creatureState(db,user.id);return {profile,creature:{name:creature.name,stage:creature.stage,traits:creature.traits,storyCount:creature.storyCount,recentStories:creature.timeline.slice(0,8)},userMemory:memories.data||[],clubMemory:clubMem.data||[],event:{id:event.id,title:event.title,status:event.status,mechanicEnabled:nonexistentFilmEnabled(event),registration:effectiveRegistrationStatus(registration.data)},selectedMovie:(movie.data as any)?.movie_candidates||null,predictions:answers.data||[],reaction:reaction.data||null,finalReview:review.data||null}
}

async function processChatAftermath(db:any,userId:string,message:string,reply:string,occurrenceKey:string,eventId?:string){
  if(message.trim().length<12)return
  const storyCodes=['rabbit_wrong','we_agreed','rabbit_knows_me','rabbit_doesnt_know','first_argument','changed_rabbit_mind','rabbit_changed_mine','asked_for_surprise','trusted_choice','rejected_three','taste_calibrated','rabbit_predicted_rating','rabbit_missed_rating','late_night_chat','rabbit_secret']
  const schema={type:'object',additionalProperties:false,properties:{updates:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{key:{type:'string'},text:{type:'string'},confidence:{type:'number',minimum:0,maximum:1}},required:['key','text','confidence']}},storyCodes:{type:'array',maxItems:2,items:{type:'string',enum:storyCodes}}},required:['updates','storyCodes']}
  const out=await structuredResponse<any>({name:'chat_aftermath',schema,instructions:JIPITINA,input:`Из пары реплик извлеки только устойчивые факты о кинопредпочтениях. Можно сохранить осторожный паттерн вкуса, если он прямо поддержан репликами: например отношение к темпу, атмосфере, экспериментальности, жанрам, сложности или эмоциональной тяжести. Не делай выводов о личности вне кино. Если реально произошла одна из перечисленных историй Животины, верни её code. Не выдавай историю просто за упоминание условия: она должна действительно произойти в разговоре. Не сохраняй здоровье, политику, интимную жизнь, финансы, адреса, отношения и случайные эмоции. Пользователь: ${JSON.stringify(message)}\nЖивотина: ${JSON.stringify(reply)}`,maxOutputTokens:350,reasoningEffort:'none'})
  for(const u of out.updates||[]){if(Number(u.confidence)<0.78)continue;const key=String(u.key||'preference').toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi,'_').slice(0,70)||'preference';await db.from('jipitina_memory').upsert({scope:'user',scope_id:userId,memory_key:key,memory_text:String(u.text||'').slice(0,500),source:'jipitina_chat'},{onConflict:'scope,scope_id,memory_key'})}
  await emitStoryTrigger(db,userId,'jipitina_chat',{occurrenceKey},eventId||null)
  for(const code of out.storyCodes||[]){if(storyCodes.includes(code))await emitStoryTrigger(db,userId,'jipitina_chat',{story_code:code,occurrenceKey},eventId||null)}
}

async function publicScreenAnimalId(eventId:string,userId:string){
  const bytes=new TextEncoder().encode(eventId+':'+userId)
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))
  return 'animal-'+Array.from(digest.slice(0,8)).map(x=>x.toString(16).padStart(2,'0')).join('')
}

export async function handleApi(req:Request){
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method==='GET')return json({ok:true,version:'0.9.0',service:'nasypateli-cinema'})
  if(req.method!=='POST')return err('Нужен POST-запрос',405)
  try{
    const body=await req.json();const action=String(body.action||'');const db=adminDb()
    const adminTokenOk=tokenMatches(req,'x-admin-token','ADMIN_ACCESS_TOKEN');const screenTokenOk=tokenMatches(req,'x-screen-token','SCREEN_ACCESS_TOKEN');const cronTokenOk=tokenMatches(req,'x-cron-token','CRON_ACCESS_TOKEN')
    if(action==='health')return json(await runtimeHealth(db))

    if(action==='screen-bootstrap'){
      if(!screenTokenOk)return err('Доступ к экрану запрещён',401)
      const event=await eventBySlug(db,String(body.slug||'2026-10-03'))
      const [state,attended]=await Promise.all([
        buildEventState(db,event,{includeActuals:false}),
        db.from('registrations').select('user_id,created_at').eq('event_id',event.id).eq('status','attended').order('created_at')
      ])
      if(attended.error)throw attended.error
      const ids=(attended.data||[]).map((x:any)=>String(x.user_id))
      const creatures=ids.length?await db.from('creatures').select('user_id,name,stage,crumbs,growth_progress,settings').in('user_id',ids):{data:[],error:null} as any
      if(creatures.error)throw creatures.error
      const creatureMap=new Map((creatures.data||[]).map((x:any)=>[String(x.user_id),x]))
      const screenCreatures=(await Promise.all(ids.map(async(userId)=>{
        const x:any=creatureMap.get(userId)
        if(!x)return null
        return {
          id:await publicScreenAnimalId(event.id,userId),name:String(x.name||'животина'),stage:String(x.stage||'stage_0'),
          visualVariant:Math.max(1,Math.min(50,Math.round(Number(x.settings?.visual_variant||1)))),
          crumbs:Number(x.crumbs||0),growthProgress:Number(x.growth_progress||0)
        }
      }))).filter(Boolean)
      const projector=await projectorPublicState(db,event)
      return json({
        event:state.event,
        show:state.show,
        screenMessage:state.screenMessage||'',
        screenCreatures,
        projector,
        ideaProgress:state.ideaProgress,
        selectedIdea:state.selectedIdea
      })
    }
    if(action==='admin-bootstrap'){
      if(!adminTokenOk){
        try{
          const adminTg=await telegramUserFromRequest(req)
          const adminUser=await getOrCreateUser(db,adminTg)
          await mustAdmin(db,adminUser,adminTg)
        }catch{return err('Доступ к пульту запрещён',401)}
      }
      const event=await eventBySlug(db,String(body.slug||'2026-10-03'))
      const [state,adminParticipants,movieCatalog,showLog,movieSources]=await Promise.all([
        buildEventState(db,event,{includeActuals:true,includePrivateOutputs:true}),
        adminParticipantRows(db,event.id),
        db.from('movie_candidates').select('*').eq('event_id',event.id).order('title'),
        db.from('event_runtime_log').select('id,action,created_at').eq('event_id',event.id).order('created_at',{ascending:false}).limit(20),
        db.from('movie_source_candidates').select('*').eq('event_id',event.id).order('discovered_at',{ascending:false})
      ])
      if(movieCatalog.error)throw movieCatalog.error
      if(showLog.error)throw showLog.error
      if(movieSources.error)throw movieSources.error
      const sourceByMovie=new Map<string,any[]>()
      for(const s of movieSources.data||[]){
        const key=String(s.movie_candidate_id)
        sourceByMovie.set(key,[...(sourceByMovie.get(key)||[]),s])
      }
      const [filmPackages,reviewQueue,projector]=await Promise.all([
        filmAdminPackages(db,event.id),
        filmAdminReviews(db,event.id),
        projectorPublicState(db,event)
      ])
      const currentRoundId=state.show?.currentRound?.id
      const pitchRows=currentRoundId
        ? await db.from('invented_films').select('id,user_id,animal_name_snapshot,title,description,created_at,updated_at').eq('event_id',event.id).eq('round_id',currentRoundId).order('created_at')
        : {data:[],error:null} as any
      if(pitchRows.error)throw pitchRows.error
      const inventedFilms=(pitchRows.data||[]).map((x:any)=>({
        id:String(x.id),userId:String(x.user_id),animalName:String(x.animal_name_snapshot),
        title:String(x.title),description:String(x.description),createdAt:x.created_at,updatedAt:x.updated_at
      }))
      return json({...state,adminParticipants,filmPackages,reviewQueue,projector,inventedFilms,movieCatalog:(movieCatalog.data||[]).map((x:any)=>({
        id:x.id,title:x.title,originalTitle:x.original_title||undefined,year:x.year||undefined,runtimeMin:x.runtime_min||undefined,
        genre:x.genre||undefined,country:x.country||undefined,reason:x.reason||undefined,enabledForEvent:x.enabled_for_event!==false,
        trailerStatus:x.trailer_status||'unchecked',clipStatus:x.clip_status||'unchecked',sourceType:x.source_type||undefined,
        sourcePlatform:x.source_platform||undefined,sourceUrl:x.source_url||undefined,videoId:x.video_id||undefined,
        startSec:x.start_sec??undefined,endSec:x.end_sec??undefined,sourceChannel:x.source_channel||undefined,
        sourceVerified:x.source_verified===true,verifiedAt:x.verified_at||undefined,usageStatus:x.usage_status||'needs_review',
        discussionPrompts:Array.isArray(x.discussion_prompts)?x.discussion_prompts:[],animalComment:x.animal_comment||undefined,
        tags:Array.isArray(x.tags)?x.tags:[],
        sourceCandidates:(sourceByMovie.get(String(x.id))||[]).map((s:any)=>({
          id:String(s.id),useMode:String(s.use_mode),sourceType:String(s.source_type),sourcePlatform:String(s.source_platform),
          sourceUrl:String(s.source_url),videoId:s.video_id||undefined,title:s.title||undefined,sourceChannel:s.source_channel||undefined,
          startSec:Number(s.start_sec||0),endSec:s.end_sec==null?undefined:Number(s.end_sec),verified:s.verified===true,
          embeddable:s.embeddable===true,official:s.official===true,rightsStatus:String(s.rights_status),
          availabilityStatus:String(s.availability_status),confidence:Number(s.confidence||0),discoveredAt:s.discovered_at,
          selected:String(s.source_url)===String(x.source_url||'')&&Number(s.start_sec||0)===Number(x.start_sec||0),
          manualSelected:String(s.metadata?.manual_selected||'false')==='true'
        }))
      })),showLog:(showLog.data||[]).map((x:any)=>({id:String(x.id),action:x.action,createdAt:x.created_at}))})
    }

    if(action==='cron-notifications'){
      if(!cronTokenOk)return err('Доступ к служебному запуску запрещён',401)
      const saleEvents=await db.from('events').select('id').eq('status','SALES_OPEN');if(saleEvents.error)throw saleEvents.error
      let promoted=0
      for(const ev of saleEvents.data||[]){const p=await db.rpc('promote_event_waitlist',{p_event_id:ev.id});if(p.error)throw p.error;promoted+=Number(p.data||0)}
      const reminderSchedule=await db.rpc('schedule_event_reminders');if(reminderSchedule.error)throw reminderSchedule.error
      const scheduledReminders=Number(reminderSchedule.data||0)
      const overdueAssignments=await db.from('film_assignments').update({status:'overdue',updated_at:new Date().toISOString()}).lt('due_at',new Date().toISOString()).in('status',['assigned','watching']).select('id')
      if(overdueAssignments.error)throw overdueAssignments.error
      const due=await db.from('notification_queue').select('id,user_id,kind,text,dedupe_key,event_id,expires_at,send_after,attempts,users(telegram_id)').eq('status','pending').lte('send_after',new Date().toISOString()).order('send_after').limit(50)
      if(due.error)throw due.error
      let sent=0,retried=0,failed=0,cancelled=0,deferred=0
      for(const n of due.data||[]){
        const attempt=Math.max(0,Number(n.attempts||0))+1
        const attemptedAt=new Date().toISOString()
        try{
          const relevant=await notificationRelevance(db,n)
          if(!relevant.ok){
            const r=await db.from('notification_queue').update({status:'cancelled',error:relevant.reason}).eq('id',n.id)
            if(r.error)throw r.error
            cancelled++
            continue
          }
          const prefR=await db.from('notification_preferences').select('*').eq('user_id',n.user_id).maybeSingle()
          if(prefR.error)throw prefR.error
          const pref=prefR.data
          const allowed=pref?.write_access===true&&pref?.[n.kind]!==false
          if(!allowed){
            const r=await db.from('notification_queue').update({status:'cancelled',error:'preference disabled'}).eq('id',n.id)
            if(r.error)throw r.error
            cancelled++
            continue
          }
          const quietUntil=notificationQuietUntil(pref)
          if(quietUntil){
            if(n.expires_at&&new Date(quietUntil).getTime()>=new Date(n.expires_at).getTime()){
              const r=await db.from('notification_queue').update({status:'cancelled',error:'expired during quiet hours'}).eq('id',n.id)
              if(r.error)throw r.error
              cancelled++
            }else{
              const r=await db.from('notification_queue').update({send_after:quietUntil,error:'deferred by quiet hours'}).eq('id',n.id)
              if(r.error)throw r.error
              deferred++
            }
            continue
          }
          const chatId=(n as any).users?.telegram_id
          if(!chatId){
            const r=await db.from('notification_queue').update({status:'failed',error:'telegram id missing',attempts:attempt,last_attempt_at:attemptedAt}).eq('id',n.id)
            if(r.error)throw r.error
            failed++
            continue
          }
          const webAppUrl=String(Deno.env.get('TELEGRAM_WEBAPP_URL')||'').trim()
          const waitlistPromotion=n.kind==='tickets'&&String(n.dedupe_key||'').startsWith('waitlist_promoted:')
          let waitlistButton='оплатить место'
          if(waitlistPromotion&&n.event_id){
            const price=await db.from('events').select('ticket_price_rub').eq('id',n.event_id).maybeSingle()
            if(price.error)console.error('waitlist ticket price lookup failed',price.error)
            else if(Number(price.data?.ticket_price_rub||0)===0)waitlistButton='подтвердить билет'
          }
          const ticketReplyMarkup=n.kind==='tickets'&&webAppUrl?{inline_keyboard:[[{text:waitlistPromotion?waitlistButton:'открыть билет',web_app:{url:webAppUrl}}]]}:undefined
          const baseUrl=webAppUrl.split('#')[0]
          const generalReplyMarkup=!ticketReplyMarkup&&webAppUrl&&['events','reminders','matches','stories','creature'].includes(String(n.kind))
            ?{inline_keyboard:[[{text:n.kind==='matches'?'открыть знакомства':n.kind==='stories'||n.kind==='creature'?'открыть животину':'открыть событие',web_app:{url:n.kind==='matches'?baseUrl+'#/dating':n.kind==='stories'||n.kind==='creature'?baseUrl+'#/zhivotina':webAppUrl}}]]}
            :undefined
          const replyMarkup=ticketReplyMarkup||generalReplyMarkup
          await telegramBot('sendMessage',{chat_id:chatId,text:n.text,...(replyMarkup?{reply_markup:replyMarkup}:{})})
          const r=await db.from('notification_queue').update({status:'sent',sent_at:new Date().toISOString(),error:null,attempts:attempt,last_attempt_at:attemptedAt}).eq('id',n.id)
          if(r.error)throw r.error
          sent++
        }catch(e){
          const message=String(e).slice(0,500)
          const permanent=notificationErrorIsPermanent(e)
          const exhausted=attempt>=3
          const patch=permanent||exhausted
            ?{status:'failed',error:message,attempts:attempt,last_attempt_at:attemptedAt}
            :{status:'pending',error:message,attempts:attempt,last_attempt_at:attemptedAt,send_after:notificationRetryAt(attempt)}
          const r=await db.from('notification_queue').update(patch).eq('id',n.id)
          if(r.error)console.error('notification retry state failed',r.error)
          if(permanent||exhausted)failed++;else retried++
        }
      }
      return json({ok:true,promoted,scheduledReminders,sent,retried,failed,cancelled,deferred,checked:(due.data||[]).length})
    }

    const isAdminAction=action.startsWith('admin-')||action.startsWith('ai-')||action.startsWith('draw-')
    let tg:any=null,user:any=null
    if(!isAdminAction||!adminTokenOk){tg=await telegramUserFromRequest(req);user=await getOrCreateUser(db,tg)}

    if(action==='creature-tasks'){
      const creature=await ensureCreature(db,user.id)
      if(!creature.born_at)return err('Сначала должна родиться Животина',409)
      const [tasks,done]=await Promise.all([
        db.from('creature_tasks').select('id,title,description,reward_crumbs,completion_type,available_from,available_until,status').eq('active',true).eq('status','active').order('created_at',{ascending:true}),
        db.from('user_creature_tasks').select('task_id,status,completed_at').eq('user_id',user.id)
      ])
      if(tasks.error)throw tasks.error;if(done.error)throw done.error
      const by=new Map((done.data||[]).map((x:any)=>[x.task_id,x]))
      const now=Date.now()
      return json({ok:true,tasks:(tasks.data||[]).filter((x:any)=>(!x.available_from||new Date(x.available_from).getTime()<=now)&&(!x.available_until||new Date(x.available_until).getTime()>=now)).map((x:any)=>({id:x.id,title:x.title,description:x.description,rewardCrumbs:Number(x.reward_crumbs||0),completionType:x.completion_type,status:by.get(x.id)?.status||'available',completedAt:by.get(x.id)?.completed_at||undefined}))})
    }

    if(action==='complete-creature-task'){
      const taskId=String(body.taskId||'').trim()
      if(!taskId)return err('Не указано задание',400)
      const r=await db.rpc('complete_creature_task',{p_user_id:user.id,p_task_id:taskId});if(r.error)throw r.error
      return json({...(r.data||{}),creature:await creatureState(db,user.id)})
    }

    if(action==='feed-creature'){
      const r=await db.rpc('feed_creature',{p_user_id:user.id});if(r.error)throw r.error
      return json({...(r.data||{}),creature:await creatureState(db,user.id)})
    }

    if(action==='birth-creature'||action==='participant-birth-v2'){
      const name=(String(body.name||'животина').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU').slice(0,32)||'животина')
      const ex=await db.from('creatures').select('user_id,name,born_at,crumbs').eq('user_id',user.id).maybeSingle()
      if(ex.error)throw ex.error
      const existing=ex.data
      if(existing?.born_at)return json({ok:true,alreadyBorn:true,creature:await creatureState(db,user.id)})

      // A fresh birth starts a fresh creature-task lifecycle. Older profile
      // deletion code could leave task rows behind after removing the creature.
      const staleTasks=await db.from('user_creature_tasks').delete().eq('user_id',user.id)
      if(staleTasks.error)throw staleTasks.error

      const bornAt=new Date().toISOString()

      if(existing){
        const write=await db.from('creatures')
          .update({name,born_at:bornAt})
          .eq('user_id',user.id)
          .is('born_at',null)
          .select('user_id')
          .maybeSingle()

        if(write.error)throw write.error

        // Another request may have completed birth after the initial read.
        // In that case the conditional update touches no row and the first
        // successful birth remains canonical.
        if(!write.data)return json({ok:true,alreadyBorn:true,creature:await creatureState(db,user.id)})
      }else{
        const write=await db.from('creatures')
          .insert({user_id:user.id,name,born_at:bornAt,crumbs:0})
          .select('user_id')
          .maybeSingle()

        if(write.error){
          // user_id is the creatures primary key. A duplicate means another
          // concurrent request created the creature first, so treat this as
          // an idempotent retry rather than overwriting birth state.
          if(String(write.error.code||'')==='23505'){
            return json({ok:true,alreadyBorn:true,creature:await creatureState(db,user.id)})
          }
          throw write.error
        }
      }

      return json({ok:true,alreadyBorn:false,creature:await creatureState(db,user.id)})
    }

    if(action==='rename-creature'){
      const name=String(body.name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU').slice(0,32)
      if(name.length<2)return err('имя должно быть хотя бы из двух символов',422)
      const creature=await ensureCreature(db,user.id)
      if(!creature.born_at)return err('сначала должна родиться животина',409)
      const updated=await db.from('creatures').update({name,updated_at:new Date().toISOString()}).eq('user_id',user.id).select('user_id').maybeSingle()
      if(updated.error)throw updated.error
      if(!updated.data)return err('животина не найдена',404)
      return json({ok:true,creature:await creatureState(db,user.id)})
    }

    if(action==='bootstrap'){
      let event=await nextEvent(db)
      if(!event){
        const activeMission=await db.from('film_assignments').select('event_id').eq('user_id',user.id).neq('status','published').order('assigned_at',{ascending:false}).limit(1).maybeSingle()
        if(activeMission.error)throw activeMission.error
        if(activeMission.data?.event_id)event=await eventBySlug(db,String(activeMission.data.event_id))
      }
      if(!event)return json({user,profile:null,event:null,onboardingComplete:false})
      if(event.status==='SALES_OPEN'){const promoted=await db.rpc('promote_event_waitlist',{p_event_id:event.id});if(promoted.error)throw promoted.error}
      if(event.status!=='CLOSED'){
        const presence=await db.from('event_presence').upsert({event_id:event.id,user_id:user.id,last_seen_at:new Date().toISOString()},{onConflict:'event_id,user_id'})
        if(presence.error)console.error('presence heartbeat failed',presence.error)
      }
      const [common,profileRow,reg,idea,answers,thought,reaction,review,feedback,extras,creature,datingBundle,notif]=await Promise.all([
        buildEventState(db,event,{includeActuals:false}),
        db.from('cinema_profiles').select('*').eq('user_id',user.id).maybeSingle(),
        db.from('registrations').select('*').eq('event_id',event.id).eq('user_id',user.id).maybeSingle(),
        db.from('film_ideas').select('id,title,plot').eq('event_id',event.id).eq('user_id',user.id).maybeSingle(),
        db.from('prediction_answers').select('question_id,answer').eq('event_id',event.id).eq('user_id',user.id),
        db.from('discussion_thoughts').select('text').eq('event_id',event.id).eq('user_id',user.id).maybeSingle(),
        db.from('post_film_reactions').select('rating,state_word,thought,recommendation').eq('event_id',event.id).eq('user_id',user.id).maybeSingle(),
        db.from('final_reviews').select('rating,final_sentence').eq('event_id',event.id).eq('user_id',user.id).maybeSingle(),
        db.from('event_feedback').select('*').eq('event_id',event.id).eq('user_id',user.id).maybeSingle(),
        userExtras(db,user.id),
        creatureState(db,user.id),
        datingState(db,user.id),
        db.from('notification_preferences').select('*').eq('user_id',user.id).maybeSingle()
      ])
      for(const r of [profileRow,reg,idea,answers,thought,reaction,review,feedback,notif])if(r.error)throw r.error
      if(!notif.data)await db.from('notification_preferences').insert({user_id:user.id})
      const profile=normalizeProfile(user,profileRow.data,reg.data,tg);const answerMap=new Map((answers.data||[]).map((x:any)=>[x.question_id,x.answer]))
      let isAdmin=false
      try{await mustAdmin(db,user,tg);isAdmin=true}catch{}
      let show=(common as any).show
      if(show?.currentRound?.id){
        const mine=await db.from('event_votes').select('answer').eq('event_id',event.id).eq('round_id',show.currentRound.id).eq('user_id',user.id).eq('question_key',String(show.currentRound.question?.key||'question')).maybeSingle()
        if(mine.error)throw mine.error
        show={...show,myVote:mine.data?.answer}
      }
      const [filmAssignments,filmLive]=await Promise.all([userFilmAssignments(db,user.id),filmLiveState(db,event,user.id)])
      let nepokoyCardIndex: number|undefined
      if(String(event.title||'').toLocaleLowerCase('ru-RU').includes('непокой')&&effectiveRegistrationStatus(reg.data)==='attended'){
        const room=await db.from('registrations').select('user_id,created_at').eq('event_id',event.id).eq('status','attended').order('created_at').order('user_id')
        if(room.error)throw room.error
        const index=(room.data||[]).findIndex((x:any)=>String(x.user_id)===String(user.id))
        if(index>=0)nepokoyCardIndex=index%5
      }
      return json({...common,show,isAdmin,user,profile,filmAssignments,filmLive,nepokoyCardIndex,onboardingComplete:profile.completed,registration:effectiveRegistrationStatus(reg.data),queuePosition:effectiveRegistrationStatus(reg.data)==='waitlist'?Number(reg.data?.queue_position||0)||undefined:undefined,reservationExpiresAt:effectiveRegistrationStatus(reg.data)==='reserved'?reg.data?.reservation_expires_at||undefined:undefined,idea:idea.data||undefined,predictions:(common.predictions||[]).map((p:any)=>({...p,answer:answerMap.get(p.id)})),predictionSubmitted:(answers.data||[]).length>0,thought:thought.data?.text,reaction:reaction.data?{rating:reaction.data.rating,stateWord:reaction.data.state_word,thought:reaction.data.thought,recommendation:reaction.data.recommendation}:undefined,review:review.data?{rating:review.data.rating,sentence:review.data.final_sentence}:undefined,feedback:feedback.data?{returnIntent:feedback.data.return_intent,strongest:feedback.data.strongest_part||'',improve:feedback.data.improve_text||'',willingness:feedback.data.willingness_to_pay||0,durationFeel:feedback.data.duration_feel||'нормально',inviteFriend:feedback.data.invite_friend===null||feedback.data.invite_friend===undefined?8:Number(feedback.data.invite_friend)}:undefined,...extras,creature,...datingBundle,notificationPrefs:{writeAccess:!!notif.data?.write_access,events:notif.data?.events!==false,creature:notif.data?.creature!==false,stories:notif.data?.stories!==false,matches:notif.data?.matches!==false,tickets:notif.data?.tickets!==false,reminders:notif.data?.reminders!==false,quietHours:notif.data?.quiet_hours!==false}})
    }

    if(action==='save-profile-progress'||action==='save-profile'){
      const incoming=body.profile||{};const existing=await db.from('cinema_profiles').select('*').eq('user_id',user.id).maybeSingle();if(existing.error)throw existing.error
      const reg=await db.from('registrations').select('photo_video_consent').eq('user_id',user.id).order('created_at',{ascending:false}).limit(1).maybeSingle();if(reg.error)throw reg.error
      const current=normalizeProfile(user,existing.data,reg.data,tg);const merged={...current,...incoming,taste:{...current.taste,...(incoming.taste||{})},onboardingStep:Number(body.step??incoming.onboardingStep??current.onboardingStep)}
      merged.favoriteFilms=splitList(merged.favoriteFilms);merged.favoriteGenres=splitList(merged.favoriteGenres);merged.avoid=splitList(merged.avoid);merged.watchReasons=splitList(merged.watchReasons);merged.clubWants=splitList(merged.clubWants)
      if(action==='save-profile'){
        const errors=profileErrors(merged);if(errors.length)return err(`Заполните обязательные поля: ${errors.join(', ')}`,422)
        merged.completed=true;merged.completedAt=new Date().toISOString()
      }
      const display=String(merged.displayName||'').slice(0,80);if(display)await db.from('users').update({display_name:display,updated_at:new Date().toISOString()}).eq('id',user.id)
      const profileJson={...(existing.data?.profile_json||{}),completed:!!merged.completed,completed_at:merged.completedAt||null,onboarding_step:merged.onboardingStep,age_range:String(merged.ageRange||''),city:String(merged.city||'').slice(0,120),about:String(merged.about||'').slice(0,300),telegram_photo_url:String(merged.telegramPhotoUrl||tg?.photo_url||''),disliked_film:String(merged.dislikedFilm||'').slice(0,200),last_loved_film:String(merged.lastLovedFilm||'').slice(0,200),taste:Object.fromEntries(Object.entries(merged.taste||defaultTaste).map(([k,v])=>[k,clamp100(v)])),watch_reasons:splitList(merged.watchReasons),club_goal:String(merged.clubGoal||''),club_wants:splitList(merged.clubWants),club_avoid:String(merged.clubAvoid||'').slice(0,300),self_gender:['woman','man'].includes(String(merged.selfGender))?merged.selfGender:null,open_to_meet:!!merged.openToMeet,public_profile:!!merged.publicProfile,data_consent:merged.dataConsent===true,rules_consent:merged.rulesConsent===true,photo_video_consent:typeof merged.photoVideoConsent==='boolean'?merged.photoVideoConsent:null}
      const up=await db.from('cinema_profiles').upsert({user_id:user.id,favorite_films:splitList(merged.favoriteFilms),favorite_genres:splitList(merged.favoriteGenres),avoid:splitList(merged.avoid),profile_json:profileJson,updated_at:new Date().toISOString()});if(up.error)throw up.error
      if(typeof merged.photoVideoConsent==='boolean')await db.from('registrations').update({photo_video_consent:merged.photoVideoConsent}).eq('user_id',user.id)
      return json({ok:true,completed:!!merged.completed,profile:merged})
    }


    if(action==='equip-cosmetic'){
      const code=String(body.code||'');const owned=await db.from('user_creature_cosmetics').select('cosmetic_id,creature_cosmetics!inner(code,slot)').eq('user_id',user.id).eq('creature_cosmetics.code',code).maybeSingle();if(owned.error)throw owned.error;if(!owned.data)return err('Этой вещи у Животины нет',404)
      const equipped=body.equipped===true;const slot=(owned.data as any).creature_cosmetics?.slot
      if(equipped&&slot){const same=await db.from('user_creature_cosmetics').select('cosmetic_id,creature_cosmetics!inner(slot)').eq('user_id',user.id).eq('creature_cosmetics.slot',slot);if(same.error)throw same.error;const ids=(same.data||[]).map((x:any)=>x.cosmetic_id);if(ids.length)await db.from('user_creature_cosmetics').update({equipped:false}).eq('user_id',user.id).in('cosmetic_id',ids)}
      const r=await db.from('user_creature_cosmetics').update({equipped}).eq('user_id',user.id).eq('cosmetic_id',(owned.data as any).cosmetic_id);if(r.error)throw r.error;return json({ok:true})
    }
    if(action==='save-notification-prefs'){
      const p=body.prefs||{};const r=await db.from('notification_preferences').upsert({user_id:user.id,write_access:p.writeAccess===true,events:p.events!==false,creature:p.creature!==false,stories:p.stories!==false,matches:p.matches!==false,tickets:p.tickets!==false,reminders:p.reminders!==false,quiet_hours:p.quietHours!==false,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(r.error)throw r.error;return json({ok:true})
    }
    if(action==='save-dating-profile'){
      const d=body.dating||{};const selfGender=['woman','man'].includes(String(d.selfGender))?String(d.selfGender):null;const showGender=['women','men','all'].includes(String(d.showGender))?String(d.showGender):null;const allowed=new Set(['friends','cinema_company','chat','dates','anything']);const intents=(Array.isArray(d.intents)?d.intents:[]).map(String).filter((x:string)=>allowed.has(x)).slice(0,5)
      if(d.enabled===true&&(!selfGender||!showGender||!intents.length))return err('Заполните настройки знакомств',422)
      const r=await db.from('dating_profiles').upsert({user_id:user.id,enabled:d.enabled===true,self_gender:selfGender,show_gender:showGender,intents,paused:d.paused===true,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(r.error)throw r.error
      return json({ok:true})
    }
    if(action==='dating-swipe'){
      const targetId=String(body.targetUserId||'')
      const direction=String(body.direction||'')
      if(!isUuid(targetId)||targetId===user.id||!['like','pass'].includes(direction))return err('Некорректный свайп',422)
      const [target,mine,blocks,existingSwipe]=await Promise.all([
        db.from('dating_profiles').select('enabled,paused,intents,self_gender,show_gender').eq('user_id',targetId).maybeSingle(),
        db.from('dating_profiles').select('enabled,paused,intents,self_gender,show_gender').eq('user_id',user.id).maybeSingle(),
        db.from('user_blocks').select('blocker_id,blocked_id').or(`and(blocker_id.eq.${user.id},blocked_id.eq.${targetId}),and(blocker_id.eq.${targetId},blocked_id.eq.${user.id})`).limit(1),
        db.from('dating_swipes').select('direction').eq('swiper_id',user.id).eq('target_id',targetId).maybeSingle()
      ])
      for(const r of [target,mine,blocks,existingSwipe])if(r.error)throw r.error
      if(!mine.data?.enabled||mine.data?.paused)return err('Сначала включите знакомства',409)
      if(!target.data?.enabled||target.data?.paused)return err('Этот профиль сейчас недоступен',409)
      if((blocks.data||[]).length)return err('Этот профиль недоступен',403)
      if(!allowedGender(mine.data.show_gender,target.data.self_gender)||!allowedGender(target.data.show_gender,mine.data.self_gender))return err('Этот профиль не входит в ваши взаимные фильтры',403)
      if(!intentsCompatible(mine.data.intents||[],target.data.intents||[]))return err('У вас сейчас нет совместимого формата знакомства',403)
      if(existingSwipe.data&&existingSwipe.data.direction!==direction)return err('Решение по этой карточке уже сохранено',409)
      if(!existingSwipe.data){
        const sw=await db.from('dating_swipes').insert({swiper_id:user.id,target_id:targetId,direction,created_at:new Date().toISOString()})
        if(sw.error)throw sw.error
      }
      if(direction==='pass')return json({ok:true,matched:false})
      const reverse=await db.from('dating_swipes').select('direction').eq('swiper_id',targetId).eq('target_id',user.id).maybeSingle()
      if(reverse.error)throw reverse.error
      if(reverse.data?.direction!=='like'){
        const likeNotice=await db.from('notification_queue').upsert({
          user_id:targetId,kind:'matches',text:'кто-то отметил тебя в знакомствах · загляни, вдруг это взаимно',
          send_after:new Date().toISOString(),status:'pending',dedupe_key:`dating_like:${user.id}:${targetId}`
        },{onConflict:'user_id,dedupe_key'})
        if(likeNotice.error)console.error('dating like notification enqueue failed',likeNotice.error)
        return json({ok:true,matched:false})
      }
      const kind=connectionKind(mine.data?.intents||[],target.data?.intents||[])
      const [pa,pb]=await Promise.all([
        db.from('cinema_profiles').select('favorite_films').eq('user_id',user.id).maybeSingle(),
        db.from('cinema_profiles').select('favorite_films').eq('user_id',targetId).maybeSingle()
      ])
      if(pa.error)throw pa.error;if(pb.error)throw pb.error
      const bset=new Set((pb.data?.favorite_films||[]).map((x:string)=>x.toLowerCase()))
      const shared=(pa.data?.favorite_films||[]).filter((x:string)=>bset.has(x.toLowerCase()))
      const made=await db.rpc('create_dating_connection',{p_user_a:user.id,p_user_b:targetId,p_kind:kind,p_shared_films:shared})
      if(made.error){
        if(String(made.error.message||'').includes('dating pair blocked'))return err('Этот профиль недоступен',403)
        throw made.error
      }
      const connection=made.data?.[0]
      if(!connection)return err('Не удалось создать связь',500)
      if(connection.connection_status!=='active')return err('Эта связь сейчас недоступна',409)
      if(connection.created){
        for(const uid of [user.id,targetId]){
          await emitStoryTrigger(db,uid,'dating_match',{story_code:'first_match',kind,shared_favorites:shared.length},null)
          await emitStoryTrigger(db,uid,'dating_match',{story_code:kind==='romantic'?'romantic_match':kind==='cinema'?'cinema_match':'friend_match',kind,shared_favorites:shared.length},null)
          if(shared.length)await emitStoryTrigger(db,uid,'dating_match',{story_code:'same_favorite_match',kind,shared_favorites:shared.length},null)
        }
        for(const uid of [user.id,targetId])await db.from('notification_queue').upsert({user_id:uid,kind:'matches',text:'ваши животины совпали · откройте знакомства',send_after:new Date().toISOString(),status:'pending',dedupe_key:'match:'+connection.connection_id},{onConflict:'user_id,dedupe_key'})
      }
      return json({ok:true,matched:true,connectionId:connection.connection_id,kind:connection.connection_kind})
    }
    if(action==='dating-hide-connection'){
      const id=String(body.connectionId||'')
      if(!isUuid(id))return err('Связь не найдена',404)
      const r=await db.rpc('hide_dating_connection',{p_user_id:user.id,p_connection_id:id})
      if(r.error)throw r.error
      if(r.data!==true)return err('Связь не найдена',404)
      return json({ok:true})
    }
    if(action==='dating-block'){
      const targetId=String(body.targetUserId||'')
      if(!isUuid(targetId)||targetId===user.id)return err('Некорректный профиль',422)
      const r=await db.rpc('block_dating_user',{p_blocker_id:user.id,p_blocked_id:targetId})
      if(r.error)throw r.error
      return json({ok:true})
    }
    if(action==='audio-transcribe'){
      const b64=String(body.audioBase64||'');if(!b64||b64.length>6_500_000)return err('Голосовое слишком большое',413);const raw=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));if(raw.byteLength>4_500_000)return err('Голосовое слишком большое',413);const text=await transcribeAudio(raw,String(body.mimeType||'audio/webm'));return json({ok:true,text})
    }
    if(action==='my-encounter-token'){
      const now=new Date().toISOString();const existing=await db.from('encounter_tokens').select('token,expires_at').eq('owner_user_id',user.id).eq('kind','rabbit').gt('expires_at',now).order('created_at',{ascending:false}).limit(1).maybeSingle();if(existing.error)throw existing.error
      let token=String(existing.data?.token||'');let expiresAt=existing.data?.expires_at||null
      if(!token){token=crypto.randomUUID().replaceAll('-','');expiresAt=new Date(Date.now()+1000*60*60*24*30).toISOString();const r=await db.from('encounter_tokens').insert({token,owner_user_id:user.id,kind:'rabbit',expires_at:expiresAt});if(r.error)throw r.error}
      return json({ok:true,token,expiresAt,deepLink:await telegramStartLink(`encounter_${token}`)})
    }
    if(action==='encounter'){
      const token=String(body.token||'').trim();const t=await db.from('encounter_tokens').select('*').eq('token',token).maybeSingle();if(t.error)throw t.error;if(!t.data)return err('Этот жетон не существует',404);if(t.data.expires_at&&new Date(t.data.expires_at).getTime()<Date.now())return err('Этот жетон уже истёк',410)
      if(t.data.kind==='event_checkin'){
        if(!t.data.event_id)return err('У жетона нет события',422)
        const [reg,ev]=await Promise.all([
          db.from('registrations').select('status').eq('event_id',t.data.event_id).eq('user_id',user.id).maybeSingle(),
          db.from('events').select('slug,title,starts_at,status').eq('id',t.data.event_id).single()
        ])
        if(reg.error)throw reg.error;if(ev.error)throw ev.error
        if(!checkinOpenStatuses.has(String(ev.data.status||'')))return err(ev.data.status==='CLOSED'?'Чек-ин на этот вечер уже закрыт':'Чек-ин ещё не открыт',409)
        const awardJoin=async()=>{
          const p=await db.from('event_programs').select('config').eq('event_id',t.data.event_id).maybeSingle()
          if(p.error){console.error('checkin reward config failed',p.error);return null}
          const amount=Math.max(0,Math.min(100,Number(p.data?.config?.rewards?.join||0)))
          if(!amount)return null
          const a=await db.rpc('award_event_crumbs',{p_user_id:user.id,p_event_id:t.data.event_id,p_amount:amount,p_reason:'event_join',p_source_id:'checkin'})
          if(a.error){console.error('checkin crumb award failed',a.error);return null}
          return a.data
        }
        if(reg.data?.status==='attended'){const crumbs=await awardJoin();return json({ok:true,kind:'event_checkin',alreadyAttended:true,awards:[],crumbs})}
        if(reg.data?.status!=='paid')return err('Для отметки нужен подтверждённый билет на это событие',403)
        const attended=await db.from('registrations').update({status:'attended'}).eq('event_id',t.data.event_id).eq('user_id',user.id).eq('status','paid').select('user_id').maybeSingle()
        if(attended.error)throw attended.error
        if(!attended.data){
          const latest=await db.from('registrations').select('status').eq('event_id',t.data.event_id).eq('user_id',user.id).maybeSingle();if(latest.error)throw latest.error
          if(latest.data?.status==='attended'){const crumbs=await awardJoin();return json({ok:true,kind:'event_checkin',alreadyAttended:true,awards:[],crumbs})}
          return err('Не удалось подтвердить чек-ин. Обновите билет и попробуйте ещё раз.',409)
        }
        const memberCount=await db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',t.data.event_id).eq('status','attended');if(memberCount.error)throw memberCount.error
        const minutesBefore=Math.round((new Date(ev.data.starts_at).getTime()-Date.now())/60000)
        const awards=await emitStoryTrigger(db,user.id,'event_checkin',{event_slug:ev.data.slug,member_number:Number(memberCount.count||0),minutes_before:minutesBefore,...(t.data.metadata||{})},t.data.event_id)
        const crumbs=await awardJoin()
        await refreshLeaderboard(db,[user.id])
        return json({ok:true,kind:'event_checkin',alreadyAttended:false,awards,crumbs})
      }
      if(t.data.kind==='rabbit'){
        const other=String(t.data.owner_user_id||'');if(!other||other===user.id)return err('Это жетон вашей собственной Животины',409);const [a,b]=await Promise.all([db.from('cinema_profiles').select('favorite_films,favorite_genres').eq('user_id',user.id).maybeSingle(),db.from('cinema_profiles').select('favorite_films,favorite_genres').eq('user_id',other).maybeSingle()]);const bf=new Set((b.data?.favorite_films||[]).map((x:string)=>x.toLowerCase()));const bg=new Set((b.data?.favorite_genres||[]).map((x:string)=>x.toLowerCase()));const sharedFavorites=(a.data?.favorite_films||[]).filter((x:string)=>bf.has(x.toLowerCase())).length;const sharedGenres=(a.data?.favorite_genres||[]).filter((x:string)=>bg.has(x.toLowerCase())).length;for(const uid of [user.id,other]){await emitStoryTrigger(db,uid,'encounter',{story_code:'first_rabbit_meet',shared_favorites:sharedFavorites,shared_genres:sharedGenres,other_user_id:uid===user.id?other:user.id},t.data.event_id||null);if(sharedFavorites)await emitStoryTrigger(db,uid,'encounter',{story_code:'same_taste',shared_favorites:sharedFavorites,shared_genres:sharedGenres},t.data.event_id||null);if(!sharedFavorites&&!sharedGenres)await emitStoryTrigger(db,uid,'encounter',{story_code:'nothing_common',shared_favorites:0,shared_genres:0},t.data.event_id||null)}return json({ok:true,kind:'rabbit',sharedFavorites,sharedGenres})
      }
      return err('Неизвестный тип жетона',422)
    }
    if(action==='delete-profile'){
      if(String(body.confirm)!=='DELETE_PROFILE')return err('Нужно подтверждение удаления',422)
      const r=await db.rpc('delete_user_profile',{p_user_id:user.id})
      if(r.error)throw r.error
      return json({ok:true,alreadyDeleted:!!r.data?.alreadyDeleted})
    }

    const slug=String(body.slug||'2026-10-03');const event=await eventBySlug(db,slug)

    if(action==='claim-event-ticket'){
      if(Number(event.ticket_price_rub)!==0)return err('этот билет нельзя получить без оплаты',409)
      if(!['SALES_OPEN','CHECKIN'].includes(String(event.status||'')))return err('регистрация на этот вечер сейчас закрыта',409)
      const profileRow=await db.from('cinema_profiles').select('profile_json').eq('user_id',user.id).maybeSingle();if(profileRow.error)throw profileRow.error
      if(profileRow.data?.profile_json?.completed!==true)return err('сначала завершите кинопрофиль',409)
      const reserve=await db.rpc('reserve_event_spot',{p_event_id:event.id,p_user_id:user.id,p_amount_rub:0,p_photo_video_consent:profileRow.data?.profile_json?.photo_video_consent===true})
      if(reserve.error)throw reserve.error
      const slot=reserve.data?.[0];if(!slot)return err('не удалось закрепить место',500)
      if(['paid','attended'].includes(String(slot.reservation_status||'')))return json({ok:true,status:String(slot.reservation_status)})
      if(slot.reservation_status==='waitlist')return json({ok:true,status:'waitlist',queuePosition:Number(slot.queue_position||0)||undefined})
      if(slot.reservation_status!=='reserved')return err('не удалось получить билет',409)
      const confirmed=await db.from('registrations').update({status:'paid',queue_position:null,payment_provider:'registration',provider_payment_id:null,telegram_payment_charge_id:null,amount_rub:0,paid_at:new Date().toISOString(),reservation_expires_at:null}).eq('event_id',event.id).eq('user_id',user.id).eq('status','reserved').select('status').maybeSingle()
      if(confirmed.error)throw confirmed.error
      if(!confirmed.data){
        const latest=await db.from('registrations').select('status,queue_position').eq('event_id',event.id).eq('user_id',user.id).maybeSingle();if(latest.error)throw latest.error
        if(['paid','attended'].includes(String(latest.data?.status||'')))return json({ok:true,status:String(latest.data?.status)})
        if(latest.data?.status==='waitlist')return json({ok:true,status:'waitlist',queuePosition:Number(latest.data?.queue_position||0)||undefined})
        return err('не удалось подтвердить билет. попробуйте ещё раз',409)
      }
      const notice=await db.from('notification_queue').upsert({user_id:user.id,kind:'tickets',text:`билет получен. ${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(event.starts_at))} · ${event.venue_name||'место внутри приложения'}`,send_after:new Date().toISOString(),status:'pending',dedupe_key:`free_ticket:${event.id}`,event_id:event.id,expires_at:event.starts_at},{onConflict:'user_id,dedupe_key'})
      if(notice.error)console.error('free ticket notification enqueue failed',notice.error)
      return json({ok:true,status:'paid'})
    }

    if(action==='cancel-event-ticket'){
      if(Number(event.ticket_price_rub)!==0)return err('самостоятельная отмена доступна только для бесплатной регистрации',409)
      if(String(event.status||'')!=='SALES_OPEN')return err('отменить билет можно до начала сбора гостей',409)
      const current=await db.from('registrations').select('status,payment_provider,amount_rub').eq('event_id',event.id).eq('user_id',user.id).maybeSingle()
      if(current.error)throw current.error
      if(!current.data||current.data.status==='cancelled')return json({ok:true,status:'cancelled'})
      if(current.data.status==='attended')return err('вход уже отмечен · отменить билет нельзя',409)
      if(current.data.status!=='paid'||current.data.payment_provider!=='registration'||Number(current.data.amount_rub)!==0)return err('этот билет нельзя отменить этой кнопкой',409)
      const cancelled=await db.from('registrations').update({
        status:'cancelled',
        queue_position:null,
        reservation_expires_at:null,
        paid_at:null
      }).eq('event_id',event.id).eq('user_id',user.id).eq('status','paid').eq('payment_provider','registration').select('status').maybeSingle()
      if(cancelled.error)throw cancelled.error
      if(!cancelled.data){
        const latest=await db.from('registrations').select('status').eq('event_id',event.id).eq('user_id',user.id).maybeSingle()
        if(latest.error)throw latest.error
        if(latest.data?.status==='cancelled')return json({ok:true,status:'cancelled'})
        return err('не удалось отменить билет · обновите экран и попробуйте ещё раз',409)
      }
      const notices=await db.from('notification_queue').update({status:'cancelled',error:'ticket cancelled by user'}).eq('user_id',user.id).eq('event_id',event.id).eq('status','pending').in('kind',['tickets','reminders'])
      if(notices.error)console.error('ticket cancellation notification cleanup failed',notices.error)
      return json({ok:true,status:'cancelled'})
    }

    if(action==='jipitina-chat'){
      const profileRow=await db.from('cinema_profiles').select('*').eq('user_id',user.id).maybeSingle();if(profileRow.error)throw profileRow.error
      const reg=await db.from('registrations').select('*').eq('event_id',event.id).eq('user_id',user.id).maybeSingle();if(reg.error)throw reg.error
      const profile=normalizeProfile(user,profileRow.data,reg.data,tg);if(!profile.completed)return err('Сначала завершите кинопрофиль',409)
      const mode=allowedChatModes.has(String(body.mode))?String(body.mode):'general'
      const message=String(body.message||'').trim().slice(0,3000);if(!message)return err('Напишите сообщение')
      const requestId=isUuid(String(body.requestId||''))?String(body.requestId):crypto.randomUUID()
      if(mode==='idea_coach'){mechanicsRequired(event);if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(event.status!=='IDEAS_OPEN')return err('Идеи сейчас не принимаются',409)}
      if(mode==='post_film'){if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(!['DISCUSSION','FINAL_REVIEW','FEEDBACK','CLOSED'].includes(event.status))return err('Разговор после фильма ещё не открыт',409)}

      const attemptId=crypto.randomUUID()
      const claimed=await db.rpc('claim_creature_chat',{p_user_id:user.id,p_event_id:event.id,p_request_id:requestId,p_mode:mode,p_text:message,p_attempt_id:attemptId})
      if(claimed.error){
        const detail=String(claimed.error.message||claimed.error)
        if(detail.includes('CHAT_REQUEST_CONFLICT'))return err('это сообщение уже было отправлено с другим текстом',409)
        if(detail.includes('CHAT_RATE_LIMIT'))return err('слишком много сообщений подряд. попробуйте чуть позже',429)
        throw claimed.error
      }
      const claim=claimed.data||{}
      if(claim.state==='completed'){
        const completed=Array.isArray(claim.messages)?claim.messages:[]
        const answer=completed.find((x:any)=>x?.role==='assistant')
        if(answer?.text)return json({ok:true,reply:String(answer.text),mode:String(answer.mode||mode),requestId,replayed:true})
      }
      if(claim.state==='pending')return err('животина уже отвечает на это сообщение',409)
      const claimedMessage=claim.message
      if(claim.state!=='claimed'||!claimedMessage?.id)return err('не получилось поставить сообщение в очередь. попробуйте ещё раз',409)

      const context=await chatContext(db,event,user,profile)
      const recentRows=await db.from('jipitina_messages').select('role,text,mode,request_id').eq('user_id',user.id).order('created_at',{ascending:false}).limit(18)
      if(recentRows.error)throw recentRows.error
      const recent=(recentRows.data||[]).filter((x:any)=>String(x.request_id||'')!==requestId).slice(0,16).reverse().map((x:any)=>({role:x.role,text:x.text,mode:x.mode}))
      const draft=mode==='idea_coach'?{title:String(body.draftTitle||''),plot:String(body.draftPlot||'')}:undefined
      const input=`КОНТЕКСТ JSON:\n${JSON.stringify({...context,draft,recent})}\n\nСООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:\n${message}`
      const chatSchema={type:'object',additionalProperties:false,properties:{reply:{type:'string',minLength:1,maxLength:2200}},required:['reply']}
      let chat:{reply:string}
      try{
        chat=await structuredResponse<{reply:string}>({name:'zhivotina_chat',schema:chatSchema,instructions:jipitinaInstructions(mode),input,maxOutputTokens:620,reasoningEffort:'none'})
      }catch(e:any){
        const detail=String(e?.message||e||'unknown')
        console.error('jipitina model request failed',detail)
        const failed=await db.from('jipitina_messages').update({delivery_status:'failed',lease_until:null}).eq('user_id',user.id).eq('request_id',requestId).eq('role','user').eq('attempt_id',attemptId)
        if(failed.error)console.error('chat failure state update failed',failed.error)
        return err('чат временно недоступен. попробуйте ещё раз',503)
      }
      const reply=String(chat.reply||'').trim().toLocaleLowerCase('ru-RU').replaceAll('·','.').replace(/\.+$/,'')
      const finished=await db.rpc('finish_creature_chat',{p_user_id:user.id,p_request_id:requestId,p_attempt_id:attemptId,p_reply:reply})
      if(finished.error){
        const detail=String(finished.error.message||finished.error)
        if(detail.includes('CHAT_LEASE_LOST')){
          const recovered=await db.from('jipitina_messages').select('text,mode').eq('user_id',user.id).eq('request_id',requestId).eq('role','assistant').maybeSingle()
          if(!recovered.error&&recovered.data?.text)return json({ok:true,reply:String(recovered.data.text),mode:String(recovered.data.mode||mode),requestId,replayed:true})
          return err('ответ уже обрабатывается в другой попытке. обновите чат',409)
        }
        throw finished.error
      }
      const task=processChatAftermath(db,user.id,message,reply,String(claimedMessage.id),event.id).catch((e:any)=>console.error('chat aftermath failed',e));const edge=(globalThis as any).EdgeRuntime;if(edge?.waitUntil)edge.waitUntil(task)
      return json({ok:true,reply,mode,requestId})
    }

    if(action==='submit-idea'){
      mechanicsRequired(event);if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(event.status!=='IDEAS_OPEN')return err('Приём идей сейчас закрыт',409)
      const title=String(body.title||'').trim(),plot=String(body.plot||'').trim();if(!title||!plot)return err('Заполните название и сюжет')
      const r=await db.from('film_ideas').upsert({event_id:event.id,user_id:user.id,title:title.slice(0,100),plot:plot.slice(0,500)},{onConflict:'event_id,user_id'});if(r.error)throw r.error;return json({ok:true})
    }
    if(action==='submit-predictions'){
      mechanicsRequired(event);if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(event.status!=='PREDICTIONS_OPEN')return err('Прогнозы сейчас закрыты',409)
      const list=Array.isArray(body.predictions)?body.predictions:[];if(list.length!==10||list.some((x:any)=>typeof x.answer!=='boolean'||!String(x.id||'')))return err('Нужно ответить на все 10 прогнозов')
      const ids=list.map((x:any)=>String(x.id));if(new Set(ids).size!==10)return err('Прогнозы не должны повторяться',422)
      const expected=await db.from('prediction_questions').select('id').eq('event_id',event.id);if(expected.error)throw expected.error
      const valid=new Set((expected.data||[]).map((x:any)=>String(x.id)));if(valid.size!==10||ids.some((id:string)=>!valid.has(id)))return err('Эти прогнозы относятся к другому событию',422)
      const rows=list.map((x:any)=>({event_id:event.id,question_id:String(x.id),user_id:user.id,answer:x.answer}));const r=await db.from('prediction_answers').upsert(rows);if(r.error)throw r.error;return json({ok:true})
    }
    if(action==='submit-reaction'){
      if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(event.status!=='DISCUSSION')return err('Реакции сейчас закрыты',409)
      const x=body.reaction||{};const rating=Number(x.rating);const stateWord=String(x.stateWord||'').trim();const thought=String(x.thought||'').trim();const recommendation=String(x.recommendation||'')
      if(!Number.isInteger(rating)||rating<1||rating>10||!stateWord||!thought||!['yes','no','depends'].includes(recommendation))return err('Заполните всю реакцию',422)
      const r=await db.from('post_film_reactions').upsert({event_id:event.id,user_id:user.id,rating,state_word:stateWord.slice(0,80),thought:thought.slice(0,500),recommendation,updated_at:new Date().toISOString()},{onConflict:'event_id,user_id'});if(r.error)throw r.error
      await db.from('discussion_thoughts').upsert({event_id:event.id,user_id:user.id,text:thought.slice(0,240)},{onConflict:'event_id,user_id'})
      const room=await db.from('post_film_reactions').select('rating').eq('event_id',event.id);const avg=(room.data||[]).length?(room.data||[]).reduce((a:number,v:any)=>a+Number(v.rating||0),0)/(room.data||[]).length:rating;await emitStoryTrigger(db,user.id,'reaction_saved',{rating,rating_gap:Math.abs(rating-avg),recommendation},event.id)
      return json({ok:true})
    }
    if(action==='submit-thought'){
      if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(event.status!=='DISCUSSION')return err('Обсуждение сейчас закрыто',409)
      const r=await db.from('discussion_thoughts').upsert({event_id:event.id,user_id:user.id,text:String(body.text||'').slice(0,240)});if(r.error)throw r.error;return json({ok:true})
    }
    if(action==='submit-review'){
      if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(event.status!=='FINAL_REVIEW')return err('Финальная рецензия сейчас закрыта',409)
      const rating=Number(body.rating);if(!Number.isInteger(rating)||rating<1||rating>10)return err('Поставьте оценку от 1 до 10');const sentence=String(body.sentence||'').trim();if(!sentence)return err('Напишите финальную фразу');const r=await db.from('final_reviews').upsert({event_id:event.id,user_id:user.id,rating,final_sentence:sentence.slice(0,180)});if(r.error)throw r.error;return json({ok:true})
    }
    if(action==='submit-feedback'){
      if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(!['FEEDBACK','CLOSED'].includes(event.status))return err('Обратная связь сейчас закрыта',409)
      const f=body.feedback||{};const invite=Math.max(0,Math.min(10,Number(f.inviteFriend)));const r=await db.from('event_feedback').upsert({event_id:event.id,user_id:user.id,return_intent:String(f.returnIntent||''),strongest_part:String(f.strongest||'').slice(0,1000),improve_text:String(f.improve||'').slice(0,1000),willingness_to_pay:Number(f.willingness)||null,duration_feel:String(f.durationFeel||''),invite_friend:Number.isFinite(invite)?String(invite):null});if(r.error)throw r.error;return json({ok:true})
    }

    if(action==='event-vote'){
      if(!await hasPaidAccess(db,event.id,user.id))return err('нужен подтверждённый билет',403)
      const show=await buildShowState(db,event)
      const round=show.currentRound
      if(!round?.id||round.status!=='active')return err('сейчас нет активного раунда',409)
      if(round.voteState!=='open')return err('голосование сейчас закрыто',409)
      const questionKey=String(round.question?.key||'question')
      const answer=body.answer
      const encoded=JSON.stringify(answer)
      if(answer===undefined||encoded.length>1200)return err('некорректный ответ',422)
      const vote=await db.from('event_votes').upsert({
        event_id:event.id,
        round_id:round.id,
        question_key:questionKey,
        user_id:user.id,
        answer,
        updated_at:new Date().toISOString()
      },{onConflict:'round_id,question_key,user_id'}).select('answer').single()
      if(vote.error)throw vote.error
      const reward=Math.max(0,Math.min(100,Number(show.program?.rewards?.vote||0)))
      let crumbs:any=null
      if(reward>0){
        const award=await db.rpc('award_event_crumbs',{p_user_id:user.id,p_event_id:event.id,p_amount:reward,p_reason:'vote',p_source_id:`${round.id}:${questionKey}`})
        if(award.error)console.error('vote crumb award failed',award.error)
        else crumbs=award.data
      }
      return json({ok:true,answer:vote.data.answer,crumbs})
    }

    if(action==='invented-film-submit'){
      const reg=await db.from('registrations').select('status').eq('event_id',event.id).eq('user_id',user.id).maybeSingle()
      if(reg.error)throw reg.error
      if(reg.data?.status!=='attended')return err('эта механика только для тех, кто уже отметился в зале',403)
      const runtime=await db.from('event_runtime').select('current_round_id').eq('event_id',event.id).maybeSingle()
      if(runtime.error)throw runtime.error
      const roundId=String(runtime.data?.current_round_id||'')
      if(!isUuid(roundId))return err('сейчас нет активного раунда',409)
      const round=await db.from('event_rounds').select('id,status,flow_status').eq('id',roundId).eq('event_id',event.id).maybeSingle()
      if(round.error)throw round.error
      if(!round.data||round.data.status!=='active'||round.data.flow_status!=='collecting_films')return err('животина сейчас не собирает фильмы',409)
      const title=String(body.title||'').trim().replace(/\s+/g,' ').slice(0,120)
      const description=String(body.description||'').trim().replace(/\s+/g,' ').slice(0,800)
      if(title.length<2)return err('придумайте название фильма',422)
      if(description.length<8)return err('добавьте короткое описание фильма',422)
      const creature=await db.from('creatures').select('name').eq('user_id',user.id).maybeSingle()
      if(creature.error)throw creature.error
      if(!creature.data)return err('сначала разбудите животину',409)
      const saved=await db.from('invented_films').upsert({
        event_id:event.id,round_id:roundId,user_id:user.id,animal_name_snapshot:String(creature.data.name||'животина'),
        title,description,updated_at:new Date().toISOString(),locked_at:null
      },{onConflict:'round_id,user_id'}).select('id,title,description,updated_at').single()
      if(saved.error)throw saved.error
      return json({ok:true,pitch:{id:String(saved.data.id),title:saved.data.title,description:saved.data.description,updatedAt:saved.data.updated_at}})
    }

    if(action==='film-one-word'){
      const reg=await db.from('registrations').select('status').eq('event_id',event.id).eq('user_id',user.id).maybeSingle()
      if(reg.error)throw reg.error
      if(reg.data?.status!=='attended')return err('эта механика только для тех, кто уже отметился в зале',403)
      const projector=await db.from('event_projector_state').select('*').eq('event_id',event.id).single()
      if(projector.error)throw projector.error
      if(projector.data.state!=='one_word_collecting'||!projector.data.round_id||!projector.data.film_package_id)return err('сейчас слово не собираем',409)
      const word=String(body.word||'').trim().slice(0,80)
      const normalized=normalizeFilmWord(word)
      if(!word||!normalized)return err('нужно одно слово',422)
      if(word.split(/\s+/).filter(Boolean).length!==1)return err('ровно одно слово',422)
      const creature=await db.from('creatures').select('name').eq('user_id',user.id).single()
      if(creature.error)throw creature.error
      const saved=await db.from('film_impressions').upsert({
        event_id:event.id,round_id:projector.data.round_id,film_package_id:projector.data.film_package_id,
        user_id:user.id,animal_name_snapshot:creature.data.name,word,normalized_word:normalized,updated_at:new Date().toISOString()
      },{onConflict:'round_id,user_id'}).select('word').single()
      if(saved.error)throw saved.error
      return json({ok:true,word:saved.data.word})
    }

    if(action==='film-prediction'){
      const reg=await db.from('registrations').select('status').eq('event_id',event.id).eq('user_id',user.id).maybeSingle()
      if(reg.error)throw reg.error
      if(reg.data?.status!=='attended')return err('эта механика только для тех, кто уже отметился в зале',403)
      const projector=await db.from('event_projector_state').select('*').eq('event_id',event.id).single()
      if(projector.error)throw projector.error
      const questionId=String(body.questionId||'')
      if(projector.data.state!=='question_open'||!projector.data.round_id||!projector.data.film_package_id||String(projector.data.payload?.questionId||'')!==questionId)return err('этот вопрос сейчас закрыт',409)
      if(!isUuid(questionId))return err('вопрос не найден',404)
      const q=await db.from('film_questions').select('*').eq('id',questionId).eq('film_package_id',projector.data.film_package_id).maybeSingle()
      if(q.error)throw q.error
      if(!q.data)return err('вопрос не найден',404)
      const answer=body.answer
      const encoded=JSON.stringify(answer)
      if(answer===undefined||encoded.length>1000)return err('некорректный ответ',422)
      const options=Array.isArray(q.data.options)?q.data.options:[]
      if(options.length&&!options.some((x:any)=>JSON.stringify(x)===encoded))return err('выберите один из вариантов',422)
      const isCorrect=JSON.stringify(q.data.correct_answer)===encoded
      const creature=await db.from('creatures').select('name').eq('user_id',user.id).single()
      if(creature.error)throw creature.error
      const saved=await db.from('film_predictions').upsert({
        event_id:event.id,round_id:projector.data.round_id,film_package_id:projector.data.film_package_id,
        question_id:questionId,user_id:user.id,animal_name_snapshot:creature.data.name,answer,is_correct:isCorrect,updated_at:new Date().toISOString()
      },{onConflict:'question_id,user_id'}).select('answer,is_correct').single()
      if(saved.error)throw saved.error
      return json({ok:true,answer:saved.data.answer})
    }

    if(action==='film-mark-watching'){
      const assignmentId=String(body.assignmentId||'')
      if(!isUuid(assignmentId))return err('задание не найдено',404)
      const assignment=await db.from('film_assignments').select('status,due_at').eq('id',assignmentId).eq('user_id',user.id).maybeSingle()
      if(assignment.error)throw assignment.error
      if(!assignment.data)return err('задание не найдено',404)
      const current=String(assignment.data.status||'')
      if(!['assigned','watching','overdue'].includes(current))return json({ok:true,status:current})
      const overdue=new Date(assignment.data.due_at).getTime()<Date.now()
      const status=overdue?'overdue':'watching'
      const updated=await db.from('film_assignments').update({status,updated_at:new Date().toISOString()}).eq('id',assignmentId).eq('user_id',user.id)
      if(updated.error)throw updated.error
      return json({ok:true,status})
    }

    if(action==='film-mark-watched'){
      const assignmentId=String(body.assignmentId||'')
      if(!isUuid(assignmentId))return err('задание не найдено',404)
      if(String(body.confirm||'')!=='credits')return err('сначала подтвердите, что досмотрели до титров',422)
      const assignment=await db.from('film_assignments').select('*').eq('id',assignmentId).eq('user_id',user.id).maybeSingle()
      if(assignment.error)throw assignment.error
      if(!assignment.data)return err('задание не найдено',404)
      if(!['assigned','watching','overdue','watched'].includes(String(assignment.data.status)))return err('это задание уже перешло к рецензии',409)
      const watchedAt=assignment.data.watched_at||new Date().toISOString()
      const updated=await db.from('film_assignments').update({status:'watched',watched_at:watchedAt,updated_at:new Date().toISOString()}).eq('id',assignmentId).eq('user_id',user.id).select('*').single()
      if(updated.error)throw updated.error
      await db.from('notification_queue').update({status:'cancelled',error:'film already watched'}).eq('user_id',user.id).eq('status','pending').like('dedupe_key',`film_assignment:${assignmentId}:%`)
      return json({ok:true,status:'watched'})
    }

    if(action==='film-review-start'){
      const assignmentId=String(body.assignmentId||'')
      if(!isUuid(assignmentId))return err('задание не найдено',404)
      const assignment=await db.from('film_assignments').select('*').eq('id',assignmentId).eq('user_id',user.id).maybeSingle()
      if(assignment.error)throw assignment.error
      if(!assignment.data)return err('задание не найдено',404)
      if(!['watched','review_in_progress','review_ready','changes_requested'].includes(String(assignment.data.status)))return err('сначала досмотрите фильм и подтвердите это',409)
      let session=await db.from('review_sessions').select('*').eq('assignment_id',assignmentId).eq('user_id',user.id).maybeSingle()
      if(session.error)throw session.error
      if(!session.data){
        const created=await db.from('review_sessions').insert({assignment_id:assignmentId,user_id:user.id,status:'active',step:0}).select('*').single()
        if(created.error)throw created.error
        session=created
      }
      if(session.data.status==='draft_ready'||assignment.data.status==='review_ready')return json({ok:true,status:'draft_ready',draft:session.data.draft,adminComment:session.data.admin_comment||undefined})
      if(session.data.status==='submitted'&&assignment.data.status!=='changes_requested')return err('рецензия уже отправлена',409)
      const previousDraft=session.data.status==='changes_requested'?session.data.draft:undefined
      if(session.data.status==='changes_requested'){
        const reopened=await db.from('review_sessions').update({status:'active',step:0,updated_at:new Date().toISOString()}).eq('id',session.data.id).select('*').single()
        if(reopened.error)throw reopened.error
        session=reopened
      }
      await db.from('film_assignments').update({status:'review_in_progress',updated_at:new Date().toISOString()}).eq('id',assignmentId).eq('user_id',user.id)
      const nextQuestion=await reviewQuestionForStep(db,assignment.data,Number(session.data.step||0))
      return json({ok:true,status:'active',sessionId:session.data.id,step:Number(session.data.step||0),nextQuestion,answers:session.data.answers||{},messages:Array.isArray(session.data.messages)?session.data.messages:[],adminComment:session.data.admin_comment||undefined,previousDraft})
    }

    if(action==='film-review-answer'){
      const assignmentId=String(body.assignmentId||'')
      if(!isUuid(assignmentId))return err('задание не найдено',404)
      const [assignment,session]=await Promise.all([
        db.from('film_assignments').select('*').eq('id',assignmentId).eq('user_id',user.id).maybeSingle(),
        db.from('review_sessions').select('*').eq('assignment_id',assignmentId).eq('user_id',user.id).maybeSingle()
      ])
      if(assignment.error)throw assignment.error;if(session.error)throw session.error
      if(!assignment.data||!session.data)return err('сессия рецензии не найдена',404)
      if(session.data.status!=='active')return err('разговор сейчас не активен',409)
      const step=Number(session.data.step||0)
      if(step<0||step>7)return err('интервью уже завершено',409)
      const question=await reviewQuestionForStep(db,assignment.data,step)
      let answer:any=body.answer
      if(question.key==='crumbs'){
        const n=Number(answer);if(!Number.isInteger(n)||n<1||n>5)return err('поставьте от 1 до 5 крошек',422);answer=n
      }else{
        answer=String(answer||'').trim().slice(0,1200)
        if(!answer)return err('ответ не может быть пустым',422)
        if(question.key==='after_word'&&answer.split(/\s+/).filter(Boolean).length!==1)return err('нужно одно слово',422)
      }
      const answers={...(session.data.answers||{}),[question.key]:answer}
      const messages=[...(Array.isArray(session.data.messages)?session.data.messages:[]),{role:'assistant',text:question.text},{role:'user',text:String(answer)}].slice(-40)
      if(step<7){
        const updated=await db.from('review_sessions').update({answers,messages,step:step+1,updated_at:new Date().toISOString()}).eq('id',session.data.id).select('*').single()
        if(updated.error)throw updated.error
        const nextQuestion=await reviewQuestionForStep(db,assignment.data,step+1)
        return json({ok:true,status:'active',step:step+1,nextQuestion,answers,messages})
      }
      const draft=await buildReviewDraft(db,assignment.data,answers)
      const completed=await db.from('review_sessions').update({answers,messages,draft,status:'draft_ready',step:8,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',session.data.id).select('id').single()
      if(completed.error)throw completed.error
      const au=await db.from('film_assignments').update({status:'review_ready',after_word:String(answers.after_word||'').slice(0,80),updated_at:new Date().toISOString()}).eq('id',assignmentId).eq('user_id',user.id)
      if(au.error)throw au.error
      return json({ok:true,status:'draft_ready',draft})
    }

    if(action==='film-review-reopen'){
      const assignmentId=String(body.assignmentId||'')
      if(!isUuid(assignmentId))return err('задание не найдено',404)
      const session=await db.from('review_sessions').select('*').eq('assignment_id',assignmentId).eq('user_id',user.id).maybeSingle()
      if(session.error)throw session.error
      if(!session.data||!session.data.draft)return err('черновик не найден',404)
      const updated=await db.from('review_sessions').update({status:'active',step:0,updated_at:new Date().toISOString()}).eq('id',session.data.id)
      if(updated.error)throw updated.error
      await db.from('film_assignments').update({status:'review_in_progress',updated_at:new Date().toISOString()}).eq('id',assignmentId).eq('user_id',user.id)
      return json({ok:true,status:'active'})
    }

    if(action==='film-review-submit'){
      const assignmentId=String(body.assignmentId||'')
      if(!isUuid(assignmentId))return err('задание не найдено',404)
      const [assignment,session]=await Promise.all([
        db.from('film_assignments').select('*').eq('id',assignmentId).eq('user_id',user.id).maybeSingle(),
        db.from('review_sessions').select('*').eq('assignment_id',assignmentId).eq('user_id',user.id).maybeSingle()
      ])
      if(assignment.error)throw assignment.error;if(session.error)throw session.error
      if(!assignment.data||!session.data?.draft)return err('сначала закончите разговор с животинкой',409)
      if(session.data.status!=='draft_ready')return err('сначала откройте preview и подтвердите финальный черновик',409)
      const latest=await db.from('submitted_reviews').select('version').eq('assignment_id',assignmentId).order('version',{ascending:false}).limit(1).maybeSingle()
      if(latest.error)throw latest.error
      const version=Number(latest.data?.version||0)+1
      const inserted=await db.from('submitted_reviews').insert({assignment_id:assignmentId,user_id:user.id,version,snapshot:session.data.draft,status:'submitted'}).select('id,status,submitted_at').single()
      if(inserted.error)throw inserted.error
      const now=new Date().toISOString()
      const [a,u]=await Promise.all([
        db.from('film_assignments').update({status:'submitted',submitted_at:now,updated_at:now}).eq('id',assignmentId).eq('user_id',user.id),
        db.from('review_sessions').update({status:'submitted',updated_at:now}).eq('id',session.data.id)
      ])
      if(a.error)throw a.error;if(u.error)throw u.error
      return json({ok:true,reviewId:inserted.data.id,status:'submitted'})
    }

    if(!adminTokenOk)await mustAdmin(db,user,tg)

    if(action==='admin-round-pitches-open'){
      return await withEventOperation(db,event.id,'round-pitches-open',async()=>{
        const show=await buildShowState(db,event)
        const round=show.currentRound
        if(!round?.id||round.status!=='active')return err('сначала запустите кинораунд',409)
        const now=new Date().toISOString()
        const updated=await db.from('event_rounds').update({
          flow_status:'collecting_films',selected_submission_id:null,movie_candidate_id:null,
          question_position:0,question_target:3,updated_at:now
        }).eq('id',round.id).eq('event_id',event.id)
        if(updated.error)throw updated.error
        await db.from('invented_films').delete().eq('round_id',round.id).eq('event_id',event.id)
        const projector=await setProjectorState(db,event,'pitch_collecting',round.id,null,{prompt:'придумайте фильм, которого не существует'})
        return json({ok:true,projector})
      })
    }

    if(action==='admin-round-pitches-close'){
      return await withEventOperation(db,event.id,'round-pitches-close',async()=>{
        const show=await buildShowState(db,event)
        const round=show.currentRound
        if(!round?.id||round.status!=='active')return err('сейчас нет активного раунда',409)
        if(round.flowStatus!=='collecting_films')return err('сбор фильмов сейчас не открыт',409)
        const pitches=await db.from('invented_films').select('id',{count:'exact'}).eq('round_id',round.id).eq('event_id',event.id)
        if(pitches.error)throw pitches.error
        if(!Number(pitches.count||0))return err('пока никто не отправил фильм',409)
        const now=new Date().toISOString()
        const lock=await db.from('invented_films').update({locked_at:now,updated_at:now}).eq('round_id',round.id).eq('event_id',event.id)
        if(lock.error)throw lock.error
        const updated=await db.from('event_rounds').update({flow_status:'films_locked',updated_at:now}).eq('id',round.id).eq('event_id',event.id)
        if(updated.error)throw updated.error
        const projector=await setProjectorState(db,event,'pitch_locked',round.id,null,{count:Number(pitches.count||0)})
        return json({ok:true,count:Number(pitches.count||0),projector})
      })
    }

    if(action==='admin-round-pitch-draw'){
      return await withEventOperation(db,event.id,'round-pitch-draw',async()=>{
        const show=await buildShowState(db,event)
        const round=show.currentRound
        if(!round?.id||round.status!=='active')return err('сейчас нет активного раунда',409)
        const force=body.force===true
        if(round.selectedSubmissionId&&round.selectedPitch&&!force){
          const projector=await setProjectorState(db,event,'pitch_selected',round.id,null,{pitch:round.selectedPitch})
          return json({ok:true,pitch:round.selectedPitch,projector})
        }
        if(round.flowStatus!=='films_locked'&&!(force&&['submission_selected','movie_found'].includes(String(round.flowStatus||''))))return err('сначала закройте сбор фильмов',409)
        const rows=await db.from('invented_films').select('id,animal_name_snapshot,title,description').eq('round_id',round.id).eq('event_id',event.id).order('created_at')
        if(rows.error)throw rows.error
        const list=(rows.data||[]).filter((x:any)=>!force||String(x.id)!==String(round.selectedSubmissionId||''))
        if(!list.length)return err('других идей в этом раунде нет',409)
        await db.from('event_rounds').update({flow_status:'randomizing_submission',updated_at:new Date().toISOString()}).eq('id',round.id)
        await setProjectorState(db,event,'pitch_randomizing',round.id,null,{count:list.length})
        const {index,randomBytesHex}=secureIndex(list.length)
        const chosen:any=list[index]
        const saved=await db.from('event_rounds').update({selected_submission_id:chosen.id,flow_status:'submission_selected',updated_at:new Date().toISOString()}).eq('id',round.id).eq('event_id',event.id)
        if(saved.error)throw saved.error
        const audit=await db.from('random_draws').insert({event_id:event.id,draw_type:'invented_film_round',candidate_ids:list.map((x:any)=>x.id),chosen_id:chosen.id,random_bytes_hex:randomBytesHex})
        if(audit.error)console.error('invented film draw audit failed',audit.error)
        const pitch={id:String(chosen.id),animalName:String(chosen.animal_name_snapshot),title:String(chosen.title),description:String(chosen.description)}
        const projector=await setProjectorState(db,event,'pitch_selected',round.id,null,{pitch})
        return json({ok:true,pitch,projector})
      },60)
    }

    if(action==='admin-round-find-movie'){
      return await withEventOperation(db,event.id,'round-find-movie',async()=>{
        const show=await buildShowState(db,event)
        const round=show.currentRound
        if(!round?.id||!round.selectedSubmissionId)return err('сначала выберите идею',409)
        if(!['submission_selected','searching_movie','movie_found'].includes(String(round.flowStatus||'')))return err('поиск фильма сейчас недоступен',409)
        const pitch=await db.from('invented_films').select('*').eq('id',round.selectedSubmissionId).eq('round_id',round.id).eq('event_id',event.id).maybeSingle()
        if(pitch.error)throw pitch.error
        if(!pitch.data)return err('идея не найдена',404)
        await db.from('event_rounds').update({flow_status:'searching_movie',updated_at:new Date().toISOString()}).eq('id',round.id)
        await setProjectorState(db,event,'movie_searching',round.id,null,{pitch:{animalName:pitch.data.animal_name_snapshot,title:pitch.data.title,description:pitch.data.description}})
        const regs=await db.from('registrations').select('user_id').eq('event_id',event.id).eq('status','attended')
        if(regs.error)throw regs.error
        const userIds=(regs.data||[]).map((x:any)=>x.user_id)
        const profiles=userIds.length?await db.from('cinema_profiles').select('favorite_films,favorite_genres,avoid,profile_json').in('user_id',userIds):{data:[],error:null} as any
        if(profiles.error)throw profiles.error
        const schema={type:'object',additionalProperties:false,properties:{
          analysis:{type:'object',additionalProperties:false,properties:{
            genre:{type:'string'},plot:{type:'string'},protagonist:{type:'string'},setting:{type:'string'},
            conflict:{type:'string'},keyIdea:{type:'string'},mood:{type:'string'},twist:{type:'string'}
          },required:['genre','plot','protagonist','setting','conflict','keyIdea','mood','twist']},
          candidates:{type:'array',minItems:8,maxItems:12,items:{type:'object',additionalProperties:false,properties:{
            title:{type:'string'},originalTitle:{type:'string'},year:{type:['integer','null']},
            similarityScore:{type:'number',minimum:0,maximum:100},audienceFitScore:{type:'number',minimum:0,maximum:100},reason:{type:'string'}
          },required:['title','originalTitle','year','similarityScore','audienceFitScore','reason']}}
        },required:['analysis','candidates']}
        const ai=await structuredResponse<any>({
          name:'round_movie_match',schema,instructions:JIPITINA,
          input:`разбери придуманную зрителем идею и предложи только реально существующие полнометражные фильмы для внешней проверки. сходство с идеей важнее популярности. ничего не выдумывай. идея: ${JSON.stringify({title:pitch.data.title,description:pitch.data.description})}. агрегированный вкус зала: ${JSON.stringify(profiles.data||[])}`,
          maxOutputTokens:3200,model:Deno.env.get('OPENAI_FILM_MODEL')||'gpt-5.6-terra'
        })
        const validated:any[]=[]
        for(const c of ai.candidates||[]){
          if(validated.length>=8)break
          const v=await validateMovieTitle(c.originalTitle||c.title,c.year||undefined)
          if(!v?.runtimeMin||v.runtimeMin>event.max_movie_runtime_min)continue
          validated.push({...c,...v,runtimeMin:v.runtimeMin})
        }
        if(!validated.length){
          await db.from('event_rounds').update({flow_status:'movie_found',movie_candidate_id:null,updated_at:new Date().toISOString()}).eq('id',round.id)
          const projector=await setProjectorState(db,event,'movie_found',round.id,null,{found:false,message:'кажется, это пока не сняли.'})
          return json({ok:true,found:false,projector})
        }
        const inserted:any[]=[]
        for(const c of validated){
          const row=await db.from('movie_candidates').insert({
            event_id:event.id,provider:'wikidata',provider_id:c.wikidataId,title:c.title,original_title:c.originalTitle||c.title,
            year:c.year||null,runtime_min:c.runtimeMin||null,validated:true,similarity_score:c.similarityScore,
            audience_fit_score:c.audienceFitScore,reason:c.reason,
            metadata:{wikidata_url:c.url,description:c.description,round_id:round.id,origin_submission_id:pitch.data.id}
          }).select('*').single()
          if(row.error)throw row.error
          inserted.push(row.data)
        }
        const ranked=inserted.sort((a:any,b:any)=>Number(b.similarity_score||0)-Number(a.similarity_score||0)||Number(b.audience_fit_score||0)-Number(a.audience_fit_score||0))
        let chosen:any=null,preferred:any=null
        const sourceSearch:any[]=[]
        for(const movie of ranked){
          try{
            const resolved=await discoverAndPersistMovieSources(db,event,movie)
            sourceSearch.push({movieId:movie.id,title:movie.title,found:(resolved.discovery.candidates||[]).length,preferred:resolved.preferred})
            if(resolved.preferred){chosen=movie;preferred=resolved.preferred;break}
          }catch(e:any){sourceSearch.push({movieId:movie.id,title:movie.title,error:String(e?.message||e)})}
        }
        if(!chosen||!preferred){
          await db.from('event_rounds').update({flow_status:'movie_found',movie_candidate_id:null,updated_at:new Date().toISOString()}).eq('id',round.id)
          const projector=await setProjectorState(db,event,'movie_found',round.id,null,{found:false,message:'кажется, это пока не сняли.'})
          return json({ok:true,found:false,sourceSearch,projector})
        }
        const fragment={label:'первый фрагмент',sourcePlatform:preferred.sourcePlatform,videoId:preferred.videoId||'',sourceUrl:preferred.sourceUrl||'',startSec:Number(preferred.startSec||0),endSec:preferred.endSec==null?Number(preferred.startSec||0)+90:Number(preferred.endSec)}
        const pack=await db.from('film_packages').insert({
          event_id:event.id,movie_candidate_id:chosen.id,title_snapshot:chosen.title,fragments:[fragment],status:'draft',
          origin_submission_id:pitch.data.id,match_data:{analysis:ai.analysis,alternatives:ranked.slice(0,5).map((x:any)=>({id:x.id,title:x.title,year:x.year,similarityScore:x.similarity_score,reason:x.reason}))}
        }).select('*').single()
        if(pack.error)throw pack.error
        const now=new Date().toISOString()
        const ru=await db.from('event_rounds').update({movie_candidate_id:chosen.id,flow_status:'movie_found',updated_at:now}).eq('id',round.id).eq('event_id',event.id)
        if(ru.error)throw ru.error
        const runtime=await db.from('event_runtime').select('revision').eq('event_id',event.id).maybeSingle()
        if(runtime.error)throw runtime.error
        if(runtime.data){
          const up=await db.from('event_runtime').update({current_movie_id:chosen.id,revision:Number(runtime.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',runtime.data.revision)
          if(up.error)throw up.error
        }
        const projector=await setProjectorState(db,event,'movie_found',round.id,pack.data.id,{found:true,filmTitle:chosen.title,year:chosen.year,reason:chosen.reason,fragment})
        return json({ok:true,found:true,movie:{id:chosen.id,title:chosen.title,year:chosen.year,reason:chosen.reason},filmPackageId:pack.data.id,sourceSearch,projector})
      },600)
    }

    if(action==='admin-round-question-generate'){
      return await withEventOperation(db,event.id,'round-question-generate',async()=>{
        const show=await buildShowState(db,event)
        const round=show.currentRound
        if(!round?.id||!round.movie?.id)return err('сначала найдите фильм',409)
        if(!['movie_found','playing_clip','question_reveal','next_question','generating_question'].includes(String(round.flowStatus||'')))return err('сейчас вопрос создавать рано',409)
        const pack=await db.from('film_packages').select('*').eq('event_id',event.id).eq('movie_candidate_id',round.movie.id).maybeSingle()
        if(pack.error)throw pack.error
        if(!pack.data)return err('киноблок не найден',404)
        const existing=await db.from('film_questions').select('id,position').eq('film_package_id',pack.data.id).order('position')
        if(existing.error)throw existing.error
        const target=Math.max(1,Math.min(5,Number(round.questionTarget||3)))
        const position=(existing.data||[]).length+1
        if(position>target)return err('все вопросы этого раунда уже готовы',409)
        const realOutcome=String(body.realOutcome||'').trim().slice(0,1200)
        const verificationSource=String(body.verificationSource||'').trim().slice(0,1500)
        if(realOutcome.length<8)return err('нужно описать проверенное продолжение',422)
        if(verificationSource.length<4)return err('нужен источник подтверждения',422)
        const fragments=Array.isArray(pack.data.fragments)?pack.data.fragments:[]
        const source:any=fragments[0]||{}
        const revealStartSec=Math.max(0,Math.round(Number(body.revealStartSec)||0))
        const revealEndSec=Math.max(0,Math.round(Number(body.revealEndSec)||0))
        if(revealEndSec<=revealStartSec)return err('для reveal укажите корректные start/end секунды',422)
        if(!source.videoId&&!source.sourceUrl)return err('у фильма нет воспроизводимого источника',409)
        await db.from('event_rounds').update({flow_status:'generating_question',updated_at:new Date().toISOString()}).eq('id',round.id)
        const schema={type:'object',additionalProperties:false,properties:{
          prompt:{type:'string'},options:{type:'array',minItems:4,maxItems:4,items:{type:'string'}},correctAnswer:{type:'string'}
        },required:['prompt','options','correctAnswer']}
        const ai=await structuredResponse<any>({
          name:'verified_next_question',schema,
          instructions:'сформулируй один короткий вопрос «что будет дальше?» и четыре правдоподобных варианта. правильный вариант обязан буквально соответствовать переданному проверенному продолжению. не добавляй фактов, которых нет в проверенном продолжении. без markdown.',
          input:JSON.stringify({filmTitle:pack.data.title_snapshot,position,realOutcome}),
          maxOutputTokens:500,reasoningEffort:'none'
        })
        const options=(Array.isArray(ai.options)?ai.options:[]).map((x:any)=>String(x).trim()).filter(Boolean).slice(0,4)
        const correctAnswer=String(ai.correctAnswer||'').trim()
        if(options.length!==4||!options.includes(correctAnswer))return err('не удалось собрать проверяемый вопрос. попробуйте ещё раз',422)
        const revealFragment={...source,label:'правильный ответ',startSec:revealStartSec,endSec:revealEndSec}
        const saved=await db.from('film_questions').insert({
          film_package_id:pack.data.id,position,prompt:String(ai.prompt||'что будет дальше?').trim().slice(0,500),
          options,correct_answer:correctAnswer,reveal_text:realOutcome,reveal_fragment:revealFragment,
          real_outcome:realOutcome,verification_data:{source:verificationSource,revealFragment}
        }).select('*').single()
        if(saved.error)throw saved.error
        const ready=position>=target
        const pu=await db.from('film_packages').update({status:ready?'ready':'draft',updated_at:new Date().toISOString()}).eq('id',pack.data.id)
        if(pu.error)throw pu.error
        const ru=await db.from('event_rounds').update({flow_status:'next_question',question_position:position,updated_at:new Date().toISOString()}).eq('id',round.id)
        if(ru.error)throw ru.error
        return json({ok:true,question:{id:saved.data.id,position,prompt:saved.data.prompt,options:saved.data.options,correctAnswer:saved.data.correct_answer},ready})
      },180)
    }

    if(action==='admin-film-package-save'){
      const movieCandidateId=String(body.movieCandidateId||'')
      if(!isUuid(movieCandidateId))return err('выберите фильм',422)
      const movie=await db.from('movie_candidates').select('id,title').eq('id',movieCandidateId).eq('event_id',event.id).maybeSingle()
      if(movie.error)throw movie.error
      if(!movie.data)return err('фильм не найден в каталоге этого события',404)
      const fragments=(Array.isArray(body.fragments)?body.fragments:[]).slice(0,6).map((f:any,index:number)=>({
        index,
        label:String(f?.label||`фрагмент ${index+1}`).slice(0,80),
        sourcePlatform:String(f?.sourcePlatform||((f?.videoId)?'youtube':'')).trim().slice(0,80),
        videoId:String(f?.videoId||'').trim().slice(0,120),
        sourceUrl:String(f?.sourceUrl||'').trim().slice(0,1000),
        startSec:Math.max(0,Math.round(Number(f?.startSec)||0)),
        endSec:f?.endSec===null||f?.endSec===undefined||f?.endSec===''?null:Math.max(0,Math.round(Number(f.endSec)||0))
      }))
      if(fragments.length!==6)return err('для готового киноблока нужно ровно 6 фрагментов',422)
      if(fragments.some((f:any)=>{
        const playable=(f.sourcePlatform==='youtube'&&!!f.videoId)||(['internet_archive','wikimedia_commons','direct'].includes(f.sourcePlatform)&&!!f.sourceUrl)
        return !playable||f.endSec===null||f.endSec<=f.startSec
      }))return err('у каждого фрагмента нужен youtube video id или прямой video url и корректные start/end',422)
      const incomingQuestions=Array.isArray(body.questions)?body.questions:[]
      if(incomingQuestions.length!==5)return err('для готового киноблока нужно ровно 5 вопросов',422)
      const questions=incomingQuestions.map((q:any,index:number)=>({
        position:index+1,prompt:String(q?.prompt||'').trim().slice(0,500),
        options:(Array.isArray(q?.options)?q.options:[]).map((x:any)=>String(x).trim()).filter(Boolean).slice(0,8),
        correct_answer:q?.correctAnswer,reveal_text:String(q?.revealText||'').trim().slice(0,1000),
        reveal_fragment:q?.revealFragment&&typeof q.revealFragment==='object'?q.revealFragment:{}
      }))
      if(questions.some((q:any)=>!q.prompt||q.options.length<2||q.correct_answer===undefined))return err('у каждого вопроса нужны текст, минимум 2 варианта и правильный ответ',422)
      const pack=await db.from('film_packages').upsert({
        event_id:event.id,movie_candidate_id:movieCandidateId,title_snapshot:movie.data.title,fragments,status:'ready',updated_at:new Date().toISOString()
      },{onConflict:'event_id,movie_candidate_id'}).select('*').single()
      if(pack.error)throw pack.error
      const rows=questions.map((q:any)=>({film_package_id:pack.data.id,...q,updated_at:new Date().toISOString()}))
      const qs=await db.from('film_questions').upsert(rows,{onConflict:'film_package_id,position'}).select('id,position')
      if(qs.error)throw qs.error
      return json({ok:true,packageId:pack.data.id,questions:qs.data})
    }

    if(action==='admin-film-projector'){
      const packageId=String(body.filmPackageId||'')
      const roundId=String(body.roundId||'')
      const op=String(body.op||'')
      if(!isUuid(packageId)||!isUuid(roundId))return err('не выбран фильм или раунд',422)
      const [pack,round,current]=await Promise.all([
        db.from('film_packages').select('*').eq('id',packageId).eq('event_id',event.id).maybeSingle(),
        db.from('event_rounds').select('id,movie_candidate_id,question_target').eq('id',roundId).eq('event_id',event.id).maybeSingle(),
        db.from('event_projector_state').select('revision').eq('event_id',event.id).maybeSingle()
      ])
      if(pack.error)throw pack.error;if(round.error)throw round.error;if(current.error)throw current.error
      if(!pack.data||!round.data)return err('киноблок не найден',404)
      if(String(round.data.movie_candidate_id||'')!==String(pack.data.movie_candidate_id))return err('этот пакет не соответствует фильму текущего раунда',409)
      let state='film_intro',payload:any={filmTitle:pack.data.title_snapshot}
      if(op==='film_intro'){
        state='film_intro';payload={filmTitle:pack.data.title_snapshot,fragment:(Array.isArray(pack.data.fragments)?pack.data.fragments:[])[0]||null}
      }else if(op==='one_word_open'){
        state='one_word_collecting';payload={filmTitle:pack.data.title_snapshot,prompt:'одно слово. что это за фильм?'}
      }else if(op==='one_word_results'){
        const impressions=await db.from('film_impressions').select('word,normalized_word').eq('event_id',event.id).eq('round_id',roundId).eq('film_package_id',packageId)
        if(impressions.error)throw impressions.error
        const groups=new Map<string,{word:string;count:number}>()
        for(const x of impressions.data||[]){const key=String(x.normalized_word||'');if(!key)continue;const current=groups.get(key)||{word:String(x.word||key),count:0};current.count++;groups.set(key,current)}
        const collectiveWords=[...groups.values()].sort((a,b)=>b.count-a.count||a.word.localeCompare(b.word,'ru')).slice(0,5)
        state='one_word_results';payload={filmTitle:pack.data.title_snapshot,collectiveWords}
      }else if(op==='question_open'||op==='question_results'||op==='question_reveal'){
        const position=Math.max(1,Math.min(5,Number(body.position)||1))
        const q=await db.from('film_questions').select('*').eq('film_package_id',packageId).eq('position',position).maybeSingle()
        if(q.error)throw q.error
        if(!q.data)return err('вопрос не найден',404)
        if(op==='question_open'){
          state='question_open';payload={filmTitle:pack.data.title_snapshot,questionId:q.data.id,position,totalQuestions:Number(round.data.question_target||3),prompt:q.data.prompt,options:q.data.options}
        }else if(op==='question_results'){
          const answers=await db.from('film_predictions').select('answer').eq('event_id',event.id).eq('round_id',roundId).eq('film_package_id',packageId).eq('question_id',q.data.id)
          if(answers.error)throw answers.error
          const counts=new Map<string,{answer:any;count:number}>()
          for(const x of answers.data||[]){const key=JSON.stringify(x.answer);const cur=counts.get(key)||{answer:x.answer,count:0};cur.count++;counts.set(key,cur)}
          state='question_results';payload={filmTitle:pack.data.title_snapshot,questionId:q.data.id,position,totalQuestions:Number(round.data.question_target||3),prompt:q.data.prompt,results:[...counts.values()].sort((a,b)=>b.count-a.count)}
        }else{
          state='question_reveal';payload={filmTitle:pack.data.title_snapshot,questionId:q.data.id,position,totalQuestions:Number(round.data.question_target||3),prompt:q.data.prompt,correctAnswer:q.data.correct_answer,revealText:q.data.reveal_text,revealFragment:q.data.reveal_fragment}
        }
      }else if(op==='assignment_randomizing'){
        state='assignment_randomizing';payload={filmTitle:pack.data.title_snapshot}
      }else return err('неизвестное состояние projector',422)
      const flowPatch:any={updated_at:new Date().toISOString()}
      if(op==='film_intro')flowPatch.flow_status='playing_clip'
      else if(op==='question_open'){flowPatch.flow_status='question_open';flowPatch.question_position=Math.max(1,Math.min(5,Number(body.position)||1))}
      else if(op==='question_results')flowPatch.flow_status='question_results'
      else if(op==='question_reveal')flowPatch.flow_status='question_reveal'
      else if(op==='assignment_randomizing')flowPatch.flow_status='assignment_randomizing'
      if(Object.keys(flowPatch).length>1){
        const flow=await db.from('event_rounds').update(flowPatch).eq('id',roundId).eq('event_id',event.id)
        if(flow.error)throw flow.error
      }
      const revision=Number(current.data?.revision||0)+1
      const saved=await db.from('event_projector_state').upsert({event_id:event.id,state,film_package_id:packageId,round_id:roundId,payload,revision,updated_at:new Date().toISOString()},{onConflict:'event_id'}).select('*').single()
      if(saved.error)throw saved.error
      return json({ok:true,projector:await projectorPublicState(db,event)})
    }

    if(action==='admin-film-assign'){
      const packageId=String(body.filmPackageId||'')
      const roundId=String(body.roundId||'')
      if(!isUuid(packageId)||!isUuid(roundId))return err('не выбран фильм или раунд',422)
      const pack=await db.from('film_packages').select('id,title_snapshot').eq('id',packageId).eq('event_id',event.id).maybeSingle()
      if(pack.error)throw pack.error
      if(!pack.data)return err('киноблок не найден',404)
      const assignment=await db.rpc('assign_film_mission',{p_event_id:event.id,p_round_id:roundId,p_film_package_id:packageId})
      if(assignment.error){
        const m=String(assignment.error.message||'')
        if(m.includes('no eligible animal'))return err('нет присутствующей животинки для назначения',409)
        if(m.includes('between 1 and 5 questions'))return err('в раунде должен быть хотя бы один проверенный вопрос',409)
        throw assignment.error
      }
      const winner=assignment.data?.[0]
      if(!winner)return err('не удалось выбрать животинку',500)
      const current=await db.from('event_projector_state').select('revision').eq('event_id',event.id).maybeSingle()
      if(current.error)throw current.error
      const projector=await db.from('event_projector_state').upsert({
        event_id:event.id,state:'assignment_winner',film_package_id:packageId,round_id:roundId,
        payload:{animalName:winner.animal_name,filmTitle:pack.data.title_snapshot,dueAt:winner.due_at},
        revision:Number(current.data?.revision||0)+1,updated_at:new Date().toISOString()
      },{onConflict:'event_id'})
      if(projector.error)throw projector.error
      const flow=await db.from('event_rounds').update({flow_status:'assignment_selected',updated_at:new Date().toISOString()}).eq('id',roundId).eq('event_id',event.id)
      if(flow.error)throw flow.error
      return json({ok:true,assignment:{animalName:winner.animal_name,filmTitle:pack.data.title_snapshot,dueAt:winner.due_at},projector:await projectorPublicState(db,event)})
    }

    if(action==='admin-project-review'){
      const reviewId=String(body.reviewId||'')
      if(!isUuid(reviewId))return err('рецензия не найдена',404)
      const review=await db.from('submitted_reviews').select('*').eq('id',reviewId).maybeSingle()
      if(review.error)throw review.error
      if(!review.data||!['approved','published'].includes(String(review.data.status||'')))return err('на экран можно вернуть только одобренную или опубликованную рецензию',409)
      const assignment=await db.from('film_assignments').select('*').eq('id',review.data.assignment_id).maybeSingle()
      if(assignment.error)throw assignment.error
      if(!assignment.data)return err('назначение не найдено',404)
      const pack=await db.from('film_packages').select('title_snapshot').eq('id',assignment.data.film_package_id).maybeSingle()
      if(pack.error)throw pack.error
      const snapshot:any=review.data.snapshot||{}
      const current=await db.from('event_projector_state').select('revision').eq('event_id',event.id).maybeSingle()
      if(current.error)throw current.error
      const payload={
        animalName:String(assignment.data.animal_name_snapshot||snapshot.animalName||'животина'),
        filmTitle:String(pack.data?.title_snapshot||snapshot.filmTitle||'фильм'),
        beforeWord:String(snapshot.beforeWord||assignment.data.before_word||''),
        afterWord:String(snapshot.afterWord||assignment.data.after_word||''),
        crumbs:Number(snapshot.crumbs||0),
        animalTake:String(snapshot.animalTake||''),
        publishText:String(snapshot.publishText||'')
      }
      const saved=await db.from('event_projector_state').upsert({
        event_id:event.id,state:'past_review_card',film_package_id:null,round_id:null,payload,
        revision:Number(current.data?.revision||0)+1,updated_at:new Date().toISOString()
      },{onConflict:'event_id'})
      if(saved.error)throw saved.error
      return json({ok:true,projector:await projectorPublicState(db,event)})
    }

    if(action==='admin-review-action'){
      const reviewId=String(body.reviewId||'')
      const op=String(body.op||'')
      if(!isUuid(reviewId)||!['approve','changes_requested','publish'].includes(op))return err('неизвестное действие рецензии',422)
      const review=await db.from('submitted_reviews').select('*').eq('id',reviewId).maybeSingle()
      if(review.error)throw review.error
      if(!review.data)return err('рецензия не найдена',404)
      const assignment=await db.from('film_assignments').select('*').eq('id',review.data.assignment_id).eq('event_id',event.id).maybeSingle()
      if(assignment.error)throw assignment.error
      if(!assignment.data)return err('рецензия относится к другому событию',403)
      const now=new Date().toISOString()
      if(op==='approve'){
        const a=await db.from('submitted_reviews').update({status:'approved',approved_at:now,admin_comment:null}).eq('id',reviewId)
        const b=await db.from('film_assignments').update({status:'approved',approved_at:now,updated_at:now}).eq('id',assignment.data.id)
        if(a.error)throw a.error;if(b.error)throw b.error
      }else if(op==='publish'){
        if(review.data.status!=='approved')return err('сначала одобрите рецензию',409)
        const a=await db.from('submitted_reviews').update({status:'published',published_at:now}).eq('id',reviewId)
        const b=await db.from('film_assignments').update({status:'published',published_at:now,updated_at:now}).eq('id',assignment.data.id)
        if(a.error)throw a.error;if(b.error)throw b.error
      }else{
        const comment=String(body.comment||'').trim().slice(0,1000)
        if(!comment)return err('напишите, что нужно уточнить',422)
        const a=await db.from('submitted_reviews').update({status:'changes_requested',admin_comment:comment}).eq('id',reviewId)
        const b=await db.from('film_assignments').update({status:'changes_requested',updated_at:now}).eq('id',assignment.data.id)
        const c=await db.from('review_sessions').update({status:'changes_requested',admin_comment:comment,updated_at:now}).eq('assignment_id',assignment.data.id)
        if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error
        const notice=await db.from('notification_queue').upsert({
          user_id:assignment.data.user_id,kind:'reminders',text:'взрослым что-то не понравилось. надо уточнить.',send_after:now,status:'pending',
          dedupe_key:`film_assignment:${assignment.data.id}:changes_${review.data.version}`,event_id:event.id
        },{onConflict:'user_id,dedupe_key'})
        if(notice.error)console.error('review changes notification failed',notice.error)
      }
      return json({ok:true,reviewQueue:await filmAdminReviews(db,event.id)})
    }

    if(action==='admin-event-preflight'){
      const [programR,runtimeR,projectorR,packagesR,questionsR,moviesR,sourcesR,registrationsR,telegram] = await Promise.all([
        db.from('event_programs').select('config').eq('event_id',event.id).maybeSingle(),
        db.from('event_runtime').select('run_status,current_block_id,current_block_index,revision').eq('event_id',event.id).maybeSingle(),
        db.from('event_projector_state').select('state,revision,updated_at').eq('event_id',event.id).maybeSingle(),
        db.from('film_packages').select('id,movie_candidate_id,title_snapshot,fragments,status').eq('event_id',event.id),
        db.from('film_questions').select('id,film_package_id,position'),
        db.from('movie_candidates').select('id,title,enabled_for_event,source_url').eq('event_id',event.id),
        db.from('movie_source_candidates').select('movie_candidate_id,availability_status,verified,embeddable,rights_status,metadata').eq('event_id',event.id),
        db.from('registrations').select('status').eq('event_id',event.id),
        telegramRuntimeReady()
      ])
      for(const r of [programR,runtimeR,projectorR,packagesR,questionsR,moviesR,sourcesR,registrationsR])if((r as any).error)throw (r as any).error

      const checks:any[]=[]
      const add=(key:string,label:string,status:'pass'|'warn'|'fail'|'info',detail:string)=>checks.push({key,label,status,detail})
      const screenConfigured=!!String(Deno.env.get('SCREEN_ACCESS_TOKEN')||'').trim()&&!!String(Deno.env.get('TELEGRAM_WEBAPP_URL')||'').trim()
      add('screen','экран / проектор',screenConfigured?'pass':'fail',screenConfigured?'доступ к большому экрану настроен':'не настроен закрытый доступ к большому экрану')
      add('telegram','telegram',telegram?'pass':'fail',telegram?'бот и связь с приложением работают':'бот или связь с приложением не прошли проверку')

      const blocks=Array.isArray(programR.data?.config?.blocks)?programR.data.config.blocks.filter((x:any)=>x?.enabled!==false):[]
      const requiredTypes=['arrival','onboarding','warm_up','cinema_rounds','music_live','final_vote','finale']
      const missingTypes=requiredTypes.filter(type=>!blocks.some((x:any)=>String(x?.type)===type))
      const duration=blocks.reduce((sum:number,x:any)=>sum+Math.max(0,Number(x?.duration_min||0)),0)
      add('program','программа вечера',blocks.length&&missingTypes.length===0?'pass':'fail',
        blocks.length?(`${blocks.length} блоков · ${duration} мин${missingTypes.length?' · нет: '+missingTypes.join(', '):''}`):'программа пустая')
      add('runtime','состояние мероприятия',runtimeR.data?'pass':'fail',runtimeR.data?`режим: ${runtimeR.data.run_status} · текущий блок: ${runtimeR.data.current_block_id}`:'состояние мероприятия не создано')
      add('projector_state','что сейчас на экране',projectorR.data?'pass':'fail',projectorR.data?`режим экрана: ${projectorR.data.state}`:'состояние большого экрана не создано')

      const packages=packagesR.data||[]
      const questions=questionsR.data||[]
      const enabledMovies=(moviesR.data||[]).filter((x:any)=>x.enabled_for_event!==false)
      const qCount=new Map<string,number>()
      for(const q of questions)qCount.set(String(q.film_package_id),(qCount.get(String(q.film_package_id))||0)+1)
      const brokenPackages=packages.filter((p:any)=>{
        const fragments=Array.isArray(p.fragments)?p.fragments:[]
        if(!fragments.length)return true
        const first:any=fragments[0]||{}
        const platform=String(first?.sourcePlatform||((first?.videoId)?'youtube':''))
        const playable=(platform==='youtube'&&!!String(first?.videoId||'').trim())||(['internet_archive','wikimedia_commons','direct'].includes(platform)&&!!String(first?.sourceUrl||'').trim())
        const count=qCount.get(String(p.id))||0
        return !playable||count>5
      })
      add('film_packages','кинопакеты',brokenPackages.length?'warn':'pass',
        packages.length?packages.length+' создано по ходу шоу'+(brokenPackages.length?' · проверить: '+brokenPackages.length:''):'заранее готовить фильмы больше не нужно · пакеты создаются из идей гостей во время раунда')
      add('video_sources','поиск видео','pass',
        'источник ищется после выбора идеи. если у лучшего совпадения нет воспроизводимого фрагмента, система перебирает следующие подтверждённые фильмы')

      const venueName=String(event.venue_name||'').trim()
      const venueAddress=String(event.venue_address||'').trim()
      add('venue','площадка',venueName&&venueAddress?'pass':'fail',venueName&&venueAddress?`${venueName} · ${venueAddress}`:'не заполнено название или адрес площадки')
      add('room','внутренний зал','warn','система знает общий адрес, но конкретный зал/строение нужно подтвердить вручную на площадке')

      const regs=registrationsR.data||[]
      const confirmed=regs.filter((x:any)=>['paid','attended'].includes(String(x.status))).length
      const attended=regs.filter((x:any)=>String(x.status)==='attended').length
      const waitlist=regs.filter((x:any)=>String(x.status)==='waitlist').length
      add('attendance','участники','info',`подтвердили: ${confirmed} · пришли: ${attended} · ждут: ${waitlist} · всего мест: ${event.capacity}`)

      const failed=checks.filter(x=>x.status==='fail').length
      const warnings=checks.filter(x=>x.status==='warn').length
      const passed=checks.filter(x=>x.status==='pass').length
      return json({ok:true,ready:failed===0,summary:{passed,warnings,failed,total:checks.length},checks,checkedAt:new Date().toISOString()})
    }

    if(action==='admin-screen-link'){
      const screenToken=String(Deno.env.get('SCREEN_ACCESS_TOKEN')||'').trim()
      const webAppUrl=String(Deno.env.get('TELEGRAM_WEBAPP_URL')||'').trim().replace(/\/+$/,'')
      if(!screenToken||!webAppUrl)return err('Экран проектора не настроен',503)
      return json({ok:true,screenUrl:`${webAppUrl}/#/screen/event/${event.slug}?token=${encodeURIComponent(screenToken)}`})
    }

    if(action==='admin-program-save'){
      const blocks=sanitizeProgramBlocks(body.blocks)
      if(!blocks||blocks.length<1)return err('добавьте хотя бы один блок программы',422)
      const roundsTarget=Math.max(1,Math.min(20,Math.round(Number(body.roundsTarget||7)||7)))
      const rewardInput=body.rewards||{}
      const rewards={
        join:Math.max(0,Math.min(100,Math.round(Number(rewardInput.join??1)||0))),
        vote:Math.max(0,Math.min(100,Math.round(Number(rewardInput.vote??1)||0))),
        round:Math.max(0,Math.min(100,Math.round(Number(rewardInput.round??2)||0))),
        finale:Math.max(0,Math.min(100,Math.round(Number(rewardInput.finale??3)||0)))
      }
      const config={version:1,rounds_target:roundsTarget,rewards,blocks}
      const saved=await db.from('event_programs').upsert({event_id:event.id,config,updated_at:new Date().toISOString()},{onConflict:'event_id'})
      if(saved.error)throw saved.error
      const runtime=await db.from('event_runtime').select('*').eq('event_id',event.id).single()
      if(runtime.error)throw runtime.error
      if(!blocks.some((x:any)=>x.id===runtime.data.current_block_id)){
        const first=blocks[0]
        const u=await db.from('event_runtime').update({
          current_block_id:first.id,current_block_index:0,current_round_id:null,current_movie_id:null,current_question:null,
          vote_state:'closed',results_visible:false,video_state:{status:'idle'},revision:Number(runtime.data.revision||0)+1,updated_at:new Date().toISOString()
        }).eq('event_id',event.id).eq('revision',runtime.data.revision).select('event_id').maybeSingle()
        if(u.error)throw u.error
        if(!u.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
      }
      return json({ok:true,show:await buildShowState(db,event)})
    }

    if(action==='admin-show-control'){
      const op=String(body.op||'').trim()
      const allowed=new Set(['start','next','back','jump','pause','resume','restart','skip','start_music','end_music','end_event'])
      if(!allowed.has(op))return err('неизвестная команда пульта',422)
      return await withEventOperation(db,event.id,'show-control',async()=>{
        const [programR,runtimeR]=await Promise.all([
          db.from('event_programs').select('config').eq('event_id',event.id).single(),
          db.from('event_runtime').select('*').eq('event_id',event.id).single()
        ])
        if(programR.error)throw programR.error
        if(runtimeR.error)throw runtimeR.error
        const blocks=sanitizeProgramBlocks(programR.data.config?.blocks)||[]
        if(!blocks.length)return err('программа вечера пустая',409)
        const from=runtimeR.data
        let idx=Math.max(0,Math.min(blocks.length-1,Number(from.current_block_index||0)))
        let runStatus=String(from.run_status||'idle')
        let blockStartedAt=from.block_started_at
        let startedAt=from.started_at
        let pausedAt=from.paused_at
        let resetRound=false
        const now=new Date().toISOString()

        if(op==='start'){
          if(event.status==='DRAFT')return err('сначала откройте регистрацию',409)
          idx=0;runStatus='running';startedAt=startedAt||now;blockStartedAt=now;pausedAt=null;resetRound=true
        }else if(op==='next'||op==='skip'){
          if(idx>=blocks.length-1){idx=blocks.length-1;runStatus='finished'}else{idx+=1;runStatus='running'}
          blockStartedAt=now;pausedAt=null;resetRound=true
        }else if(op==='back'){
          idx=Math.max(0,idx-1);runStatus='running';blockStartedAt=now;pausedAt=null;resetRound=true
        }else if(op==='jump'){
          const wanted=String(body.blockId||'')
          const found=blocks.findIndex((x:any)=>x.id===wanted)
          if(found<0)return err('блок не найден в программе',404)
          idx=found;runStatus='running';blockStartedAt=now;pausedAt=null;resetRound=true
        }else if(op==='start_music'){
          const found=blocks.findIndex((x:any)=>x.type==='music_live')
          if(found<0)return err('в программе нет музыкального блока',409)
          idx=found;runStatus='running';blockStartedAt=now;pausedAt=null;resetRound=true
        }else if(op==='end_music'){
          const musicIndex=blocks.findIndex((x:any)=>x.id===from.current_block_id&&x.type==='music_live')
          if(musicIndex<0)return err('сейчас не музыкальный блок',409)
          idx=Math.min(blocks.length-1,musicIndex+1);runStatus='running';blockStartedAt=now;pausedAt=null;resetRound=true
        }else if(op==='pause'){
          if(runStatus!=='running')return err('шоу сейчас не запущено',409)
          runStatus='paused';pausedAt=now
        }else if(op==='resume'){
          if(runStatus!=='paused')return err('шоу не стоит на паузе',409)
          runStatus='running';pausedAt=null
        }else if(op==='restart'){
          blockStartedAt=now;runStatus='running';pausedAt=null;resetRound=true
        }else if(op==='end_event'){
          const post=blocks.findIndex((x:any)=>x.type==='post_event')
          idx=post>=0?post:blocks.length-1;runStatus='finished';blockStartedAt=now;pausedAt=null;resetRound=true
        }

        if(resetRound&&from.current_round_id){
          const close=await db.from('event_rounds').update({status:op==='skip'?'skipped':'closed',closed_at:now,updated_at:now,vote_state:'closed'}).eq('id',from.current_round_id).eq('event_id',event.id).eq('status','active')
          if(close.error)throw close.error
        }

        const patch:any={
          run_status:runStatus,current_block_id:blocks[idx].id,current_block_index:idx,
          block_started_at:blockStartedAt,started_at:startedAt,paused_at:pausedAt,
          revision:Number(from.revision||0)+1,updated_at:now
        }
        if(resetRound)Object.assign(patch,{current_round_id:null,current_movie_id:null,current_question:null,vote_state:'closed',results_visible:false,video_state:{status:'idle'}})
        const updated=await db.from('event_runtime').update(patch).eq('event_id',event.id).eq('revision',from.revision).select('*').maybeSingle()
        if(updated.error)throw updated.error
        if(!updated.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)

        let lifecycleStatus=event.status
        if(op==='start'&&event.status==='SALES_OPEN'){
          const e=await db.from('events').update({status:'CHECKIN'}).eq('id',event.id).eq('status','SALES_OPEN').select('status').maybeSingle()
          if(e.error)throw e.error
          if(e.data){
            lifecycleStatus='CHECKIN'
            const tr=await db.from('event_transitions').insert({event_id:event.id,from_status:'SALES_OPEN',to_status:'CHECKIN',actor_user_id:user?.id||null,metadata:{source:'show_runtime'}})
            if(tr.error)console.error('show lifecycle transition log failed',tr.error)
          }
        }
        if(op==='end_event'&&event.status!=='CLOSED'){
          const absent=await db.from('registrations').update({status:'no_show'}).eq('event_id',event.id).eq('status','paid').select('user_id')
          if(absent.error)throw absent.error
          const e=await db.from('events').update({status:'CLOSED'}).eq('id',event.id).neq('status','CLOSED').select('status').maybeSingle()
          if(e.error)throw e.error
          lifecycleStatus='CLOSED'
          if((absent.data||[]).length)await refreshLeaderboard(db,(absent.data||[]).map((x:any)=>x.user_id))
        }

        const log=await db.from('event_runtime_log').insert({event_id:event.id,action:op,actor_user_id:user?.id||null,from_state:from,to_state:updated.data})
        if(log.error)console.error('show runtime log failed',log.error)
        return json({ok:true,eventStatus:lifecycleStatus,show:await buildShowState(db,{...event,status:lifecycleStatus})})
      })
    }

    if(action==='admin-round-start'){
      return await withEventOperation(db,event.id,'show-round',async()=>{
        const show=await buildShowState(db,event)
        const block=show.runtime.currentBlock
        if(!block||!['cinema_rounds','warm_up','final_vote'].includes(String(block.type)))return err('в этом блоке кинораунд не запускается',409)
        if(show.runtime.runStatus!=='running')return err('сначала запустите шоу',409)
        const now=new Date().toISOString()
        if(show.currentRound?.id&&show.currentRound.status==='active'){
          const c=await db.from('event_rounds').update({status:'closed',closed_at:now,updated_at:now,vote_state:'closed'}).eq('id',show.currentRound.id)
          if(c.error)throw c.error
        }
        const roundNo=Number(show.runtime.currentRound||0)+1
        const ins=await db.from('event_rounds').insert({event_id:event.id,round_no:roundNo,block_id:block.id,status:'active',started_at:now}).select('id').single()
        if(ins.error)throw ins.error
        const rt=await db.from('event_runtime').select('revision').eq('event_id',event.id).single();if(rt.error)throw rt.error
        const u=await db.from('event_runtime').update({current_round:roundNo,current_round_id:ins.data.id,current_movie_id:null,current_question:null,vote_state:'closed',results_visible:false,video_state:{status:'idle'},revision:Number(rt.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',rt.data.revision).select('event_id').maybeSingle()
        if(u.error)throw u.error
        if(!u.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
        return json({ok:true,show:await buildShowState(db,event)})
      })
    }

    if(action==='admin-round-random-movie'){
      return await withEventOperation(db,event.id,'show-movie',async()=>{
        const show=await buildShowState(db,event)
        if(!show.currentRound?.id||show.currentRound.status!=='active')return err('сначала запустите раунд',409)
        const [packages,used]=await Promise.all([
          db.from('film_packages').select('movie_candidate_id').eq('event_id',event.id).eq('status','ready'),
          db.from('event_rounds').select('movie_candidate_id').eq('event_id',event.id).not('movie_candidate_id','is',null)
        ])
        if(packages.error)throw packages.error;if(used.error)throw used.error
        const readyIds=[...new Set((packages.data||[]).map((x:any)=>String(x.movie_candidate_id)))]
        if(!readyIds.length)return err('нет готовых киноблоков · сначала подготовьте фильм, 6 фрагментов и 5 вопросов',409)
        const cand=await db.from('movie_candidates').select('*').eq('event_id',event.id).eq('enabled_for_event',true).in('id',readyIds)
        if(cand.error)throw cand.error
        const usedIds=new Set((used.data||[]).map((x:any)=>String(x.movie_candidate_id)))
        const pool=(cand.data||[]).filter((x:any)=>!usedIds.has(String(x.id)))
        if(!pool.length)return err('нет подготовленных неиспользованных фильмов · добавьте материал или выберите фильм вручную',409)
        const pick=secureIndex(pool.length);const chosen=pool[pick.index]
        const now=new Date().toISOString()
        const roundU=await db.from('event_rounds').update({movie_candidate_id:chosen.id,updated_at:now}).eq('id',show.currentRound.id).eq('status','active');if(roundU.error)throw roundU.error
        const rt=await db.from('event_runtime').select('revision').eq('event_id',event.id).single();if(rt.error)throw rt.error
        const runU=await db.from('event_runtime').update({current_movie_id:chosen.id,revision:Number(rt.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',rt.data.revision).select('event_id').maybeSingle();if(runU.error)throw runU.error
        if(!runU.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
        const draw=await db.from('random_draws').insert({event_id:event.id,draw_type:'show_movie',candidate_ids:pool.map((x:any)=>x.id),chosen_id:chosen.id,random_bytes_hex:pick.randomBytesHex});if(draw.error)throw draw.error
        return json({ok:true,movieId:chosen.id,show:await buildShowState(db,event)})
      })
    }

    if(action==='admin-round-set-movie'){
      const movieId=String(body.movieId||'')
      if(!isUuid(movieId))return err('выберите фильм',422)
      const [movie,pack]=await Promise.all([
        db.from('movie_candidates').select('id').eq('id',movieId).eq('event_id',event.id).maybeSingle(),
        db.from('film_packages').select('id,status').eq('movie_candidate_id',movieId).eq('event_id',event.id).eq('status','ready').maybeSingle()
      ])
      if(movie.error)throw movie.error;if(pack.error)throw pack.error
      if(!movie.data)return err('фильм не найден в каталоге события',404)
      if(!pack.data)return err('для этого фильма ещё нет готового киноблока из 6 фрагментов и 5 вопросов',409)
      const show=await buildShowState(db,event)
      if(!show.currentRound?.id||show.currentRound.status!=='active')return err('сначала запустите раунд',409)
      const now=new Date().toISOString()
      const a=await db.from('event_rounds').update({movie_candidate_id:movieId,updated_at:now}).eq('id',show.currentRound.id);if(a.error)throw a.error
      const rt=await db.from('event_runtime').select('revision').eq('event_id',event.id).single();if(rt.error)throw rt.error
      const b=await db.from('event_runtime').update({current_movie_id:movieId,revision:Number(rt.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',rt.data.revision).select('event_id').maybeSingle();if(b.error)throw b.error
      if(!b.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
      return json({ok:true,show:await buildShowState(db,event)})
    }

    if(action==='admin-round-question'){
      const question=normalizeQuestion(body.question)
      if(!question)return err('напишите вопрос',422)
      const show=await buildShowState(db,event)
      if(!show.currentRound?.id||show.currentRound.status!=='active')return err('сначала запустите раунд',409)
      const now=new Date().toISOString()
      const a=await db.from('event_rounds').update({question,updated_at:now}).eq('id',show.currentRound.id);if(a.error)throw a.error
      const rt=await db.from('event_runtime').select('revision').eq('event_id',event.id).single();if(rt.error)throw rt.error
      const b=await db.from('event_runtime').update({current_question:question,revision:Number(rt.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',rt.data.revision).select('event_id').maybeSingle();if(b.error)throw b.error
      if(!b.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
      return json({ok:true,show:await buildShowState(db,event)})
    }

    if(action==='admin-vote-control'){
      const op=String(body.op||'')
      if(!['open','close','show','hide'].includes(op))return err('неизвестное действие голосования',422)
      const show=await buildShowState(db,event)
      if(!show.currentRound?.id||show.currentRound.status!=='active')return err('сначала запустите раунд',409)
      const voteState=op==='open'?'open':op==='close'?'closed':show.currentRound.voteState
      const resultsVisible=op==='show'?true:op==='hide'?false:show.currentRound.resultsVisible
      const now=new Date().toISOString()
      const a=await db.from('event_rounds').update({vote_state:voteState,results_visible:resultsVisible,updated_at:now}).eq('id',show.currentRound.id);if(a.error)throw a.error
      const rt=await db.from('event_runtime').select('revision').eq('event_id',event.id).single();if(rt.error)throw rt.error
      const b=await db.from('event_runtime').update({vote_state:voteState,results_visible:resultsVisible,revision:Number(rt.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',rt.data.revision).select('event_id').maybeSingle();if(b.error)throw b.error
      if(!b.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
      return json({ok:true,show:await buildShowState(db,event)})
    }

    if(action==='admin-external-film-control'){
      const op=String(body.op||'')
      if(!['ready','playing','paused','finished'].includes(op))return err('неизвестное состояние фильма',422)
      const sourceUrl=String(body.sourceUrl||'').trim().slice(0,1800)
      if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))return err('нужна ссылка http/https',422)
      const show=await buildShowState(db,event)
      if(!show.currentRound?.id||show.currentRound.status!=='active')return err('сначала запустите раунд',409)
      const previous:any=show.runtime.videoState||{}
      const now=new Date().toISOString()
      const videoState={
        ...previous,
        status:op,
        external:true,
        sourceUrl:sourceUrl||previous.sourceUrl||null,
        title:String(body.title||previous.title||'непокой').slice(0,180),
        updatedAt:now,
        ...(op==='playing'?{startedAt:previous.startedAt||now}:{}),
        ...(op==='finished'?{finishedAt:now}:{})
      }
      const a=await db.from('event_rounds').update({video_state:videoState,updated_at:now}).eq('id',show.currentRound.id);if(a.error)throw a.error
      const rt=await db.from('event_runtime').select('revision').eq('event_id',event.id).single();if(rt.error)throw rt.error
      const b=await db.from('event_runtime').update({video_state:videoState,revision:Number(rt.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',rt.data.revision).select('event_id').maybeSingle();if(b.error)throw b.error
      if(!b.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
      return json({ok:true,videoState,show:await buildShowState(db,event)})
    }

    if(action==='admin-video-control'){
      const op=String(body.op||'')
      if(!['play','stop','reset'].includes(op))return err('неизвестное действие видео',422)
      const show=await buildShowState(db,event)
      if(!show.currentRound?.id)return err('сначала запустите раунд',409)
      const movie=show.runtime.currentMovie
      if(op==='play'&&!movie)return err('сначала выберите фильм',409)
      if(op==='play'&&!movie?.videoId)return err('для показа сейчас нужен подготовленный youtube video id · иначе используйте fallback животины',409)
      const now=new Date().toISOString()
      const videoState=op==='play'
        ?{status:'playing',startedAt:now,videoId:movie?.videoId||null,sourceUrl:movie?.sourceUrl||null,sourcePlatform:movie?.sourcePlatform||null,startSec:movie?.startSec||0,endSec:movie?.endSec||null}
        :{status:op==='stop'?'stopped':'idle',updatedAt:now}
      const a=await db.from('event_rounds').update({video_state:videoState,updated_at:now}).eq('id',show.currentRound.id);if(a.error)throw a.error
      const rt=await db.from('event_runtime').select('revision').eq('event_id',event.id).single();if(rt.error)throw rt.error
      const b=await db.from('event_runtime').update({video_state:videoState,revision:Number(rt.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',rt.data.revision).select('event_id').maybeSingle();if(b.error)throw b.error
      if(!b.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
      return json({ok:true,show:await buildShowState(db,event)})
    }

    if(action==='admin-round-close'){
      const show=await buildShowState(db,event)
      if(!show.currentRound?.id)return err('нет активного раунда',409)
      const now=new Date().toISOString()
      const a=await db.from('event_rounds').update({status:'closed',flow_status:'round_finished',vote_state:'closed',closed_at:now,updated_at:now}).eq('id',show.currentRound.id);if(a.error)throw a.error
      const rt=await db.from('event_runtime').select('revision').eq('event_id',event.id).single();if(rt.error)throw rt.error
      const b=await db.from('event_runtime').update({vote_state:'closed',revision:Number(rt.data.revision||0)+1,updated_at:now}).eq('event_id',event.id).eq('revision',rt.data.revision).select('event_id').maybeSingle();if(b.error)throw b.error
      if(!b.data)return err('пульт уже изменился в другой вкладке · обновите экран',409)
      return json({ok:true,show:await buildShowState(db,event)})
    }

    if(action==='admin-movie-source-action'){
      const sourceId=String(body.sourceId||'').trim()
      const op=String(body.op||'').trim()
      if(!isUuid(sourceId))return err('некорректный source id',422)
      if(!['select','dead','block'].includes(op))return err('неизвестное действие с источником',422)
      return await withEventOperation(db,event.id,'movie-source-control',async()=>{
        const source=await db.from('movie_source_candidates').select('*').eq('id',sourceId).eq('event_id',event.id).maybeSingle()
        if(source.error)throw source.error
        if(!source.data)return err('источник не найден',404)
        const movieId=String(source.data.movie_candidate_id)

        if(op==='select'){
          if(['dead','blocked'].includes(String(source.data.availability_status)))return err('мёртвый или заблокированный источник нельзя выбрать',409)
          if(source.data.verified!==true)return err('сначала источник должен пройти проверку',409)
          if(source.data.embeddable!==true)return err('этот источник сейчас нельзя встроить в проектор',409)
          if(String(source.data.rights_status)==='blocked')return err('этот источник заблокирован по правам',409)

          const pool=await db.from('movie_source_candidates').select('id,metadata').eq('event_id',event.id).eq('movie_candidate_id',movieId)
          if(pool.error)throw pool.error
          for(const row of pool.data||[]){
            const metadata={...(row.metadata&&typeof row.metadata==='object'?row.metadata:{}),manual_selected:String(row.id)===sourceId}
            const u=await db.from('movie_source_candidates').update({
              metadata,
              ...(String(row.id)===sourceId?{availability_status:'ready'}:{}),
              updated_at:new Date().toISOString()
            }).eq('id',row.id).eq('event_id',event.id)
            if(u.error)throw u.error
          }
        }else{
          const metadata={...(source.data.metadata&&typeof source.data.metadata==='object'?source.data.metadata:{}),manual_selected:false}
          const u=await db.from('movie_source_candidates').update({
            availability_status:op==='dead'?'dead':'blocked',
            metadata,
            updated_at:new Date().toISOString()
          }).eq('id',sourceId).eq('event_id',event.id)
          if(u.error)throw u.error
        }

        const preferred=await resolvedMovieSource(db,movieId)
        await applyMovieSourceToCandidate(db,event,movieId,preferred)
        return json({ok:true,movieId,preferred})
      })
    }

    if(action==='admin-discover-movie-sources'){
      const movieId=String(body.movieId||'').trim()
      if(!isUuid(movieId))return err('некорректный movie id',422)
      const movie=await db.from('movie_candidates').select('*').eq('id',movieId).eq('event_id',event.id).maybeSingle()
      if(movie.error)throw movie.error
      if(!movie.data)return err('фильм не найден',404)
      const resolved=await discoverAndPersistMovieSources(db,event,movie.data)
      return json({ok:true,fallbackUsed:resolved.discovery.fallbackUsed,trace:resolved.discovery.trace,candidates:resolved.discovery.candidates,preferred:resolved.preferred})
    }

    if(action==='admin-movie-save'){
      const movieId=String(body.movieId||'').trim()
      const title=String(body.title||'').trim().slice(0,180)
      if(!title)return err('укажите название фильма',422)
      const usageAllowed=new Set(['ready','partial','no_video','blocked','needs_review'])
      const trailerAllowed=new Set(['ready','missing','blocked','unchecked'])
      const clipAllowed=new Set(['ready','missing','blocked','unchecked'])
      const usageStatus=usageAllowed.has(String(body.usageStatus))?String(body.usageStatus):'needs_review'
      const trailerStatus=trailerAllowed.has(String(body.trailerStatus))?String(body.trailerStatus):'unchecked'
      const clipStatus=clipAllowed.has(String(body.clipStatus))?String(body.clipStatus):'unchecked'
      const startSec=Math.max(0,Math.min(7200,Math.round(Number(body.startSec)||0)))
      const endSec=body.endSec===null||body.endSec===undefined||body.endSec===''?null:Math.max(0,Math.min(7200,Math.round(Number(body.endSec)||0)))
      if(endSec!==null&&endSec<=startSec)return err('конец фрагмента должен быть позже начала',422)
      if(endSec!==null&&endSec-startSec>120)return err('фрагмент для шоу не должен быть длиннее 120 секунд',422)
      const videoId=String(body.videoId||'').trim().slice(0,200)||null
      if(usageStatus==='ready'&&!videoId)return err('для статуса ready нужен подготовленный youtube video id',422)
      const patch:any={
        event_id:event.id,title,
        original_title:String(body.originalTitle||'').trim().slice(0,180)||null,
        year:Number.isInteger(Number(body.year))?Number(body.year):null,
        genre:String(body.genre||'').trim().slice(0,120)||null,
        country:String(body.country||'').trim().slice(0,120)||null,
        enabled_for_event:body.enabledForEvent!==false,
        trailer_status:trailerStatus,clip_status:clipStatus,
        source_type:String(body.sourceType||'').trim().slice(0,80)||null,
        source_platform:String(body.sourcePlatform||'').trim().slice(0,80)||null,
        source_url:String(body.sourceUrl||'').trim().slice(0,1000)||null,
        video_id:videoId,
        start_sec:startSec,
        end_sec:endSec,
        source_channel:String(body.sourceChannel||'').trim().slice(0,200)||null,
        source_verified:body.sourceVerified===true,
        verified_at:body.sourceVerified===true?new Date().toISOString():null,
        usage_status:usageStatus,
        discussion_prompts:Array.isArray(body.discussionPrompts)?body.discussionPrompts.slice(0,12):[],
        animal_comment:String(body.animalComment||'').trim().slice(0,1000)||null,
        tags:(Array.isArray(body.tags)?body.tags:[]).map((x:any)=>String(x).trim()).filter(Boolean).slice(0,20)
      }
      let saved:any
      if(movieId){
        if(!isUuid(movieId))return err('некорректный movie id',422)
        saved=await db.from('movie_candidates').update(patch).eq('id',movieId).eq('event_id',event.id).select('*').maybeSingle()
        if(saved.error)throw saved.error
        if(!saved.data)return err('фильм не найден',404)
      }else{
        saved=await db.from('movie_candidates').insert(patch).select('*').single()
        if(saved.error)throw saved.error
      }
      return json({ok:true,movie:saved.data})
    }

    if(action==='admin-award-crumbs'){
      const show=await buildShowState(db,event)
      const amount=Math.max(1,Math.min(100,Math.round(Number(body.amount)||show.program.rewards.round||1)))
      const scope=String(body.scope||'round_voters')
      const sourceId=String(body.sourceId||show.currentRound?.id||show.runtime.currentBlockId||'manual').slice(0,160)
      let ids:string[]=[]
      if(scope==='round_voters'){
        if(!show.currentRound?.id)return err('нет текущего раунда',409)
        const votes=await db.from('event_votes').select('user_id').eq('event_id',event.id).eq('round_id',show.currentRound.id)
        if(votes.error)throw votes.error
        ids=[...new Set((votes.data||[]).map((x:any)=>String(x.user_id)))]
      }else if(scope==='attended'){
        const regs=await db.from('registrations').select('user_id').eq('event_id',event.id).eq('status','attended')
        if(regs.error)throw regs.error
        ids=(regs.data||[]).map((x:any)=>String(x.user_id))
      }else return err('неизвестная группа для крошек',422)
      let awarded=0,already=0
      for(const uid of ids){
        const a=await db.rpc('award_event_crumbs',{p_user_id:uid,p_event_id:event.id,p_amount:amount,p_reason:'show_reward',p_source_id:sourceId})
        if(a.error)throw a.error
        if(a.data?.alreadyAwarded)already++;else awarded++
      }
      return json({ok:true,awarded,already,participants:ids.length,amount})
    }

    if(action==='admin-fix-registration'){
      const registrationId=String(body.registrationId||'').trim()
      const fix=String(body.fix||'').trim()
      if(!isUuid(registrationId))return err('Некорректная регистрация',422)
      if(!['mark_attended','undo_attended','release_hold','cancel_registration'].includes(fix))return err('Неизвестное ручное действие',422)

      if(fix==='cancel_registration'){
        const current=await db.from('registrations').select('user_id,status,amount_rub,payment_provider').eq('id',registrationId).eq('event_id',event.id).maybeSingle()
        if(current.error)throw current.error
        if(!current.data)return err('Регистрация не найдена',404)
        if(Number(current.data.amount_rub||0)>0||String(current.data.payment_provider||'')==='telegram')return err('Платный билет нельзя сбросить этой кнопкой. Для него нужен отдельный возврат.',409)
        if(['cancelled','refunded'].includes(String(current.data.status||'')))return json({ok:true,registrationId,status:String(current.data.status),promoted:0})

        const cancelled=await db.from('registrations').update({
          status:'cancelled',
          queue_position:null,
          reservation_expires_at:null,
          paid_at:null,
          payment_provider:null,
          provider_payment_id:null,
          telegram_payment_charge_id:null,
          amount_rub:0
        }).eq('id',registrationId).eq('event_id',event.id).select('user_id,status').single()
        if(cancelled.error)throw cancelled.error

        await db.from('event_presence').delete().eq('event_id',event.id).eq('user_id',current.data.user_id)
        await db.from('notification_queue').update({status:'cancelled',error:'registration cancelled by admin'}).eq('event_id',event.id).eq('user_id',current.data.user_id).eq('kind','tickets').eq('status','pending')
        if(['SALES_OPEN','CHECKIN'].includes(String(event.status||'')))await db.rpc('promote_event_waitlist',{p_event_id:event.id})
        await refreshLeaderboard(db,[String(current.data.user_id)])
        return json({ok:true,registrationId,status:String(cancelled.data.status||'cancelled'),promoted:0})
      }

      const r=await db.rpc('admin_fix_event_registration',{p_event_id:event.id,p_registration_id:registrationId,p_action:fix})
      if(r.error){
        const message=String(r.error.message||'')
        if(message.includes('registration not found'))return err('Регистрация не найдена',404)
        if(message.includes('mark_attended requires'))return err('Отметить посещение можно только для оплаченного билета или no-show',409)
        if(message.includes('undo_attended requires'))return err('Отменить чек-ин можно только у уже отмеченного участника',409)
        if(message.includes('release_hold requires'))return err('Сбросить можно только активный резерв',409)
        throw r.error
      }
      const result=r.data?.[0]
      if(!result)return err('Не удалось изменить регистрацию',500)
      const targetUserId=String(result.user_id||'')
      if(targetUserId&&['mark_attended','undo_attended'].includes(fix))await refreshLeaderboard(db,[targetUserId])
      return json({ok:true,registrationId:String(result.registration_id||registrationId),status:String(result.status||''),promoted:Number(result.promoted||0)})
    }
    if(action==='admin-create-checkin-token'){
      const now=new Date().toISOString();const existing=await db.from('encounter_tokens').select('token,expires_at').eq('event_id',event.id).eq('kind','event_checkin').gt('expires_at',now).order('created_at',{ascending:false}).limit(1).maybeSingle();if(existing.error)throw existing.error
      let token=String(existing.data?.token||'');let expiresAt=existing.data?.expires_at||null
      if(!token){token=crypto.randomUUID().replaceAll('-','');expiresAt=new Date(new Date(event.starts_at).getTime()+1000*60*60*12).toISOString();const r=await db.from('encounter_tokens').insert({token,event_id:event.id,kind:'event_checkin',expires_at:expiresAt,metadata:body.metadata||{}});if(r.error)throw r.error}
      return json({ok:true,token,expiresAt,deepLink:await telegramStartLink(`encounter_${token}`)})
    }
    if(action==='admin-award-story'){
      const target=String(body.userId||'');const code=String(body.storyCode||'');if(!target||!code)return err('userId и storyCode обязательны',422);const r=await db.rpc('award_story',{p_user_id:target,p_story_code:code,p_event_id:event.id,p_occurrence_key:'once',p_context:{source:'admin'}});if(r.error)throw r.error;return json({ok:true,result:r.data})
    }
    if(action==='admin-set-mechanic'){
      if(!['DRAFT','SALES_OPEN','CHECKIN'].includes(event.status))return err('Режим нельзя менять после открытия приёма идей',409)
      const enabled=body.enabled===true;const settings={...(event.settings||{}),modes:{...(event.settings?.modes||{}),nonexistent_film:{...(event.settings?.modes?.nonexistent_film||{}),enabled,updated_at:new Date().toISOString()}}}
      const r=await db.from('events').update({settings}).eq('id',event.id).eq('status',event.status).select('id').maybeSingle();if(r.error)throw r.error;if(!r.data)return err('Этап события уже изменился в другой вкладке. Обновите пульт.',409);return json({ok:true,enabled})
    }
    if(action==='admin-stage'){
      const to=String(body.status||'')
      if(body.force===true)return err('Force-переходы отключены. Используйте штатный следующий шаг или отдельное действие этапа.',409)
      if(manualTransitions[event.status]!==to)return err(`Недопустимый переход: ${event.status} → ${to}. Обновите пульт и используйте следующий шаг.`,409)
      if(to==='IDEAS_OPEN'&&!nonexistentFilmEnabled(event))return err('Сначала включите режим «несуществующий фильм»',409)
      if(to==='IDEAS_LOCKED'){
        const ideas=await db.from('film_ideas').select('*',{count:'exact',head:true}).eq('event_id',event.id);if(ideas.error)throw ideas.error
        if(Number(ideas.count||0)<3)return err('Нельзя закрыть идеи: нужно минимум 3 заявки для следующего шага',409)
      }
      if(to==='WATCHING'){
        const [movie,questions]=await Promise.all([
          db.from('event_movie').select('availability_status').eq('event_id',event.id).maybeSingle(),
          db.from('prediction_questions').select('*',{count:'exact',head:true}).eq('event_id',event.id)
        ])
        if(movie.error)throw movie.error;if(questions.error)throw questions.error
        if(movie.data?.availability_status!=='confirmed')return err('Перед просмотром подтвердите доступность выбранного фильма',409)
        if(Number(questions.count||0)!==10)return err('Перед просмотром должны быть сохранены все 10 прогнозов',409)
      }
      if(to==='DISCUSSION'){
        const score=await db.from('event_outputs').select('id').eq('event_id',event.id).eq('output_key','score_summary').maybeSingle();if(score.error)throw score.error
        if(!score.data)return err('Сначала завершите подсчёт прогнозов',409)
      }
      if(to==='CLOSED'&&String(body.confirm||'')!=='CLOSE_EVENT')return err('Закрытие вечера требует отдельного подтверждения',422)
      const r=await db.from('events').update({status:to}).eq('id',event.id).eq('status',event.status).select('id').maybeSingle();if(r.error)throw r.error
      if(!r.data)return err('Этап события уже изменился в другой вкладке. Обновите пульт.',409)
      let noShows=0
      if(to==='CLOSED'){const absent=await db.from('registrations').update({status:'no_show'}).eq('event_id',event.id).eq('status','paid').select('user_id');if(absent.error)throw absent.error;noShows=(absent.data||[]).length;if(noShows)await refreshLeaderboard(db,(absent.data||[]).map((x:any)=>x.user_id))}
      let announcements=0
      if(to==='SALES_OPEN'){
        const recipients=await db.from('notification_preferences').select('user_id').eq('write_access',true).eq('events',true);if(recipients.error)throw recipients.error
        const rows=(recipients.data||[]).map((x:any)=>({user_id:x.user_id,kind:'events',text:'открыли новый вечер НАСЫПАТЕЛИ В КИНО. дата и детали уже внутри.',send_after:new Date().toISOString(),status:'pending',dedupe_key:`event_open:${event.id}`,event_id:event.id,expires_at:event.starts_at}))
        if(rows.length){const q=await db.from('notification_queue').upsert(rows,{onConflict:'user_id,dedupe_key'});if(q.error)throw q.error;announcements=rows.length}
      }
      const transition=await db.from('event_transitions').insert({event_id:event.id,from_status:event.status,to_status:to,actor_user_id:user?.id||null,metadata:{forced:false,no_shows:noShows,announcements}});if(transition.error)throw transition.error
      return json({ok:true,status:to,noShows,announcements})
    }
    if(action==='admin-event-config'){
      const patch:any={}
      if(body.startsAt!==undefined){const raw=String(body.startsAt||'');const ms=Date.parse(raw);if(!raw||!Number.isFinite(ms))return err('Некорректная дата события',422);patch.starts_at=new Date(ms).toISOString()}
      if(body.maxMovieRuntimeMin!==undefined){const n=Number(body.maxMovieRuntimeMin);if(!Number.isInteger(n)||n<45||n>360)return err('Лимит хронометража: 45–360 минут',422);patch.max_movie_runtime_min=n}
      if(body.venueName!==undefined)patch.venue_name=String(body.venueName||'').trim().slice(0,160)||null
      if(body.venueAddress!==undefined)patch.venue_address=String(body.venueAddress||'').trim().slice(0,300)||null
      if(body.ticketPriceRub!==undefined){const n=Number(body.ticketPriceRub);if(!Number.isInteger(n)||n<0||n>100000)return err('Некорректная цена билета',422);if(n!==Number(event.ticket_price_rub||0)){const active=await activeSeatCount(db,event.id);if(active>0)return err('Цену нельзя менять после появления активных резервов или оплаченных билетов',409)}patch.ticket_price_rub=n}
      if(!Object.keys(patch).length)return json({ok:true,event})
      const r=await db.from('events').update(patch).eq('id',event.id).select('id,slug,title,starts_at,capacity,ticket_price_rub,max_movie_runtime_min,venue_name,venue_address').single();if(r.error)throw r.error
      if(patch.starts_at){const q=await db.from('notification_queue').update({expires_at:r.data.starts_at}).eq('event_id',event.id).eq('status','pending');if(q.error)throw q.error}
      return json({ok:true,event:r.data})
    }
    if(action==='admin-capacity'){
      const capacity=Math.max(1,Math.min(500,Number(body.capacity)||30));const r=await db.rpc('set_event_capacity',{p_event_id:event.id,p_capacity:capacity});if(r.error){const message=String(r.error.message||'');if(message.includes('capacity below occupied seats')){const occupied=await activeSeatCount(db,event.id);return err(`Вместимость не может быть меньше уже занятых мест: ${occupied}`,409)}throw r.error}const result=r.data?.[0]||{};return json({ok:true,capacity:Number(result.capacity||capacity),promoted:Number(result.promoted||0)})
    }
    if(action==='admin-grant-test-ticket'){
      const raw=String(body.username||'').trim().replace(/^@/,'');if(!raw)return err('Укажите имя пользователя в Telegram')
      const target=await db.from('users').select('id,telegram_username,display_name').ilike('telegram_username',raw).maybeSingle();if(target.error)throw target.error;if(!target.data)return err('Пользователь ещё не открывал мини-приложение',404)
      const r=await db.rpc('grant_test_ticket',{p_event_id:event.id,p_user_id:target.data.id});if(r.error){const message=String(r.error.message||'');if(message.includes('active waitlist'))return err('Тестовый билет нельзя выдать в обход активного листа ожидания',409);if(message.includes('event is full'))return err('Свободных мест нет',409);throw r.error}
      return json({ok:true,status:String(r.data||'paid'),user:{username:target.data.telegram_username,name:target.data.display_name}})
    }
    if(action==='admin-request-refund'){
      const raw=String(body.username||'').trim().replace(/^@/,'');if(!raw)return err('Укажите имя пользователя в Telegram')
      const target=await db.from('users').select('id,telegram_username,display_name').ilike('telegram_username',raw).maybeSingle();if(target.error)throw target.error;if(!target.data)return err('Пользователь не найден',404)
      const r=await db.rpc('request_ticket_refund',{p_event_id:event.id,p_user_id:target.data.id});if(r.error){const message=String(r.error.message||'');if(message.includes('only paid tickets'))return err('Возврат можно подготовить только для оплаченного билета',409);if(message.includes('provider payment id missing'))return err('У платежа нет provider charge id. Нужна ручная проверка платежа у провайдера',409);throw r.error}
      const refund=r.data?.[0];if(!refund)return err('Не удалось подготовить возврат',500)
      return json({ok:true,refundId:refund.refund_id,status:refund.refund_status,providerChargeId:refund.provider_charge_id,amountRub:Number(refund.amount_rub||0),user:{username:target.data.telegram_username,name:target.data.display_name}})
    }
    if(action==='admin-confirm-refund'){
      const refundId=String(body.refundId||'').trim();const providerReference=String(body.providerReference||'').trim()
      if(!refundId)return err('Не указан refund id',422);if(providerReference.length<3)return err('Укажите reference/номер подтверждения возврата у провайдера',422)
      const before=await db.from('payment_refunds').select('user_id,status').eq('id',refundId).maybeSingle();if(before.error)throw before.error;if(!before.data)return err('Заявка на возврат не найдена',404)
      const r=await db.rpc('confirm_ticket_refund',{p_refund_id:refundId,p_provider_reference:providerReference});if(r.error)throw r.error
      const result=r.data?.[0]||{}
      await db.from('notification_queue').upsert({user_id:before.data.user_id,kind:'tickets',text:'возврат подтверждён. билет возвращён, место больше не закреплено за вами.',send_after:new Date().toISOString(),status:'pending',dedupe_key:`refund_confirmed:${refundId}`},{onConflict:'user_id,dedupe_key'})
      return json({ok:true,refundId:result.refund_id||refundId,status:result.refund_status||'confirmed',registration:result.registration_status||'refunded'})
    }
    if(action==='admin-screen-message'){
      const settings={...(event.settings||{}),screen_message:String(body.message||'').slice(0,180)};const r=await db.from('events').update({settings}).eq('id',event.id);if(r.error)throw r.error;return json({ok:true})
    }
    if(action==='admin-approve-output'){
      const outputKey=String(body.outputKey||'');if(!['post_film_synthesis','collective_review'].includes(outputKey))return err('Этот AI-результат нельзя публиковать этой кнопкой',422)
      const r=await db.from('event_outputs').update({approved:true,updated_at:new Date().toISOString()}).eq('event_id',event.id).eq('output_key',outputKey).select('output_key').maybeSingle();if(r.error)throw r.error;if(!r.data)return err('Сначала сгенерируйте результат',404);return json({ok:true,outputKey})
    }
    if(action==='admin-reveal-idea-author'){
      if(!['IDEA_RANDOMIZED','MOVIE_SEARCH','MOVIE_FINALISTS','MOVIE_SELECTED','PREDICTIONS_OPEN','PREDICTIONS_LOCKED','WATCHING','PREDICTIONS_SCORED','DISCUSSION','FINAL_REVIEW','FEEDBACK','CLOSED'].includes(event.status))return err('Раскрывать автора пока рано',409)
      const selected=await db.from('selected_idea').select('film_idea_id').eq('event_id',event.id).single();if(selected.error)throw selected.error
      const idea=await db.from('film_ideas').select('user_id').eq('id',selected.data.film_idea_id).single();if(idea.error)throw idea.error
      const r=await db.from('selected_idea').update({revealed_author_user_id:idea.data.user_id}).eq('event_id',event.id);if(r.error)throw r.error
      const u=await db.from('users').select('display_name,telegram_username').eq('id',idea.data.user_id).single();if(u.error)throw u.error
      return json({ok:true,author:u.data.telegram_username?`@${u.data.telegram_username}`:u.data.display_name||'участник'})
    }
    if(action==='admin-export-event'){
      const regs=await db.from('registrations').select('user_id,status,amount_rub,photo_video_consent,paid_at,created_at').eq('event_id',event.id).order('created_at');if(regs.error)throw regs.error
      const ids=(regs.data||[]).map((x:any)=>x.user_id);const [users,profiles,feedback,scores,ideas,refunds]=await Promise.all([
        ids.length?db.from('users').select('id,display_name,telegram_username').in('id',ids):{data:[],error:null},
        ids.length?db.from('cinema_profiles').select('user_id,favorite_films,favorite_genres,profile_json').in('user_id',ids):{data:[],error:null},
        db.from('event_feedback').select('user_id,return_intent,strongest_part,improve_text,willingness_to_pay,duration_feel,invite_friend').eq('event_id',event.id),
        db.from('event_scores').select('user_id,correct,total,points,rank').eq('event_id',event.id),
        db.from('film_ideas').select('user_id,id').eq('event_id',event.id),
        db.from('payment_refunds').select('user_id,status,requested_at,confirmed_at,provider_reference').eq('event_id',event.id).order('requested_at',{ascending:false})
      ]);for(const r of [users,profiles,feedback,scores,ideas,refunds])if(r.error)throw r.error
      const refundMap=new Map<string,any>();for(const x of refunds.data||[])if(!refundMap.has(x.user_id))refundMap.set(x.user_id,x)
      const by=(rows:any[],key='user_id')=>new Map((rows||[]).map((x:any)=>[x[key],x]));const um=by(users.data||[],'id'),pm=by(profiles.data||[]),fm=by(feedback.data||[]),sm=by(scores.data||[]);const ideaCounts=new Map<string,number>();for(const x of ideas.data||[])ideaCounts.set(x.user_id,(ideaCounts.get(x.user_id)||0)+1)
      const rows=(regs.data||[]).map((r:any)=>{const u:any=um.get(r.user_id)||{},p:any=pm.get(r.user_id)||{},f:any=fm.get(r.user_id)||{},sc:any=sm.get(r.user_id)||{},j=p.profile_json||{};const refund:any=refundMap.get(r.user_id)||{};return {userId:r.user_id,displayName:u.display_name||'',telegramUsername:u.telegram_username?`@${u.telegram_username}`:'',status:r.status,amountRub:r.amount_rub??null,paidAt:r.paid_at||'',refundStatus:refund.status||'',refundRequestedAt:refund.requested_at||'',refundConfirmedAt:refund.confirmed_at||'',refundProviderReference:refund.provider_reference||'',registeredAt:r.created_at||'',photoVideoConsent:r.photo_video_consent===true,ageRange:j.age_range||'',city:j.city||'',favoriteFilms:p.favorite_films||[],favoriteGenres:p.favorite_genres||[],ideasSubmitted:ideaCounts.get(r.user_id)||0,predictionCorrect:sc.correct??null,predictionTotal:sc.total??null,predictionPoints:sc.points??null,predictionRank:sc.rank??null,returnIntent:f.return_intent||'',willingnessToPayRub:f.willingness_to_pay??null,durationFeel:f.duration_feel||'',inviteFriend:f.invite_friend??null,strongestPart:f.strongest_part||'',improveText:f.improve_text||''}})
      return json({ok:true,event:{id:event.id,slug:event.slug,title:event.title,startsAt:event.starts_at,status:event.status,capacity:event.capacity,ticketPriceRub:event.ticket_price_rub},exportedAt:new Date().toISOString(),rows})
    }
    if(action==='admin-configure-telegram'){
      const webAppUrl=Deno.env.get('TELEGRAM_WEBAPP_URL')||'';const webhookSecret=Deno.env.get('TELEGRAM_WEBHOOK_SECRET')||'';const supabaseUrl=Deno.env.get('SUPABASE_URL')||''
      if(!webAppUrl)throw new Error('TELEGRAM_WEBAPP_URL missing');if(!webhookSecret)throw new Error('TELEGRAM_WEBHOOK_SECRET missing');if(!supabaseUrl)throw new Error('SUPABASE_URL missing')
      const webhookUrl=Deno.env.get('TELEGRAM_WEBHOOK_URL')||`${supabaseUrl}/functions/v1/app?mode=telegram`
      const webhook=await telegramBot('setWebhook',{url:webhookUrl,secret_token:webhookSecret,allowed_updates:['message','pre_checkout_query'],drop_pending_updates:false})
      const menu=await telegramBot('setChatMenuButton',{menu_button:{type:'web_app',text:'открыть клуб',web_app:{url:webAppUrl}}});await telegramBot('setMyCommands',{commands:[{command:'start',description:'открыть клуб'},{command:'paysupport',description:'вопросы по оплате'}]})
      const me=await telegramBot('getMe',{});return json({ok:true,bot:{id:me.id,username:me.username},webhook,menu,webAppUrl,webhookUrl})
    }

    if(action==='admin-draw-all-ideas'){
      return await withEventOperation(db,event.id,'draw-all-ideas',async()=>{
        mechanicsRequired(event)
        if(event.status!=='IDEAS_OPEN')return err('Рандом можно запускать только пока открыт приём идей',409)
        const [ideas,attended]=await Promise.all([
          db.from('film_ideas').select('id,title,plot').eq('event_id',event.id).order('id'),
          db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',event.id).eq('status','attended')
        ])
        if(ideas.error)throw ideas.error
        if(attended.error)throw attended.error
        const list=(ideas.data||[]).map((x:any)=>String(x.id))
        const attendedCount=Number(attended.count||0)
        if(list.length<2)return err('Для рандома нужно хотя бы 2 идеи',409)
        if(attendedCount>0&&list.length<attendedCount&&body.allowBeforeAll!==true){
          return err(`Ещё не все закончили: готово ${list.length} из ${attendedCount}`,409)
        }
        const {index,randomBytesHex}=secureIndex(list.length)
        const chosen=list[index]
        const log=await db.from('random_draws').insert({event_id:event.id,draw_type:'idea_all',candidate_ids:list,chosen_id:chosen,random_bytes_hex:randomBytesHex})
        if(log.error)throw log.error
        const selected=await db.from('selected_idea').upsert({event_id:event.id,film_idea_id:chosen,revealed_author_user_id:null},{onConflict:'event_id'})
        if(selected.error)throw selected.error
        const moved=await db.from('events').update({status:'IDEA_RANDOMIZED'}).eq('id',event.id).eq('status','IDEAS_OPEN').select('id').maybeSingle()
        if(moved.error)throw moved.error
        if(!moved.data)return err('Этап уже изменился в другой вкладке. Обновите пульт.',409)
        const idea=(ideas.data||[]).find((x:any)=>String(x.id)===chosen)
        return json({ok:true,chosen,idea,submitted:list.length,attended:attendedCount,randomBytesHex})
      },60)
    }

    if(action==='ai-select-ideas'){
      return await withEventOperation(db,event.id,'ai-select-ideas',async()=>{
      mechanicsRequired(event);if(event.status!=='IDEAS_LOCKED')return err('Выбор идей доступен только после закрытия приёма',409)
      const ideas=await db.from('film_ideas').select('id,title,plot').eq('event_id',event.id);if(ideas.error)throw ideas.error;if((ideas.data||[]).length<3)return err('Нужно минимум 3 идеи',409)
      const schema={type:'object',additionalProperties:false,properties:{selected:{type:'array',minItems:3,maxItems:3,items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},reason:{type:'string'}},required:['id','reason']}}},required:['selected']}
      const out=await structuredResponse<any>({name:'select_ideas',schema,instructions:JIPITINA,input:`Выбери ровно 3 самые интересные, странные или потенциально плодотворные идеи. Не пытайся угадывать авторов. Вот заявки JSON:\n${JSON.stringify(ideas.data)}`})
      const valid=new Set((ideas.data||[]).map((x:any)=>x.id));if(out.selected.some((x:any)=>!valid.has(x.id)))throw new Error('AI selected unknown idea')
      await db.from('idea_finalists').delete().eq('event_id',event.id);const rows=out.selected.map((x:any,i:number)=>({event_id:event.id,film_idea_id:x.id,rank:i+1,ai_reason:x.reason}));const ins=await db.from('idea_finalists').insert(rows);if(ins.error)throw ins.error
      await db.from('events').update({status:'TOP3_READY'}).eq('id',event.id);return json({ok:true,selected:out.selected})

      },240)
    }
    if(action==='draw-idea'){
      return await withEventOperation(db,event.id,'draw-idea',async()=>{
      mechanicsRequired(event);if(event.status!=='TOP3_READY')return err('Жеребьёвка идеи сейчас недоступна',409)
      const fs=await db.from('idea_finalists').select('film_idea_id').eq('event_id',event.id).order('rank');if(fs.error)throw fs.error;const list=(fs.data||[]).map((x:any)=>x.film_idea_id);if(list.length!==3)return err('Нужны 3 финалиста',409)
      const {index,randomBytesHex}=secureIndex(list.length);const chosen=list[index]
      await db.from('random_draws').insert({event_id:event.id,draw_type:'idea',candidate_ids:list,chosen_id:chosen,random_bytes_hex:randomBytesHex})
      await db.from('selected_idea').upsert({event_id:event.id,film_idea_id:chosen,revealed_author_user_id:null})
      await db.from('events').update({status:'IDEA_RANDOMIZED'}).eq('id',event.id);return json({ok:true,chosen,randomBytesHex})

      },60)
    }
    if(action==='ai-find-movies'){
      return await withEventOperation(db,event.id,'ai-find-movies',async()=>{
      mechanicsRequired(event);if(!['IDEA_RANDOMIZED','MOVIE_SEARCH'].includes(event.status))return err('Поиск фильма сейчас недоступен',409)
      await db.from('events').update({status:'MOVIE_SEARCH'}).eq('id',event.id)
      const sel=await db.from('selected_idea').select('film_ideas(title,plot)').eq('event_id',event.id).single();if(sel.error)throw sel.error
      const regs=await db.from('registrations').select('user_id').eq('event_id',event.id).in('status',['paid','attended']);const userIds=(regs.data||[]).map((x:any)=>x.user_id);const profiles=userIds.length?await db.from('cinema_profiles').select('user_id,favorite_films,favorite_genres,avoid,profile_json').in('user_id',userIds):{data:[]} as any
      const schema={type:'object',additionalProperties:false,properties:{candidates:{type:'array',minItems:8,maxItems:12,items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},originalTitle:{type:'string'},year:{type:['integer','null']},similarityScore:{type:'number',minimum:0,maximum:100},audienceFitScore:{type:'number',minimum:0,maximum:100},reason:{type:'string'}},required:['title','originalTitle','year','similarityScore','audienceFitScore','reason']}}},required:['candidates']}
      const out=await structuredResponse<any>({name:'movie_candidates',schema,instructions:JIPITINA,input:`Предложи реальные полнометражные фильмы или анимацию со всего мира для последующей внешней проверки. Главный вес: сходство с идеей 70%, агрегированный вкус группы 30%. Не предлагай то, в существовании чего сомневаешься. Идея: ${JSON.stringify((sel.data as any).film_ideas)}. Профили группы: ${JSON.stringify(profiles.data||[])}`,maxOutputTokens:3000,model:Deno.env.get('OPENAI_FILM_MODEL')||'gpt-5.6-terra'})
      const validated:any[]=[]
      for(const c of out.candidates){if(validated.length>=8)break;const v=await validateMovieTitle(c.originalTitle||c.title,c.year||undefined);if(!v?.runtimeMin)continue;if(v.runtimeMin>event.max_movie_runtime_min)continue;validated.push({...c,...v,runtimeMin:v.runtimeMin})}
      if(validated.length<3)return err('Не удалось подтвердить 3 фильма. Нужна ручная проверка',422)
      await db.from('movie_candidates').delete().eq('event_id',event.id)
      const rows=validated.map(c=>({event_id:event.id,provider:'wikidata',provider_id:c.wikidataId,title:c.title,original_title:c.originalTitle||c.title,year:c.year||null,runtime_min:c.runtimeMin||null,validated:true,similarity_score:c.similarityScore,audience_fit_score:c.audienceFitScore,reason:c.reason,metadata:{wikidata_url:c.url,description:c.description}}))
      const ins=await db.from('movie_candidates').insert(rows).select('*');if(ins.error)throw ins.error
      const ranked=(ins.data||[]).filter((x:any)=>x.runtime_min&&x.runtime_min<=event.max_movie_runtime_min).sort((a:any,b:any)=>Number(b.weighted_score)-Number(a.weighted_score))
      const top:any[]=[];const sourceSearch:any[]=[]
      for(const movie of ranked){
        if(top.length>=3)break
        const resolved=await discoverAndPersistMovieSources(db,event,movie)
        sourceSearch.push({movieId:movie.id,title:movie.title,fallbackUsed:resolved.discovery.fallbackUsed,found:(resolved.discovery.candidates||[]).length,preferred:resolved.preferred})
        if(resolved.preferred)top.push({...movie,
          source_type:resolved.preferred.sourceType,source_platform:resolved.preferred.sourcePlatform,
          source_url:resolved.preferred.sourceUrl,video_id:resolved.preferred.videoId||null,
          start_sec:resolved.preferred.startSec,end_sec:resolved.preferred.endSec,
          source_channel:resolved.preferred.sourceChannel||null,source_verified:true,usage_status:'ready'
        })
      }
      if(top.length<3)return err('Животина не нашла пригодные фрагменты или трейлеры хотя бы для 3 подтверждённых фильмов',422)
      await db.from('movie_finalists').delete().eq('event_id',event.id);await db.from('movie_finalists').insert(top.map((x:any,i:number)=>({event_id:event.id,movie_candidate_id:x.id,rank:i+1})))
      await db.from('events').update({status:'MOVIE_FINALISTS'}).eq('id',event.id);return json({ok:true,candidates:ins.data,finalists:top,sourceSearch})

      },600)
    }
    if(action==='draw-movie'){
      return await withEventOperation(db,event.id,'draw-movie',async()=>{
      mechanicsRequired(event);if(event.status!=='MOVIE_FINALISTS')return err('Жеребьёвка фильма сейчас недоступна',409)
      const fs=await db.from('movie_finalists').select('movie_candidate_id').eq('event_id',event.id).order('rank');if(fs.error)throw fs.error;const list=(fs.data||[]).map((x:any)=>x.movie_candidate_id);if(list.length!==3)return err('Нужны 3 фильма-финалиста',409)
      const {index,randomBytesHex}=secureIndex(3);const chosen=list[index];await db.from('random_draws').insert({event_id:event.id,draw_type:'movie',candidate_ids:list,chosen_id:chosen,random_bytes_hex:randomBytesHex});const picked=await db.from('event_movie').upsert({event_id:event.id,movie_candidate_id:chosen,availability_status:'unchecked'});if(picked.error)throw picked.error;await db.from('events').update({status:'MOVIE_SELECTED'}).eq('id',event.id);return json({ok:true,chosen,randomBytesHex})

      },60)
    }
    if(action==='admin-confirm-movie-availability'){
      if(event.status!=='MOVIE_SELECTED')return err('Доступность подтверждается после выбора фильма',409);const current=await db.from('event_movie').select('movie_candidate_id').eq('event_id',event.id).single();if(current.error)throw current.error;const r=await db.from('event_movie').update({availability_status:'confirmed'}).eq('event_id',event.id).eq('movie_candidate_id',current.data.movie_candidate_id);if(r.error)throw r.error;return json({ok:true,status:'confirmed'})
    }
    if(action==='admin-redraw-movie'){
      return await withEventOperation(db,event.id,'admin-redraw-movie',async()=>{
      mechanicsRequired(event);if(event.status!=='MOVIE_SELECTED')return err('Другой фильм можно выбрать только после первичного рандома',409);const current=await db.from('event_movie').select('movie_candidate_id').eq('event_id',event.id).single();if(current.error)throw current.error;const fs=await db.from('movie_finalists').select('movie_candidate_id').eq('event_id',event.id).order('rank');if(fs.error)throw fs.error;const list=(fs.data||[]).map((x:any)=>x.movie_candidate_id).filter((id:string)=>id!==current.data.movie_candidate_id);if(!list.length)return err('Других финалистов не осталось',409);const {index,randomBytesHex}=secureIndex(list.length);const chosen=list[index];const log=await db.from('random_draws').insert({event_id:event.id,draw_type:'movie_redraw',candidate_ids:list,chosen_id:chosen,random_bytes_hex:randomBytesHex});if(log.error)throw log.error;const r=await db.from('event_movie').update({movie_candidate_id:chosen,availability_status:'unchecked',selected_at:new Date().toISOString()}).eq('event_id',event.id);if(r.error)throw r.error;return json({ok:true,chosen,randomBytesHex})

      },60)
    }
    if(action==='ai-generate-predictions'){
      return await withEventOperation(db,event.id,'ai-generate-predictions',async()=>{
      mechanicsRequired(event);if(event.status!=='MOVIE_SELECTED')return err('Генерация прогнозов сейчас недоступна',409)
      const mv=await db.from('event_movie').select('availability_status,movie_candidates(title,original_title,year,metadata)').eq('event_id',event.id).single();if(mv.error)throw mv.error;if(mv.data.availability_status!=='confirmed')return err('Сначала вручную подтвердите, что выбранный фильм доступен для показа',409)
      const schema={type:'object',additionalProperties:false,properties:{questions:{type:'array',minItems:10,maxItems:10,items:{type:'string'}}},required:['questions']}
      const out=await structuredResponse<any>({name:'predictions',schema,instructions:JIPITINA,input:`Для реально существующего фильма создай 10 проверяемых утверждений «будет / не будет». Нельзя использовать имена персонажей, прямые спойлеры, название финального твиста или формулировки, которые раскрывают исход. Утверждения должны быть однозначно проверяемы после просмотра. Фильм: ${JSON.stringify((mv.data as any).movie_candidates)}`})
      await db.from('prediction_questions').delete().eq('event_id',event.id);const ins=await db.from('prediction_questions').insert(out.questions.map((text:string,i:number)=>({event_id:event.id,position:i+1,text}))).select('*');if(ins.error)throw ins.error;await db.from('events').update({status:'PREDICTIONS_OPEN'}).eq('id',event.id);return json({ok:true,questions:ins.data})

      },300)
    }
    if(action==='ai-post-film-synthesis'){
      if(event.status!=='DISCUSSION')return err('Разбор группы доступен только во время обсуждения',409)
      const reactions=await db.from('post_film_reactions').select('rating,state_word,thought,recommendation').eq('event_id',event.id);if(reactions.error)throw reactions.error
      const thoughts=(reactions.data||[]).length?reactions.data:((await db.from('discussion_thoughts').select('text').eq('event_id',event.id)).data||[])
      if(!thoughts.length)return err('Пока нет ответов для разбора',409)
      const memories=await db.from('jipitina_memory').select('memory_key,memory_text').eq('scope','club').limit(30)
      const schema={type:'object',additionalProperties:false,properties:{consensus:{type:'string'},disagreements:{type:'string'},jipitinaTake:{type:'string'},questionsForRoom:{type:'array',minItems:1,maxItems:3,items:{type:'string'}}},required:['consensus','disagreements','jipitinaTake','questionsForRoom']}
      const out=await structuredResponse<any>({name:'post_film_synthesis',schema,instructions:JIPITINA+`\nПамять клуба: ${JSON.stringify(memories.data||[])}`,input:`Вот анонимные реакции участников после фильма. Не делай вид, что существует консенсус, если его нет. Найди реальное совпадение, реальное расхождение и сформулируй собственную позицию, с которой можно спорить. Реакции: ${JSON.stringify(thoughts)}`})
      await db.from('event_outputs').upsert({event_id:event.id,output_key:'post_film_synthesis',payload:out,approved:false,updated_at:new Date().toISOString()});return json({ok:true,output:out})
    }
    if(action==='ai-collective-review'){
      if(event.status!=='FINAL_REVIEW')return err('Общая рецензия доступна только на финальном этапе',409)
      const reviews=await db.from('final_reviews').select('rating,final_sentence').eq('event_id',event.id);if(!(reviews.data||[]).length)return err('Пока нет финальных рецензий',409)
      const movie=await db.from('event_movie').select('movie_candidates(title,year)').eq('event_id',event.id).single();const avg=(reviews.data||[]).reduce((a:number,x:any)=>a+Number(x.rating),0)/(reviews.data||[]).length
      const schema={type:'object',additionalProperties:false,properties:{intro:{type:'string'},caption:{type:'string'}},required:['intro','caption']}
      const ai=await structuredResponse<any>({name:'collective_review',schema,instructions:JIPITINA,input:`Напиши очень короткое вступление и подпись к коллективной рецензии клуба. Не переписывай фразы людей — они будут добавлены системой дословно. Фильм: ${JSON.stringify(movie.data)}. Средняя оценка: ${avg.toFixed(1)}. Анонимные финальные фразы: ${JSON.stringify((reviews.data||[]).map((x:any)=>x.final_sentence))}`})
      const out={...ai,averageRating:Number(avg.toFixed(1)),sentences:(reviews.data||[]).map((x:any)=>x.final_sentence)};await db.from('event_outputs').upsert({event_id:event.id,output_key:'collective_review',payload:out,approved:false,updated_at:new Date().toISOString()});return json({ok:true,output:out})
    }
    if(action==='ai-finalize-memory'){
      if(event.status!=='CLOSED')return err('Память клуба можно сохранить после закрытия события',409)
      const [feedback,reviews,outputs]=await Promise.all([db.from('event_feedback').select('return_intent,willingness_to_pay,duration_feel,invite_friend').eq('event_id',event.id),db.from('final_reviews').select('rating').eq('event_id',event.id),db.from('event_outputs').select('output_key,payload').eq('event_id',event.id).eq('approved',true).in('output_key',['score_summary','tiebreaker','post_film_synthesis','collective_review'])])
      const schema={type:'object',additionalProperties:false,properties:{memories:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,properties:{key:{type:'string'},text:{type:'string'}},required:['key','text']}}},required:['memories']}
      const out=await structuredResponse<any>({name:'club_memory',schema,instructions:JIPITINA,input:`Сохрани только устойчивые факты, полезные на будущих вечерах: вкусы группы, традиции/шутки, уроки формата. Не сохраняй чувствительные персональные данные и не восстанавливай индивидуальные ответы. Используй только агрегируемую обратную связь и явно одобренные публичные результаты. Feedback metrics: ${JSON.stringify(feedback.data||[])} Review ratings: ${JSON.stringify(reviews.data||[])} Approved public outputs: ${JSON.stringify(outputs.data||[])}`})
      for(const m of out.memories){await db.from('jipitina_memory').upsert({scope:'club',scope_id:'00000000-0000-0000-0000-000000000000',memory_key:`event_${event.id}_${String(m.key).slice(0,80)}`,memory_text:String(m.text).slice(0,800),source:`event:${event.id}`},{onConflict:'scope,scope_id,memory_key'})}
      await db.from('event_outputs').upsert({event_id:event.id,output_key:'memory_saved',payload:{count:out.memories.length,memories:out.memories},approved:true,updated_at:new Date().toISOString()});return json({ok:true,memories:out.memories})
    }
    if(action==='admin-research-summary'){
      if(!['FEEDBACK','CLOSED'].includes(event.status))return err('Сводка доступна во время или после сбора обратной связи',409)
      const r=await db.from('event_feedback').select('return_intent,strongest_part,improve_text,willingness_to_pay,duration_feel,invite_friend').eq('event_id',event.id);if(r.error)throw r.error
      const rows=r.data||[];if(!rows.length)return err('Пока нет ответов обратной связи',409)
      const returnPositive=rows.filter((x:any)=>['да','скорее да'].includes(String(x.return_intent).toLowerCase())).length;const wtps=rows.map((x:any)=>Number(x.willingness_to_pay)).filter((x:number)=>Number.isFinite(x)&&x>0);const invite=rows.map((x:any)=>Number(x.invite_friend)).filter((x:number)=>Number.isFinite(x)&&x>=0&&x<=10);const promoters=invite.filter((x:number)=>x>=9).length,detractors=invite.filter((x:number)=>x<=6).length;const duration=Object.fromEntries(['коротко','нормально','долго'].map(k=>[k,rows.filter((x:any)=>String(x.duration_feel)===k).length]))
      const payload={responses:rows.length,returnIntentPositivePct:Number((returnPositive/rows.length*100).toFixed(1)),averageWillingnessRub:wtps.length?Math.round(wtps.reduce((a:number,b:number)=>a+b,0)/wtps.length):null,nps:invite.length?Math.round((promoters-detractors)/invite.length*100):null,duration,strongest:rows.map((x:any)=>x.strongest_part).filter(Boolean),improvements:rows.map((x:any)=>x.improve_text).filter(Boolean)};await db.from('event_outputs').upsert({event_id:event.id,output_key:'research_summary',payload,approved:true,updated_at:new Date().toISOString()});return json({ok:true,output:payload})
    }
    if(action==='admin-score-predictions'){
      return await withEventOperation(db,event.id,'admin-score-predictions',async()=>{
      if(!['PREDICTIONS_LOCKED','WATCHING'].includes(event.status))return err('Подсчёт прогнозов сейчас недоступен',409)
      const actuals=body.actuals||{};const qs=await db.from('prediction_questions').select('id').eq('event_id',event.id);if(qs.error)throw qs.error
      if((qs.data||[]).length!==10||(qs.data||[]).some((q:any)=>actuals[q.id]!=='void'&&typeof actuals[q.id]!=='boolean'))return err('Нужно отметить все 10 прогнозов: было / не было / не считаем',422)
      for(const q of qs.data||[]){const v=actuals[q.id];if(v==='void')await db.from('prediction_questions').update({actual:null,void:true}).eq('id',q.id);else await db.from('prediction_questions').update({actual:v,void:false}).eq('id',q.id)}
      const answers=await db.from('prediction_answers').select('user_id,question_id,answer').eq('event_id',event.id);const updated=await db.from('prediction_questions').select('id,actual,void').eq('event_id',event.id);const map=new Map((updated.data||[]).map((q:any)=>[q.id,q]));const scores=new Map<string,{correct:number,total:number}>()
      for(const a of answers.data||[]){const q:any=map.get(a.question_id);if(!q||q.void||typeof q.actual!=='boolean')continue;const score=scores.get(a.user_id)||{correct:0,total:0};score.total++;if(a.answer===q.actual)score.correct++;scores.set(a.user_id,score)}
      const sorted=[...scores.entries()].map(([uid,score])=>({event_id:event.id,user_id:uid,correct:score.correct,total:score.total,points:score.correct})).sort((a,b)=>b.correct-a.correct);let previousCorrect:number|undefined,previousRank=0;const rows=sorted.map((x,i)=>{if(previousCorrect===undefined||x.correct!==previousCorrect){previousCorrect=x.correct;previousRank=i+1}return {...x,rank:previousRank}});if(rows.length){const up=await db.from('event_scores').upsert(rows);if(up.error)throw up.error}
      const named=await db.from('event_scores').select('user_id,correct,total,points,rank,users(display_name,telegram_username)').eq('event_id',event.id).order('rank').order('correct',{ascending:false});if(named.error)throw named.error
      const publicScores=(named.data||[]).map((x:any)=>({userId:x.user_id,name:x.users?.display_name||x.users?.telegram_username||'участник',correct:x.correct,total:x.total,points:x.points,rank:x.rank}));const winners=publicScores.filter((x:any)=>x.rank===1);const soleWinner=winners.length===1?winners[0]:null
      await db.from('events').update({status:'PREDICTIONS_SCORED',winner_user_id:soleWinner?.userId||null}).eq('id',event.id);await db.from('event_outputs').upsert({event_id:event.id,output_key:'score_summary',payload:{scores:publicScores,tie:winners.length>1,winners,winner:soleWinner},approved:true,updated_at:new Date().toISOString()});await refreshLeaderboard(db,rows.map(x=>x.user_id));for(const row of rows){await emitStoryTrigger(db,row.user_id,'prediction_scored',{correct:row.correct,total:row.total},event.id)}return json({ok:true,scores:publicScores,tie:winners.length>1,winners,winner:soleWinner})

      },180)
    }
    if(action==='ai-tiebreaker'){
      return await withEventOperation(db,event.id,'ai-tiebreaker',async()=>{
      if(event.status!=='PREDICTIONS_SCORED')return err('Тай-брейк доступен только после подсчёта',409)
      const score=await db.from('event_outputs').select('payload').eq('event_id',event.id).eq('output_key','score_summary').maybeSingle();const winners=(score.data?.payload as any)?.winners||[];if(winners.length<2)return err('Ничьи за первое место нет',409)
      const schema={type:'object',additionalProperties:false,properties:{clue:{type:'string'}},required:['clue']};const out=await structuredResponse<any>({name:'tiebreaker',schema,instructions:JIPITINA,input:'Выбери широко известный фильм и максимально убого перескажи его в 2–4 коротких предложениях. Нельзя писать название, имена персонажей, актёров, режиссёра, франшизу или уникальные собственные имена. Пересказ должен быть смешным, узнаваемым, но не мгновенно очевидным.'});await db.from('event_outputs').upsert({event_id:event.id,output_key:'tiebreaker',payload:{...out,generatedAt:new Date().toISOString()},approved:true,updated_at:new Date().toISOString()});return json({ok:true,output:out})

      },180)
    }
    if(action==='admin-set-winner'){
      if(event.status!=='PREDICTIONS_SCORED')return err('Победителя можно выбрать только после подсчёта',409)
      const chosen=String(body.userId||'');const top=await db.from('event_scores').select('user_id').eq('event_id',event.id).eq('rank',1);if(top.error)throw top.error;const allowed=(top.data||[]).map((x:any)=>x.user_id);if(!allowed.includes(chosen))return err('Этот участник не делит первое место',409)
      const u=await db.from('users').select('display_name,telegram_username').eq('id',chosen).single();if(u.error)throw u.error;await db.from('events').update({winner_user_id:chosen}).eq('id',event.id);const score=await db.from('event_outputs').select('payload').eq('event_id',event.id).eq('output_key','score_summary').single();if(score.error)throw score.error;const winner={userId:chosen,name:u.data.display_name||u.data.telegram_username||'участник'};await db.from('event_outputs').upsert({event_id:event.id,output_key:'score_summary',payload:{...(score.data.payload as any),tie:false,tieResolved:true,winner},approved:true,updated_at:new Date().toISOString()});await refreshLeaderboard(db,allowed);return json({ok:true,winner})
    }
    return err(`Неизвестное действие: ${action}`,404)
  }catch(e:any){console.error(e);if(e?.message==='EVENT_OPERATION_BUSY')return err('Это действие уже выполняется в другой вкладке. Дождитесь результата и обновите пульт.',409);return err('Что-то пошло не так. Попробуйте ещё раз.',500)}
}
