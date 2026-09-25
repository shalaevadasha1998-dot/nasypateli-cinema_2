import { adminDb } from '../_shared/db.ts'
import { cors, err, json } from '../_shared/http.ts'
import { telegramUserFromRequest, isConfiguredAdmin } from '../_shared/telegram.ts'
import { secureIndex } from '../_shared/random.ts'
import { structuredResponse, textResponse, transcribeAudio } from '../_shared/openai.ts'
import { creatureState, emitStoryTrigger, ensureCreature } from '../_shared/stories.ts'
import { allowedGender, connectionKind, datingState } from '../_shared/dating.ts'
import { JIPITINA, jipitinaInstructions } from '../_shared/jipitina.ts'
import { validateMovieTitle } from '../_shared/movies.ts'
import { buildEventState, eventBySlug, nextEvent, nonexistentFilmEnabled } from '../_shared/state.ts'

const manualTransitions:Record<string,string>={
  DRAFT:'SALES_OPEN',SALES_OPEN:'CHECKIN',CHECKIN:'IDEAS_OPEN',IDEAS_OPEN:'IDEAS_LOCKED',
  PREDICTIONS_OPEN:'PREDICTIONS_LOCKED',PREDICTIONS_LOCKED:'WATCHING',PREDICTIONS_SCORED:'DISCUSSION',
  DISCUSSION:'FINAL_REVIEW',FINAL_REVIEW:'FEEDBACK',FEEDBACK:'CLOSED'
}

const defaultTaste={weirdness:50,heaviness:50,atmosphere:50,oldness:50,experimental:50,slowness:50,surrealism:50}
const allowedChatModes=new Set(['general','idea_coach','post_film','taste'])

