import type { CinemaProfile, DemoState, EventStatus, JipitinaMessage, PostFilmReaction } from '../types'
import { applyStageData, emptyProfile, initialDemoState, loadDemo, saveDemo } from '../demo'
import { telegramInitData, telegramWebApp } from './telegram'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const fn = (import.meta.env.VITE_API_FUNCTION as string | undefined) || 'app'
export const demoMode = import.meta.env.VITE_DEMO_MODE !== 'false' || !supabaseUrl

function normalizeCreatureStage(stage:unknown):DemoState['creature']['stage']{
  const value=String(stage||'')
  if(['stage_0','stage_1','stage_2','stage_3','stage_4'].includes(value))return value as DemoState['creature']['stage']
  if(value==='grown')return 'stage_4'
  if(value==='young')return 'stage_2'
  return 'stage_0'
}
function notifyDemo(){ window.dispatchEvent(new CustomEvent('nasypateli-demo-change')) }

function requestTimeoutMs(action:string){
  if(action==='audio-transcribe')return 30000
  if(action==='jipitina-chat')return 25000
  if(action.startsWith('ai-')||action==='admin-research-summary')return 60000
  if(action==='bootstrap'||action.endsWith('-bootstrap'))return 10000
  return 15000
}

async function requestApi<T=unknown>(action:string,payload:Record<string,unknown>={},extraHeaders:Record<string,string>={}):Promise<T>{
  if(demoMode) return demoAction(action,payload) as T
  const controller=new AbortController()
  const timeout=window.setTimeout(()=>controller.abort(),requestTimeoutMs(action))
  try{
    const res=await fetch(`${supabaseUrl}/functions/v1/${fn}`,{
      method:'POST',
      headers:{'content-type':'application/json','x-telegram-init-data':telegramInitData(),...extraHeaders},
      body:JSON.stringify({action,...payload}),
      signal:controller.signal
    })
    const data=await res.json().catch(()=>({error:'сервер вернул непонятный ответ'}))
    if(!res.ok) throw new Error(data.error || `ошибка сервера: ${res.status}`)
    return data as T
  }catch(e:any){
    if(e?.name==='AbortError') throw new Error('сервер отвечает слишком долго. попробуйте ещё раз')
    throw e
  }finally{window.clearTimeout(timeout)}
}

function normalizeBootstrap(raw:any):DemoState{
  const r=raw&&typeof raw==='object'?raw:{}
  const base=initialDemoState
  const rp=r.profile&&typeof r.profile==='object'?r.profile:{}
  const rc=r.creature&&typeof r.creature==='object'?r.creature:{}
  const rd=r.dating&&typeof r.dating==='object'?r.dating:{}
  const rn=r.notificationPrefs&&typeof r.notificationPrefs==='object'?r.notificationPrefs:{}
  const re=r.event&&typeof r.event==='object'?r.event:{}
  return {
    ...base,...r,
    event:{...base.event,...re},
    profile:{...emptyProfile,...rp,taste:{...emptyProfile.taste,...(rp.taste||{})},favoriteFilms:Array.isArray(rp.favoriteFilms)?rp.favoriteFilms:[],favoriteGenres:Array.isArray(rp.favoriteGenres)?rp.favoriteGenres:[],avoid:Array.isArray(rp.avoid)?rp.avoid:[],watchReasons:Array.isArray(rp.watchReasons)?rp.watchReasons:[],clubWants:Array.isArray(rp.clubWants)?rp.clubWants:[]},
    onboardingComplete:r.onboardingComplete===true,
    registration:['none','reserved','paid','attended','waitlist','refunded'].includes(r.registration)?r.registration:'none',
    ideaFinalists:Array.isArray(r.ideaFinalists)?r.ideaFinalists:[],movieFinalists:Array.isArray(r.movieFinalists)?r.movieFinalists:[],predictions:Array.isArray(r.predictions)?r.predictions:[],leaderboard:Array.isArray(r.leaderboard)?r.leaderboard:[],pastEvents:Array.isArray(r.pastEvents)?r.pastEvents:[],jipitinaMessages:Array.isArray(r.jipitinaMessages)?r.jipitinaMessages:[],
    profileStats:{...base.profileStats,...(r.profileStats||{})},
    creature:{...base.creature,...rc,stage:normalizeCreatureStage(rc.stage),feedingCost:Math.max(1,Number(rc.feedingCost||base.creature.feedingCost||1)),canFeedToday:rc.canFeedToday!==false,traits:{...base.creature.traits,...(rc.traits||{})},cosmetics:Array.isArray(rc.cosmetics)?rc.cosmetics:[],timeline:Array.isArray(rc.timeline)?rc.timeline:[]},
    dating:{...base.dating,...rd,intents:Array.isArray(rd.intents)?rd.intents:[]},datingCards:Array.isArray(r.datingCards)?r.datingCards:[],datingMatches:Array.isArray(r.datingMatches)?r.datingMatches:[],
    notificationPrefs:{...base.notificationPrefs,...rn},outputs:r.outputs&&typeof r.outputs==='object'?r.outputs:{},outputApprovals:r.outputApprovals&&typeof r.outputApprovals==='object'?r.outputApprovals:{}
  } as DemoState
}

let bootstrapInFlight:Promise<unknown>|null=null
let bootstrapCache:{at:number;value:unknown}|null=null
export async function callApi<T=unknown>(action:string,payload:Record<string,unknown>={}):Promise<T>{
  if(action==='bootstrap'){
    const now=Date.now()
    if(bootstrapCache&&now-bootstrapCache.at<15000)return bootstrapCache.value as T
    if(bootstrapInFlight)return bootstrapInFlight as Promise<T>
    bootstrapInFlight=requestApi<any>(action,payload).then(value=>{const normalized=normalizeBootstrap(value);bootstrapCache={at:Date.now(),value:normalized};return normalized}).finally(()=>{bootstrapInFlight=null})
    return bootstrapInFlight as Promise<T>
  }
  const result=await requestApi<T>(action,payload)
  bootstrapCache=null
  return result
}

export async function callAdminApi<T=unknown>(action:string,payload:Record<string,unknown>={},token=''):Promise<T>{
  return requestApi<T>(action,payload,token?{'x-admin-token':token}:{})
}

export async function callScreenApi<T=unknown>(action:string,payload:Record<string,unknown>={},token=''):Promise<T>{
  return requestApi<T>(action,payload,token?{'x-screen-token':token}:{})
}

function mutate(mutator:(s:DemoState)=>DemoState){
  const next=mutator(loadDemo()); saveDemo(next); notifyDemo(); return next
}

function demoReply(message:string,mode:string):string{
  const m=message.toLowerCase()
  if(mode==='idea_coach'){
    if(m.includes('нет идеи')||m.includes('придум')) return 'давай не начинать с сюжета. выбери одну штуку, которая в обычном мире невозможна, но в фильме считается нормой. например: у людей исчезают имена после полуночи. что тебе ближе — правило мира, странное место или странный человек?'
    return 'в черновике уже есть ядро. я бы пока не добавляла событий, а уточнила одно правило: что здесь невозможно отменить или избежать? это даст идее собственную логику.'
  }
  if(mode==='post_film') return 'ты ожидала более жанровую историю, а оценка всё равно высокая. что сработало сильнее ожиданий: атмосфера, устройство мира или люди внутри него?'
  return 'я здесь. могу разобрать твой вкус, помочь придумать идею для вечера или поговорить про то, что мы уже смотрели.'
}