function splitList(x:any){
  if(Array.isArray(x))return x.map(v=>String(v).trim()).filter(Boolean).slice(0,30)
  return String(x||'').split(',').map((s:string)=>s.trim()).filter(Boolean).slice(0,30)
}
function clamp100(x:any){const n=Number(x);return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):50}
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
function isMatchmakerRequest(message:string){return /(найди|познаком|сваха|компан).{0,40}(кого|кто|человек|кино|смотр|ужас|хоррор|свидан|друг)|кого.{0,30}(кино|познаком|смотр)/iu.test(message)}

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
  if(created.error) throw created.error
  return created.data
}
async function mustAdmin(db:any,user:any,tg:any){if(isConfiguredAdmin(tg))return;const r=await db.from('admins').select('role').eq('user_id',user.id).maybeSingle();if(r.error)throw r.error;if(!r.data)throw new Error('Admin access required')}
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
function notificationsQuietNow(pref:any){
  if(pref?.quiet_hours!==true)return false
  const zone=Deno.env.get('NOTIFICATION_TIMEZONE')||'Europe/Moscow'
  try{const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hour12:false}).format(new Date()))%24;return hour>=22||hour<9}catch{return false}
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
  const requiredTables=['users','cinema_profiles','events','registrations','creatures','creature_tasks','user_creature_tasks','creature_game_config','crumb_ledger','story_definitions','dating_profiles','notification_preferences','notification_queue','encounter_tokens']
  const [tableChecks,pilot,telegram,gameConfig,testTask]=await Promise.all([
    Promise.all(requiredTables.map(async table=>{const r=await db.from(table).select('*',{head:true}).limit(1);return !r.error})),
    db.from('events').select('slug,capacity,ticket_price_rub').eq('slug','2026-10-03').maybeSingle(),
    telegramRuntimeReady(),
    db.from('creature_game_config').select('feeding_cost,feeding_growth,stage_thresholds').eq('id','default').maybeSingle(),
    db.from('creature_tasks').select('id,status,active,reward_crumbs,completion_type').eq('id','first_test_task').maybeSingle()
  ])
  const env=(name:string)=>!!String(Deno.env.get(name)||'').trim()
  const pilotOk=!pilot.error&&pilot.data?.slug==='2026-10-03'&&Number(pilot.data?.capacity)===30&&Number(pilot.data?.ticket_price_rub)===500
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
  const [leader,ideas,past,messages]=await Promise.all([
    db.from('leaderboard').select('events_attended,prediction_points,wins').eq('user_id',userId).maybeSingle(),
    db.from('film_ideas').select('*',{count:'exact',head:true}).eq('user_id',userId),
    db.from('events').select('id,slug,title,starts_at,status').eq('status','CLOSED').order('starts_at',{ascending:false}).limit(12),
    db.from('jipitina_messages').select('id,role,text,mode,created_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(30)
  ])
  for(const r of [leader,ideas,past,messages])if(r.error)throw r.error
  const pastEvents:any[]=[]
  for(const ev of past.data||[]){
    const [movie,review]=await Promise.all([
      db.from('event_movie').select('movie_candidates(title,year)').eq('event_id',ev.id).maybeSingle(),
      db.from('event_outputs').select('payload,approved').eq('event_id',ev.id).eq('output_key','collective_review').maybeSingle()
    ])
    if(movie.error)throw movie.error;if(review.error)throw review.error
    pastEvents.push({id:ev.id,slug:ev.slug,title:ev.title,startsAt:ev.starts_at,movie:(movie.data as any)?.movie_candidates||undefined,review:review.data?.approved?review.data.payload:undefined})
  }
  return {
    profileStats:{eventsAttended:Number(leader.data?.events_attended||0),predictionPoints:Number(leader.data?.prediction_points||0),wins:Number(leader.data?.wins||0),ideasSubmitted:Number(ideas.count||0)},
    pastEvents,
    jipitinaMessages:(messages.data||[]).reverse().map((m:any)=>({id:m.id,role:m.role,text:m.text,mode:m.mode,createdAt:m.created_at}))
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

async function processChatAftermath(db:any,userId:string,message:string,reply:string,eventId?:string){
  if(message.trim().length<12)return
  const storyCodes=['rabbit_wrong','we_agreed','rabbit_knows_me','rabbit_doesnt_know','first_argument','changed_rabbit_mind','rabbit_changed_mine','asked_for_surprise','trusted_choice','rejected_three','taste_calibrated','rabbit_predicted_rating','rabbit_missed_rating','late_night_chat','ten_real_conversations','rabbit_secret']
  const schema={type:'object',additionalProperties:false,properties:{updates:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{key:{type:'string'},text:{type:'string'},confidence:{type:'number',minimum:0,maximum:1}},required:['key','text','confidence']}},storyCodes:{type:'array',maxItems:2,items:{type:'string',enum:storyCodes}}},required:['updates','storyCodes']}
  const out=await structuredResponse<any>({name:'chat_aftermath',schema,instructions:JIPITINA,input:`Из пары реплик извлеки только устойчивые факты о кинопредпочтениях и, если реально произошла одна из перечисленных историй Животины, верни её code. Не выдавай историю просто за упоминание условия: она должна действительно произойти в разговоре. Не сохраняй здоровье, политику, интимную жизнь, финансы, адреса и случайные эмоции. Пользователь: ${JSON.stringify(message)}\nЖивотина: ${JSON.stringify(reply)}`,maxOutputTokens:350,reasoningEffort:'none'})
  for(const u of out.updates||[]){if(Number(u.confidence)<0.78)continue;const key=String(u.key||'preference').toLowerCase().replace(/[^a-z0-9а-яё_-]+/gi,'_').slice(0,70)||'preference';await db.from('jipitina_memory').upsert({scope:'user',scope_id:userId,memory_key:key,memory_text:String(u.text||'').slice(0,500),source:'jipitina_chat'},{onConflict:'scope,scope_id,memory_key'})}
  for(const code of out.storyCodes||[]){if(storyCodes.includes(code))await emitStoryTrigger(db,userId,'jipitina_chat',{story_code:code},eventId||null)}
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
      const event=await eventBySlug(db,String(body.slug||'2026-10-03'));return json(await buildEventState(db,event,{includeActuals:false}))
    }
    if(action==='admin-bootstrap'){
      if(!adminTokenOk){
        try{
          const adminTg=await telegramUserFromRequest(req)
          const adminUser=await getOrCreateUser(db,adminTg)
          await mustAdmin(db,adminUser,adminTg)
        }catch{return err('Доступ к пульту запрещён',401)}
      }
      const event=await eventBySlug(db,String(body.slug||'2026-10-03'));return json(await buildEventState(db,event,{includeActuals:true,includePrivateOutputs:true}))
    }

    if(action==='cron-notifications'){
      if(!cronTokenOk)return err('Доступ к служебному запуску запрещён',401)
      const due=await db.from('notification_queue').select('id,user_id,kind,text,users(telegram_id)').eq('status','pending').lte('send_after',new Date().toISOString()).order('send_after').limit(50);if(due.error)throw due.error;let sent=0
      for(const n of due.data||[]){try{const prefR=await db.from('notification_preferences').select('*').eq('user_id',n.user_id).maybeSingle();if(prefR.error)throw prefR.error;const pref=prefR.data;const allowed=pref?.write_access===true&&pref?.[n.kind]!==false;if(!allowed){await db.from('notification_queue').update({status:'cancelled',error:'preference disabled'}).eq('id',n.id);continue}if(notificationsQuietNow(pref))continue;const chatId=(n as any).users?.telegram_id;if(!chatId){await db.from('notification_queue').update({status:'failed',error:'telegram id missing'}).eq('id',n.id);continue}await telegramBot('sendMessage',{chat_id:chatId,text:n.text});await db.from('notification_queue').update({status:'sent',sent_at:new Date().toISOString(),error:null}).eq('id',n.id);sent++}catch(e){await db.from('notification_queue').update({status:'failed',error:String(e).slice(0,500)}).eq('id',n.id)}}
      return json({ok:true,sent,checked:(due.data||[]).length})
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
      const name=String(body.name||'Животина').trim().slice(0,32)||'Животина'
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

    if(action==='bootstrap'){
      const event=await nextEvent(db)
      if(!event)return json({user,profile:null,event:null,onboardingComplete:false})
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
      return json({...common,user,profile,onboardingComplete:profile.completed,registration:effectiveRegistrationStatus(reg.data),idea:idea.data||undefined,predictions:(common.predictions||[]).map((p:any)=>({...p,answer:answerMap.get(p.id)})),predictionSubmitted:(answers.data||[]).length>0,thought:thought.data?.text,reaction:reaction.data?{rating:reaction.data.rating,stateWord:reaction.data.state_word,thought:reaction.data.thought,recommendation:reaction.data.recommendation}:undefined,review:review.data?{rating:review.data.rating,sentence:review.data.final_sentence}:undefined,feedback:feedback.data?{returnIntent:feedback.data.return_intent,strongest:feedback.data.strongest_part||'',improve:feedback.data.improve_text||'',willingness:feedback.data.willingness_to_pay||0,durationFeel:feedback.data.duration_feel||'нормально',inviteFriend:feedback.data.invite_friend===null||feedback.data.invite_friend===undefined?8:Number(feedback.data.invite_friend)}:undefined,...extras,creature,...datingBundle,notificationPrefs:{writeAccess:!!notif.data?.write_access,events:notif.data?.events!==false,creature:notif.data?.creature!==false,stories:notif.data?.stories!==false,matches:notif.data?.matches!==false,tickets:notif.data?.tickets!==false,reminders:notif.data?.reminders!==false,quietHours:notif.data?.quiet_hours!==false}})
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
      const targetId=String(body.targetUserId||'');const direction=String(body.direction||'');if(!isUuid(targetId)||targetId===user.id||!['like','pass'].includes(direction))return err('Некорректный свайп',422)
      const [target,mine,blocks]=await Promise.all([
        db.from('dating_profiles').select('enabled,paused,intents,self_gender,show_gender').eq('user_id',targetId).maybeSingle(),
        db.from('dating_profiles').select('enabled,paused,intents,self_gender,show_gender').eq('user_id',user.id).maybeSingle(),
        db.from('user_blocks').select('blocker_id,blocked_id').or(`and(blocker_id.eq.${user.id},blocked_id.eq.${targetId}),and(blocker_id.eq.${targetId},blocked_id.eq.${user.id})`).limit(1)
      ]);for(const r of [target,mine,blocks])if(r.error)throw r.error
      if(!mine.data?.enabled||mine.data?.paused)return err('Сначала включите знакомства',409)
      if(!target.data?.enabled||target.data?.paused)return err('Этот профиль сейчас недоступен',409)
      if((blocks.data||[]).length)return err('Этот профиль недоступен',403)
      if(!allowedGender(mine.data.show_gender,target.data.self_gender)||!allowedGender(target.data.show_gender,mine.data.self_gender))return err('Этот профиль не входит в ваши взаимные фильтры',403)
      const sw=await db.from('dating_swipes').upsert({swiper_id:user.id,target_id:targetId,direction,created_at:new Date().toISOString()},{onConflict:'swiper_id,target_id'});if(sw.error)throw sw.error
      if(direction==='pass')return json({ok:true,matched:false})
      const reverse=await db.from('dating_swipes').select('direction').eq('swiper_id',targetId).eq('target_id',user.id).maybeSingle();if(reverse.error)throw reverse.error;if(reverse.data?.direction!=='like')return json({ok:true,matched:false})
      const existing=await db.from('social_connections').select('*').or(`and(user_a.eq.${user.id},user_b.eq.${targetId}),and(user_a.eq.${targetId},user_b.eq.${user.id})`).maybeSingle();if(existing.error)throw existing.error
      let connection=existing.data
      if(!connection){const kind=connectionKind(mine.data?.intents||[],target.data?.intents||[]);const [pa,pb]=await Promise.all([db.from('cinema_profiles').select('favorite_films').eq('user_id',user.id).maybeSingle(),db.from('cinema_profiles').select('favorite_films').eq('user_id',targetId).maybeSingle()]);const bset=new Set((pb.data?.favorite_films||[]).map((x:string)=>x.toLowerCase()));const shared=(pa.data?.favorite_films||[]).filter((x:string)=>bset.has(x.toLowerCase()));const ins=await db.from('social_connections').insert({user_a:user.id,user_b:targetId,kind,status:'active',metadata:{shared_films:shared}}).select('*').single();if(ins.error)throw ins.error;connection=ins.data
        for(const uid of [user.id,targetId]){await emitStoryTrigger(db,uid,'dating_match',{story_code:'first_match',kind,shared_favorites:shared.length},null);await emitStoryTrigger(db,uid,'dating_match',{story_code:kind==='romantic'?'romantic_match':kind==='cinema'?'cinema_match':'friend_match',kind,shared_favorites:shared.length},null);if(shared.length)await emitStoryTrigger(db,uid,'dating_match',{story_code:'same_favorite_match',kind,shared_favorites:shared.length},null)};for(const uid of [user.id,targetId])await db.from('notification_queue').upsert({user_id:uid,kind:'matches',text:'ваши Животины совпали. откройте знакомства',send_after:new Date().toISOString(),status:'pending',dedupe_key:'match:'+connection.id},{onConflict:'user_id,dedupe_key'})
      }
      return json({ok:true,matched:true,connectionId:connection.id,kind:connection.kind})
    }
    if(action==='dating-hide-connection'){
      const id=String(body.connectionId||'');if(!isUuid(id))return err('Связь не найдена',404);const c=await db.from('social_connections').select('user_a,user_b,metadata').eq('id',id).maybeSingle();if(c.error)throw c.error;if(!c.data||![c.data.user_a,c.data.user_b].includes(user.id))return err('Связь не найдена',404);const hiddenBy=Array.from(new Set([...(Array.isArray(c.data.metadata?.hidden_by)?c.data.metadata.hidden_by:[]),user.id]));const r=await db.from('social_connections').update({metadata:{...(c.data.metadata||{}),hidden_by:hiddenBy}}).eq('id',id);if(r.error)throw r.error;return json({ok:true})
    }
    if(action==='dating-block'){
      const targetId=String(body.targetUserId||'');if(!isUuid(targetId)||targetId===user.id)return err('Некорректный профиль',422);const r=await db.from('user_blocks').upsert({blocker_id:user.id,blocked_id:targetId},{onConflict:'blocker_id,blocked_id'});if(r.error)throw r.error;await db.from('social_connections').update({status:'blocked'}).or(`and(user_a.eq.${user.id},user_b.eq.${targetId}),and(user_a.eq.${targetId},user_b.eq.${user.id})`);return json({ok:true})
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
        if(!t.data.event_id)return err('У жетона нет события',422);const reg=await db.from('registrations').select('status').eq('event_id',t.data.event_id).eq('user_id',user.id).maybeSingle();if(reg.error)throw reg.error;if(!['paid','attended'].includes(reg.data?.status||''))return err('Для отметки нужен билет на это событие',403);await db.from('registrations').update({status:'attended'}).eq('event_id',t.data.event_id).eq('user_id',user.id);const ev=await db.from('events').select('slug,title,starts_at').eq('id',t.data.event_id).single();if(ev.error)throw ev.error;const memberCount=await db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',t.data.event_id).eq('status','attended');const minutesBefore=Math.round((new Date(ev.data.starts_at).getTime()-Date.now())/60000);const awards=await emitStoryTrigger(db,user.id,'event_checkin',{event_slug:ev.data.slug,member_number:Number(memberCount.count||0),minutes_before:minutesBefore,...(t.data.metadata||{})},t.data.event_id);await refreshLeaderboard(db,[user.id]);return json({ok:true,kind:'event_checkin',awards})
      }
      if(t.data.kind==='rabbit'){
        const other=String(t.data.owner_user_id||'');if(!other||other===user.id)return err('Это жетон вашей собственной Животины',409);const [a,b]=await Promise.all([db.from('cinema_profiles').select('favorite_films,favorite_genres').eq('user_id',user.id).maybeSingle(),db.from('cinema_profiles').select('favorite_films,favorite_genres').eq('user_id',other).maybeSingle()]);const bf=new Set((b.data?.favorite_films||[]).map((x:string)=>x.toLowerCase()));const bg=new Set((b.data?.favorite_genres||[]).map((x:string)=>x.toLowerCase()));const sharedFavorites=(a.data?.favorite_films||[]).filter((x:string)=>bf.has(x.toLowerCase())).length;const sharedGenres=(a.data?.favorite_genres||[]).filter((x:string)=>bg.has(x.toLowerCase())).length;for(const uid of [user.id,other]){await emitStoryTrigger(db,uid,'encounter',{story_code:'first_rabbit_meet',shared_favorites:sharedFavorites,shared_genres:sharedGenres,other_user_id:uid===user.id?other:user.id},t.data.event_id||null);if(sharedFavorites)await emitStoryTrigger(db,uid,'encounter',{story_code:'same_taste',shared_favorites:sharedFavorites,shared_genres:sharedGenres},t.data.event_id||null);if(!sharedFavorites&&!sharedGenres)await emitStoryTrigger(db,uid,'encounter',{story_code:'nothing_common',shared_favorites:0,shared_genres:0},t.data.event_id||null)}return json({ok:true,kind:'rabbit',sharedFavorites,sharedGenres})
      }
      return err('Неизвестный тип жетона',422)
    }
    if(action==='delete-profile'){
      if(String(body.confirm)!=='DELETE_PROFILE')return err('Нужно подтверждение удаления',422)
      const failures:string[]=[]
      const tables=['jipitina_messages','jipitina_memory','dating_swipes','dating_profiles','user_blocks','notification_preferences','notification_queue','encounter_tokens','user_creature_tasks','user_creature_cosmetics','user_collectibles','crumb_ledger','user_stories','story_trigger_log','creatures','film_ideas','prediction_answers','discussion_thoughts','post_film_reactions','final_reviews','event_feedback','event_scores','leaderboard','cinema_profiles']
      for(const t of tables){
        let q=db.from(t).delete()
        if(t==='jipitina_memory')q=q.eq('scope','user').eq('scope_id',user.id)
        else if(t==='dating_swipes')q=q.or(`swiper_id.eq.${user.id},target_id.eq.${user.id}`)
        else if(t==='user_blocks')q=q.or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`)
        else if(t==='encounter_tokens')q=q.eq('owner_user_id',user.id)
        else q=q.eq('user_id',user.id)
        const r=await q
        if(r.error){console.error('profile delete',t,r.error);failures.push(t)}
      }
      const social=await db.from('social_connections').delete().or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
      if(social.error){console.error('profile delete social_connections',social.error);failures.push('social_connections')}
      const resetUser=await db.from('users').update({display_name:'участник',telegram_username:null,updated_at:new Date().toISOString()}).eq('id',user.id)
      if(resetUser.error){console.error('profile delete users',resetUser.error);failures.push('users')}
      if(failures.length)return err('Не удалось полностью удалить профиль. Попробуйте ещё раз.',500)
      return json({ok:true})
    }

    const slug=String(body.slug||'2026-10-03');const event=await eventBySlug(db,slug)

    if(action==='jipitina-chat'){
      const profileRow=await db.from('cinema_profiles').select('*').eq('user_id',user.id).maybeSingle();if(profileRow.error)throw profileRow.error
      const reg=await db.from('registrations').select('*').eq('event_id',event.id).eq('user_id',user.id).maybeSingle();if(reg.error)throw reg.error
      const profile=normalizeProfile(user,profileRow.data,reg.data,tg);if(!profile.completed)return err('Сначала завершите кинопрофиль',409)
      const limitMessage=await chatRateLimit(db,user.id);if(limitMessage)return err(limitMessage,429)
      const mode=allowedChatModes.has(String(body.mode))?String(body.mode):'general';const message=String(body.message||'').trim().slice(0,3000);if(!message)return err('Напишите сообщение')
      if(mode==='idea_coach'){mechanicsRequired(event);if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(event.status!=='IDEAS_OPEN')return err('Идеи сейчас не принимаются',409)}
      if(mode==='post_film'){if(!await hasPaidAccess(db,event.id,user.id))return err('Нужен оплаченный билет',403);if(!['DISCUSSION','FINAL_REVIEW','FEEDBACK','CLOSED'].includes(event.status))return err('Разговор после фильма ещё не открыт',409)}
      const context=await chatContext(db,event,user,profile);const recent=await db.from('jipitina_messages').select('role,text,mode').eq('user_id',user.id).order('created_at',{ascending:false}).limit(8);if(recent.error)throw recent.error
      const draft=mode==='idea_coach'?{title:String(body.draftTitle||''),plot:String(body.draftPlot||'')}:undefined
      let matchmaker:any=undefined
      if(mode==='general'&&isMatchmakerRequest(message)){
        const social=await datingState(db,user.id)
        matchmaker={enabled:social.dating.enabled,paused:social.dating.paused,intents:social.dating.intents,candidates:(social.datingCards||[]).slice(0,6).map((c:any)=>({displayName:c.displayName,creatureName:c.creatureName,favoriteFilms:c.favoriteFilms,favoriteGenres:c.favoriteGenres,matchNote:c.matchNote,compatibility:c.compatibility}))}
      }
      const input=`КОНТЕКСТ JSON:\n${JSON.stringify({...context,draft,matchmaker,recent:(recent.data||[]).reverse()})}\n\nСООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:\n${message}`
      const userInsert=await db.from('jipitina_messages').insert({user_id:user.id,event_id:event.id,role:'user',mode,text:message,created_at:new Date().toISOString()});if(userInsert.error)throw userInsert.error
      const reply=await textResponse({instructions:jipitinaInstructions(mode),input,maxOutputTokens:420,reasoningEffort:'none'})
      const assistantInsert=await db.from('jipitina_messages').insert({user_id:user.id,event_id:event.id,role:'assistant',mode,text:reply,created_at:new Date().toISOString()});if(assistantInsert.error)throw assistantInsert.error
      const task=processChatAftermath(db,user.id,message,reply,event.id).catch((e:any)=>console.error('chat aftermath failed',e));const edge=(globalThis as any).EdgeRuntime;if(edge?.waitUntil)edge.waitUntil(task)
      return json({ok:true,reply,mode})
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

    if(!adminTokenOk)await mustAdmin(db,user,tg)

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
      const enabled=body.enabled===true;const settings={...(event.settings||{}),modes:{...(event.settings?.modes||{}),nonexistent_film:{...(event.settings?.modes?.nonexistent_film||{}),enabled,updated_at:new Date().toISOString()}}}
      const r=await db.from('events').update({settings}).eq('id',event.id);if(r.error)throw r.error;return json({ok:true,enabled})
    }
    if(action==='admin-stage'){
      const to=String(body.status||'');if(to==='IDEAS_OPEN'&&!nonexistentFilmEnabled(event))return err('Сначала включите режим «несуществующий фильм»',409)
      if(manualTransitions[event.status]!==to && body.force!==true)return err(`Этот переход выполняется отдельным действием: ${event.status} → ${to}`,409)
      const r=await db.from('events').update({status:to}).eq('id',event.id);if(r.error)throw r.error
      await db.from('event_transitions').insert({event_id:event.id,from_status:event.status,to_status:to,actor_user_id:user?.id||null,metadata:{forced:body.force===true}});return json({ok:true,status:to})
    }
    if(action==='admin-event-config'){
      const patch:any={}
      if(body.startsAt!==undefined){const raw=String(body.startsAt||'');const ms=Date.parse(raw);if(!raw||!Number.isFinite(ms))return err('Некорректная дата события',422);patch.starts_at=new Date(ms).toISOString()}
      if(body.maxMovieRuntimeMin!==undefined){const n=Number(body.maxMovieRuntimeMin);if(!Number.isInteger(n)||n<45||n>360)return err('Лимит хронометража: 45–360 минут',422);patch.max_movie_runtime_min=n}
      if(body.venueName!==undefined)patch.venue_name=String(body.venueName||'').trim().slice(0,160)||null
      if(body.venueAddress!==undefined)patch.venue_address=String(body.venueAddress||'').trim().slice(0,300)||null
      if(body.ticketPriceRub!==undefined){const n=Number(body.ticketPriceRub);if(!Number.isInteger(n)||n<0||n>100000)return err('Некорректная цена билета',422);if(n!==Number(event.ticket_price_rub||0)){const active=await activeSeatCount(db,event.id);if(active>0)return err('Цену нельзя менять после появления активных резервов или оплаченных билетов',409)}patch.ticket_price_rub=n}
      if(!Object.keys(patch).length)return json({ok:true,event})
      const r=await db.from('events').update(patch).eq('id',event.id).select('id,slug,title,starts_at,capacity,ticket_price_rub,max_movie_runtime_min,venue_name,venue_address').single();if(r.error)throw r.error;return json({ok:true,event:r.data})
    }
    if(action==='admin-capacity'){
      const capacity=Math.max(1,Math.min(500,Number(body.capacity)||30));const occupied=await activeSeatCount(db,event.id);if(capacity<occupied)return err(`Вместимость не может быть меньше уже занятых мест: ${occupied}`,409);const r=await db.from('events').update({capacity}).eq('id',event.id);if(r.error)throw r.error;return json({ok:true,capacity})
    }
    if(action==='admin-grant-test-ticket'){
      const raw=String(body.username||'').trim().replace(/^@/,'');if(!raw)return err('Укажите имя пользователя в Telegram')
      const target=await db.from('users').select('id,telegram_username,display_name').ilike('telegram_username',raw).maybeSingle();if(target.error)throw target.error;if(!target.data)return err('Пользователь ещё не открывал мини-приложение',404)
      const r=await db.from('registrations').upsert({event_id:event.id,user_id:target.data.id,status:'paid',amount_rub:0,payment_provider:'test',paid_at:new Date().toISOString(),reservation_expires_at:null},{onConflict:'event_id,user_id'});if(r.error)throw r.error
      return json({ok:true,user:{username:target.data.telegram_username,name:target.data.display_name}})
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
      const ids=(regs.data||[]).map((x:any)=>x.user_id);const [users,profiles,feedback,scores,ideas]=await Promise.all([
        ids.length?db.from('users').select('id,display_name,telegram_username').in('id',ids):{data:[],error:null},
        ids.length?db.from('cinema_profiles').select('user_id,favorite_films,favorite_genres,profile_json').in('user_id',ids):{data:[],error:null},
        db.from('event_feedback').select('user_id,return_intent,strongest_part,improve_text,willingness_to_pay,duration_feel,invite_friend').eq('event_id',event.id),
        db.from('event_scores').select('user_id,correct,total,points,rank').eq('event_id',event.id),
        db.from('film_ideas').select('user_id,id').eq('event_id',event.id)
      ]);for(const r of [users,profiles,feedback,scores,ideas])if(r.error)throw r.error
      const by=(rows:any[],key='user_id')=>new Map((rows||[]).map((x:any)=>[x[key],x]));const um=by(users.data||[],'id'),pm=by(profiles.data||[]),fm=by(feedback.data||[]),sm=by(scores.data||[]);const ideaCounts=new Map<string,number>();for(const x of ideas.data||[])ideaCounts.set(x.user_id,(ideaCounts.get(x.user_id)||0)+1)
      const rows=(regs.data||[]).map((r:any)=>{const u:any=um.get(r.user_id)||{},p:any=pm.get(r.user_id)||{},f:any=fm.get(r.user_id)||{},sc:any=sm.get(r.user_id)||{},j=p.profile_json||{};return {userId:r.user_id,displayName:u.display_name||'',telegramUsername:u.telegram_username?`@${u.telegram_username}`:'',status:r.status,amountRub:r.amount_rub??null,paidAt:r.paid_at||'',registeredAt:r.created_at||'',photoVideoConsent:r.photo_video_consent===true,ageRange:j.age_range||'',city:j.city||'',favoriteFilms:p.favorite_films||[],favoriteGenres:p.favorite_genres||[],ideasSubmitted:ideaCounts.get(r.user_id)||0,predictionCorrect:sc.correct??null,predictionTotal:sc.total??null,predictionPoints:sc.points??null,predictionRank:sc.rank??null,returnIntent:f.return_intent||'',willingnessToPayRub:f.willingness_to_pay??null,durationFeel:f.duration_feel||'',inviteFriend:f.invite_friend??null,strongestPart:f.strongest_part||'',improveText:f.improve_text||''}})
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

    if(action==='ai-select-ideas'){
      mechanicsRequired(event);if(event.status!=='IDEAS_LOCKED')return err('Выбор идей доступен только после закрытия приёма',409)
      const ideas=await db.from('film_ideas').select('id,title,plot').eq('event_id',event.id);if(ideas.error)throw ideas.error;if((ideas.data||[]).length<3)return err('Нужно минимум 3 идеи',409)
      const schema={type:'object',additionalProperties:false,properties:{selected:{type:'array',minItems:3,maxItems:3,items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},reason:{type:'string'}},required:['id','reason']}}},required:['selected']}
      const out=await structuredResponse<any>({name:'select_ideas',schema,instructions:JIPITINA,input:`Выбери ровно 3 самые интересные, странные или потенциально плодотворные идеи. Не пытайся угадывать авторов. Вот заявки JSON:\n${JSON.stringify(ideas.data)}`})
      const valid=new Set((ideas.data||[]).map((x:any)=>x.id));if(out.selected.some((x:any)=>!valid.has(x.id)))throw new Error('AI selected unknown idea')
      await db.from('idea_finalists').delete().eq('event_id',event.id);const rows=out.selected.map((x:any,i:number)=>({event_id:event.id,film_idea_id:x.id,rank:i+1,ai_reason:x.reason}));const ins=await db.from('idea_finalists').insert(rows);if(ins.error)throw ins.error
      await db.from('events').update({status:'TOP3_READY'}).eq('id',event.id);return json({ok:true,selected:out.selected})
    }
    if(action==='draw-idea'){
      mechanicsRequired(event);if(event.status!=='TOP3_READY')return err('Жеребьёвка идеи сейчас недоступна',409)
      const fs=await db.from('idea_finalists').select('film_idea_id').eq('event_id',event.id).order('rank');if(fs.error)throw fs.error;const list=(fs.data||[]).map((x:any)=>x.film_idea_id);if(list.length!==3)return err('Нужны 3 финалиста',409)
      const {index,randomBytesHex}=secureIndex(list.length);const chosen=list[index]
      await db.from('random_draws').insert({event_id:event.id,draw_type:'idea',candidate_ids:list,chosen_id:chosen,random_bytes_hex:randomBytesHex})
      await db.from('selected_idea').upsert({event_id:event.id,film_idea_id:chosen,revealed_author_user_id:null})
      await db.from('events').update({status:'IDEA_RANDOMIZED'}).eq('id',event.id);return json({ok:true,chosen,randomBytesHex})
    }
    if(action==='ai-find-movies'){
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
      const top=(ins.data||[]).filter((x:any)=>x.runtime_min&&x.runtime_min<=event.max_movie_runtime_min).sort((a:any,b:any)=>Number(b.weighted_score)-Number(a.weighted_score)).slice(0,3);if(top.length<3)return err('Нужны 3 подтверждённых финалиста',422)
      await db.from('movie_finalists').delete().eq('event_id',event.id);await db.from('movie_finalists').insert(top.map((x:any,i:number)=>({event_id:event.id,movie_candidate_id:x.id,rank:i+1})))
      await db.from('events').update({status:'MOVIE_FINALISTS'}).eq('id',event.id);return json({ok:true,candidates:ins.data,finalists:top})
    }
    if(action==='draw-movie'){
      mechanicsRequired(event);if(event.status!=='MOVIE_FINALISTS')return err('Жеребьёвка фильма сейчас недоступна',409)
      const fs=await db.from('movie_finalists').select('movie_candidate_id').eq('event_id',event.id).order('rank');if(fs.error)throw fs.error;const list=(fs.data||[]).map((x:any)=>x.movie_candidate_id);if(list.length!==3)return err('Нужны 3 фильма-финалиста',409)
      const {index,randomBytesHex}=secureIndex(3);const chosen=list[index];await db.from('random_draws').insert({event_id:event.id,draw_type:'movie',candidate_ids:list,chosen_id:chosen,random_bytes_hex:randomBytesHex});const picked=await db.from('event_movie').upsert({event_id:event.id,movie_candidate_id:chosen,availability_status:'unchecked'});if(picked.error)throw picked.error;await db.from('events').update({status:'MOVIE_SELECTED'}).eq('id',event.id);return json({ok:true,chosen,randomBytesHex})
    }
    if(action==='admin-confirm-movie-availability'){
      if(event.status!=='MOVIE_SELECTED')return err('Доступность подтверждается после выбора фильма',409);const current=await db.from('event_movie').select('movie_candidate_id').eq('event_id',event.id).single();if(current.error)throw current.error;const r=await db.from('event_movie').update({availability_status:'confirmed'}).eq('event_id',event.id).eq('movie_candidate_id',current.data.movie_candidate_id);if(r.error)throw r.error;return json({ok:true,status:'confirmed'})
    }
    if(action==='admin-redraw-movie'){
      mechanicsRequired(event);if(event.status!=='MOVIE_SELECTED')return err('Другой фильм можно выбрать только после первичного рандома',409);const current=await db.from('event_movie').select('movie_candidate_id').eq('event_id',event.id).single();if(current.error)throw current.error;const fs=await db.from('movie_finalists').select('movie_candidate_id').eq('event_id',event.id).order('rank');if(fs.error)throw fs.error;const list=(fs.data||[]).map((x:any)=>x.movie_candidate_id).filter((id:string)=>id!==current.data.movie_candidate_id);if(!list.length)return err('Других финалистов не осталось',409);const {index,randomBytesHex}=secureIndex(list.length);const chosen=list[index];const log=await db.from('random_draws').insert({event_id:event.id,draw_type:'movie_redraw',candidate_ids:list,chosen_id:chosen,random_bytes_hex:randomBytesHex});if(log.error)throw log.error;const r=await db.from('event_movie').update({movie_candidate_id:chosen,availability_status:'unchecked',selected_at:new Date().toISOString()}).eq('event_id',event.id);if(r.error)throw r.error;return json({ok:true,chosen,randomBytesHex})
    }
    if(action==='ai-generate-predictions'){
      mechanicsRequired(event);if(event.status!=='MOVIE_SELECTED')return err('Генерация прогнозов сейчас недоступна',409)
      const mv=await db.from('event_movie').select('availability_status,movie_candidates(title,original_title,year,metadata)').eq('event_id',event.id).single();if(mv.error)throw mv.error;if(mv.data.availability_status!=='confirmed')return err('Сначала вручную подтвердите, что выбранный фильм доступен для показа',409)
      const schema={type:'object',additionalProperties:false,properties:{questions:{type:'array',minItems:10,maxItems:10,items:{type:'string'}}},required:['questions']}
      const out=await structuredResponse<any>({name:'predictions',schema,instructions:JIPITINA,input:`Для реально существующего фильма создай 10 проверяемых утверждений «будет / не будет». Нельзя использовать имена персонажей, прямые спойлеры, название финального твиста или формулировки, которые раскрывают исход. Утверждения должны быть однозначно проверяемы после просмотра. Фильм: ${JSON.stringify((mv.data as any).movie_candidates)}`})
      await db.from('prediction_questions').delete().eq('event_id',event.id);const ins=await db.from('prediction_questions').insert(out.questions.map((text:string,i:number)=>({event_id:event.id,position:i+1,text}))).select('*');if(ins.error)throw ins.error;await db.from('events').update({status:'PREDICTIONS_OPEN'}).eq('id',event.id);return json({ok:true,questions:ins.data})
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
      const [feedback,reviews,outputs]=await Promise.all([db.from('event_feedback').select('return_intent,strongest_part,improve_text,willingness_to_pay').eq('event_id',event.id),db.from('final_reviews').select('rating,final_sentence').eq('event_id',event.id),db.from('event_outputs').select('output_key,payload').eq('event_id',event.id)])
      const schema={type:'object',additionalProperties:false,properties:{memories:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,properties:{key:{type:'string'},text:{type:'string'}},required:['key','text']}}},required:['memories']}
      const out=await structuredResponse<any>({name:'club_memory',schema,instructions:JIPITINA,input:`Сохрани только устойчивые факты, полезные на будущих вечерах: вкусы группы, традиции/шутки, уроки формата. Не сохраняй чувствительные персональные данные. Feedback: ${JSON.stringify(feedback.data||[])} Reviews: ${JSON.stringify(reviews.data||[])} Event outputs: ${JSON.stringify(outputs.data||[])}`})
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
    }
    if(action==='ai-tiebreaker'){
      if(event.status!=='PREDICTIONS_SCORED')return err('Тай-брейк доступен только после подсчёта',409)
      const score=await db.from('event_outputs').select('payload').eq('event_id',event.id).eq('output_key','score_summary').maybeSingle();const winners=(score.data?.payload as any)?.winners||[];if(winners.length<2)return err('Ничьи за первое место нет',409)
      const schema={type:'object',additionalProperties:false,properties:{clue:{type:'string'}},required:['clue']};const out=await structuredResponse<any>({name:'tiebreaker',schema,instructions:JIPITINA,input:'Выбери широко известный фильм и максимально убого перескажи его в 2–4 коротких предложениях. Нельзя писать название, имена персонажей, актёров, режиссёра, франшизу или уникальные собственные имена. Пересказ должен быть смешным, узнаваемым, но не мгновенно очевидным.'});await db.from('event_outputs').upsert({event_id:event.id,output_key:'tiebreaker',payload:{...out,generatedAt:new Date().toISOString()},approved:true,updated_at:new Date().toISOString()});return json({ok:true,output:out})
    }
    if(action==='admin-set-winner'){
      if(event.status!=='PREDICTIONS_SCORED')return err('Победителя можно выбрать только после подсчёта',409)
      const chosen=String(body.userId||'');const top=await db.from('event_scores').select('user_id').eq('event_id',event.id).eq('rank',1);if(top.error)throw top.error;const allowed=(top.data||[]).map((x:any)=>x.user_id);if(!allowed.includes(chosen))return err('Этот участник не делит первое место',409)
      const u=await db.from('users').select('display_name,telegram_username').eq('id',chosen).single();if(u.error)throw u.error;await db.from('events').update({winner_user_id:chosen}).eq('id',event.id);const score=await db.from('event_outputs').select('payload').eq('event_id',event.id).eq('output_key','score_summary').single();if(score.error)throw score.error;const winner={userId:chosen,name:u.data.display_name||u.data.telegram_username||'участник'};await db.from('event_outputs').upsert({event_id:event.id,output_key:'score_summary',payload:{...(score.data.payload as any),tie:false,tieResolved:true,winner},approved:true,updated_at:new Date().toISOString()});await refreshLeaderboard(db,allowed);return json({ok:true,winner})
    }
    return err(`Неизвестное действие: ${action}`,404)
  }catch(e){console.error(e);return err('Что-то пошло не так. Попробуйте ещё раз.',500)}
}