type growthStage=DemoState['creature']['stage']
function demoAction(action:string,payload:Record<string,unknown>){
  switch(action){
    case 'bootstrap': return loadDemo()
    case 'admin-bootstrap': return loadDemo()
    case 'screen-bootstrap': return loadDemo()
    case 'save-profile-progress': return mutate(s=>({...s,profile:{...s.profile,...(payload.profile as Partial<CinemaProfile>),onboardingStep:Number(payload.step)||s.profile.onboardingStep}}))
    case 'save-profile': return mutate(s=>({...s,profile:{...(payload.profile as CinemaProfile),completed:true,completedAt:new Date().toISOString()},onboardingComplete:true}))
    case 'participant-birth-v2':
    case 'birth-creature': {
      const current=loadDemo()
      if(current.creature.born)return {ok:true,alreadyBorn:true,creature:current.creature}
      const next=mutate(s=>({...s,creature:{...s.creature,born:true,bornAt:new Date().toISOString(),name:String(payload.name||'Животина'),stage:'stage_0',crumbs:s.creature.crumbs,growthProgress:s.creature.growthProgress||0,feedingCost:s.creature.feedingCost||1,canFeedToday:s.creature.canFeedToday!==false}}))
      return {ok:true,alreadyBorn:false,creature:next.creature}
    }
    case 'creature-tasks': {
      const s=loadDemo();const completed=s.creatureTaskCompletions?.first_test_task
      return {ok:true,tasks:[{id:'first_test_task',title:'первая крошка',description:'тестовое задание для первого вертикального среза Животины',rewardCrumbs:3,completionType:'manual',status:completed?'completed':'available',completedAt:completed||undefined}]}
    }
    case 'complete-creature-task': {
      if(String(payload.taskId||'')!=='first_test_task')throw new Error('task_unavailable')
      const s=loadDemo();const completed=s.creatureTaskCompletions?.first_test_task
      if(completed)return {ok:true,alreadyCompleted:true,crumbs:s.creature.crumbs,creature:s.creature}
      const at=new Date().toISOString()
      const next=mutate(v=>({...v,creature:{...v.creature,crumbs:v.creature.crumbs+3},creatureTaskCompletions:{...(v.creatureTaskCompletions||{}),first_test_task:at}}))
      return {ok:true,alreadyCompleted:false,rewardCrumbs:3,crumbs:next.creature.crumbs,creature:next.creature}
    }
    case 'feed-creature': {
      const s=loadDemo();const cost=Math.max(1,Number(s.creature.feedingCost||1))
      if(!s.creature.canFeedToday)return {ok:true,alreadyFed:true,crumbs:s.creature.crumbs,growthProgress:s.creature.growthProgress,stage:s.creature.stage,creature:s.creature}
      if(s.creature.crumbs<cost)throw new Error('not_enough_crumbs')
      const growth=s.creature.growthProgress+3
      const stage:growthStage = growth>=90?'stage_4':growth>=50?'stage_3':growth>=25?'stage_2':growth>=10?'stage_1':'stage_0'
      const next=mutate(v=>({...v,creature:{...v.creature,crumbs:v.creature.crumbs-cost,growthProgress:growth,stage,lastFedAt:new Date().toISOString(),canFeedToday:false}}))
      return {ok:true,alreadyFed:false,cost,crumbs:next.creature.crumbs,growthProgress:growth,stage,lastFedAt:next.creature.lastFedAt,creature:next.creature}
    }
    case 'equip-cosmetic': return mutate(s=>({...s,creature:{...s.creature,cosmetics:s.creature.cosmetics.map(x=>x.code===payload.code?{...x,equipped:payload.equipped===true}:x)}}))
    case 'save-dating-profile': return mutate(s=>({...s,dating:{...s.dating,...(payload.dating as any)}}))
    case 'dating-swipe': return mutate(s=>({...s,datingCards:s.datingCards.filter(x=>x.userId!==payload.targetUserId),datingMatches:payload.direction==='like'?[...s.datingMatches,{id:`m-${Date.now()}`,kind:'cinema',displayName:'маша',creatureName:'Кишка',createdAt:new Date().toISOString()}]:s.datingMatches}))
    case 'dating-hide-connection': return mutate(s=>({...s,datingMatches:s.datingMatches.filter(x=>x.id!==payload.connectionId)}))
    case 'save-notification-prefs': return mutate(s=>({...s,notificationPrefs:{...s.notificationPrefs,...(payload.prefs as any)}}))
    case 'my-encounter-token': return {ok:true,token:'demo-encounter-token',deepLink:'https://t.me/nasipateli_v_kinobot?start=encounter_demo-encounter-token'}
    case 'encounter': return {ok:true,kind:'rabbit',sharedFavorites:1,sharedGenres:1}
    case 'audio-transcribe': return {ok:true,text:'демо голосового ввода'}
    case 'delete-profile': localStorage.clear(); notifyDemo(); return {ok:true}
    case 'reserve-ticket': return mutate(s=>({...s,registration:s.event.sold>=s.event.capacity?'waitlist':'paid',event:{...s.event,sold:s.event.sold+(s.event.sold<s.event.capacity?1:0)}}))
    case 'submit-idea': return mutate(s=>({...s,idea:{id:'mine',title:String(payload.title||''),plot:String(payload.plot||'')}}))
    case 'submit-predictions': return mutate(s=>({...s,predictions:(payload.predictions as DemoState['predictions'])||s.predictions,predictionSubmitted:true}))
    case 'submit-reaction': return mutate(s=>({...s,reaction:payload.reaction as PostFilmReaction,thought:(payload.reaction as PostFilmReaction)?.thought}))
    case 'submit-thought': return mutate(s=>({...s,thought:String(payload.text||'')}))
    case 'submit-review': return mutate(s=>({...s,review:{rating:Number(payload.rating),sentence:String(payload.sentence||'')}}))
    case 'submit-feedback': return mutate(s=>({...s,feedback:payload.feedback as DemoState['feedback']}))
    case 'jipitina-chat': return mutate(s=>{
      const text=String(payload.message||'');const mode=String(payload.mode||'general');const now=new Date().toISOString();
      const userMsg:JipitinaMessage={id:`u-${Date.now()}`,role:'user',text,mode,createdAt:now}
      const assistant:JipitinaMessage={id:`a-${Date.now()}`,role:'assistant',text:demoReply(text,mode),mode,createdAt:new Date().toISOString()}
      return {...s,jipitinaMessages:[...(s.jipitinaMessages||[]),userMsg,assistant].slice(-30)}
    })
    case 'admin-stage': return mutate(s=>applyStageData(s,payload.status as EventStatus))
    case 'admin-set-mechanic': return mutate(s=>({...s,event:{...s.event,nonexistentFilmEnabled:!!payload.enabled}}))
    case 'admin-event-config': return mutate(s=>({...s,event:{...s.event,startsAt:String(payload.startsAt||s.event.startsAt),ticketPriceRub:Number(payload.ticketPriceRub??s.event.ticketPriceRub),maxMovieRuntimeMin:Number(payload.maxMovieRuntimeMin??s.event.maxMovieRuntimeMin),venueName:String(payload.venueName||''),venueAddress:String(payload.venueAddress||'')}}))
    case 'admin-capacity': return mutate(s=>({...s,event:{...s.event,capacity:Number(payload.capacity)||30}}))
    case 'admin-screen-message': return mutate(s=>({...s,screenMessage:String(payload.message||'')}))
    case 'admin-export-event': {const s=loadDemo();return {ok:true,event:{id:s.event.id,slug:s.event.slug,title:s.event.title,startsAt:s.event.startsAt,status:s.event.status,capacity:s.event.capacity,ticketPriceRub:s.event.ticketPriceRub},exportedAt:new Date().toISOString(),rows:[{userId:'demo-user',displayName:s.profile.displayName||'демо участник',telegramUsername:'@demo',status:s.registration,amountRub:s.event.ticketPriceRub,photoVideoConsent:s.profile.photoVideoConsent===true,ageRange:s.profile.ageRange,city:s.profile.city,favoriteFilms:s.profile.favoriteFilms,favoriteGenres:s.profile.favoriteGenres,ideasSubmitted:s.idea?1:0,predictionCorrect:null,predictionTotal:null,predictionPoints:null,predictionRank:null,returnIntent:s.feedback?.returnIntent||'',willingnessToPayRub:s.feedback?.willingness||null,durationFeel:s.feedback?.durationFeel||'',inviteFriend:s.feedback?.inviteFriend||null,strongestPart:s.feedback?.strongest||'',improveText:s.feedback?.improve||''}]}}
    case 'admin-approve-output': return mutate(s=>({...s,outputApprovals:{...(s.outputApprovals||{}),[String(payload.outputKey||'')]:true}}))
    case 'admin-reveal-idea-author': return mutate(s=>({...s,selectedIdea:s.selectedIdea?{...s.selectedIdea,author:'@demo_author'}:s.selectedIdea}))
    case 'ai-select-ideas': return mutate(s=>applyStageData(s,'TOP3_READY'))
    case 'draw-idea': return mutate(s=>applyStageData(s,'IDEA_RANDOMIZED'))
    case 'ai-find-movies': return mutate(s=>applyStageData(s,'MOVIE_FINALISTS'))
    case 'draw-movie': return mutate(s=>applyStageData(s,'MOVIE_SELECTED'))
    case 'admin-confirm-movie-availability': return mutate(s=>({...s,event:{...s.event,movieAvailabilityStatus:'confirmed'}}))
    case 'admin-redraw-movie': return mutate(s=>{const candidates=s.movieFinalists.filter(x=>x.id!==s.selectedMovie?.id);return {...s,selectedMovie:candidates[0]||s.selectedMovie,event:{...s.event,movieAvailabilityStatus:'unchecked'}}})
    case 'ai-generate-predictions': return mutate(s=>applyStageData({...s,event:{...s.event,movieAvailabilityStatus:'confirmed'}},'PREDICTIONS_OPEN'))
    case 'ai-post-film-synthesis': return mutate(s=>({...s,outputs:{...(s.outputs||{}),post_film_synthesis:{consensus:'все увидели фильм по-разному, но почти все зацепились за ощущение ловушки',disagreements:'часть группы считает героя пассивным, часть — единственным рациональным человеком',jipitinaTake:'мне кажется, вы спорите не о герое, а о том, насколько сами готовы принять абсурдные правила мира'}}}))
    case 'ai-collective-review': return mutate(s=>({...s,outputs:{...(s.outputs||{}),collective_review:{intro:'первый фильм клуба оказался одновременно смешнее и тревожнее, чем мы прогнозировали',averageRating:7.6,sentences:[s.review?.sentence||'демо-фраза участника']}}}))
    case 'ai-finalize-memory': return mutate(s=>({...s,outputs:{...(s.outputs||{}),memory_saved:{ok:true}}}))
    case 'admin-research-summary': return mutate(s=>({...s,outputs:{...(s.outputs||{}),research_summary:{responses:24,returnIntentPositivePct:79.2,averageWillingnessRub:1038,nps:42,duration:{коротко:1,нормально:19,долго:4},strongest:['рандом и ощущение, что никто не знает фильм'],improvements:['быстрее начать просмотр']}}}))
    case 'admin-score-predictions': return mutate(s=>({...s,event:{...s.event,status:'PREDICTIONS_SCORED'},outputs:{...(s.outputs||{}),score_summary:{tie:true,winners:[{userId:'demo-1',name:'аня',correct:8,total:10,points:8,rank:1},{userId:'demo-2',name:'ваня',correct:8,total:10,points:8,rank:1}],scores:[{userId:'demo-1',name:'аня',correct:8,total:10,points:8,rank:1},{userId:'demo-2',name:'ваня',correct:8,total:10,points:8,rank:1},{userId:'demo-3',name:'саша',correct:6,total:10,points:6,rank:3}]}}}))
    case 'ai-tiebreaker': return mutate(s=>({...s,outputs:{...(s.outputs||{}),tiebreaker:{clue:'мужик очень долго пытается вернуть украшение владельцу, но все вокруг почему-то считают, что проще было бы его выбросить в вулкан'}}}))
    case 'admin-set-winner': return mutate(s=>{const score:any=s.outputs?.score_summary||{};const winner=(score.winners||[]).find((x:any)=>x.userId===payload.userId)||{userId:String(payload.userId||''),name:'победитель'};return {...s,outputs:{...(s.outputs||{}),score_summary:{...score,tie:false,tieResolved:true,winner}}}})
    case 'reset-demo': localStorage.clear(); notifyDemo(); return structuredClone(initialDemoState)
    default: throw new Error(`Unknown demo action: ${action}`)
  }
}

export async function buyTicket(slug:string){
  if(demoMode) return callApi('reserve-ticket',{slug})
  const controller=new AbortController()
  const timeout=window.setTimeout(()=>controller.abort(),15000)
  try{
    const res=await fetch(`${supabaseUrl}/functions/v1/${fn}?mode=invoice`,{
      method:'POST',headers:{'content-type':'application/json','x-telegram-init-data':telegramInitData()},body:JSON.stringify({slug}),signal:controller.signal
    })
    const data=await res.json().catch(()=>({error:'сервер оплаты вернул пустой ответ'}))
    if(res.status===409 && data.waitlist) return data
    if(!res.ok) throw new Error(data.error||`ошибка оплаты: ${res.status}`)
    if(data.invoiceUrl){
      const app=telegramWebApp()
      if(app?.openInvoice){
        const invoiceStatus=await new Promise<string>(resolve=>{
          try{app.openInvoice?.(data.invoiceUrl,(status:string)=>resolve(status||'closed'))}
          catch{resolve('failed')}
        })
        return {...data,invoiceStatus}
      }
      location.href=data.invoiceUrl
    }
    return data
  }catch(e:any){
    if(e?.name==='AbortError')throw new Error('оплата отвечает слишком долго. попробуйте ещё раз')
    throw e
  }finally{bootstrapCache=null;window.clearTimeout(timeout)}
}
