import type { CinemaProfile, DemoState, EventStatus, FilmIdea, MovieCandidate, Prediction } from './types'

export const stages: EventStatus[] = [
  'DRAFT','SALES_OPEN','CHECKIN','IDEAS_OPEN','IDEAS_LOCKED','TOP3_READY','IDEA_RANDOMIZED',
  'MOVIE_SEARCH','MOVIE_FINALISTS','MOVIE_SELECTED','PREDICTIONS_OPEN','PREDICTIONS_LOCKED',
  'WATCHING','PREDICTIONS_SCORED','DISCUSSION','FINAL_REVIEW','FEEDBACK','CLOSED'
]

export const emptyProfile:CinemaProfile={
  completed:false,onboardingStep:0,displayName:'',ageRange:'',city:'',about:'',favoriteFilms:[],favoriteGenres:[],dislikedFilm:'',lastLovedFilm:'',avoid:[],
  taste:{weirdness:50,heaviness:50,atmosphere:50,oldness:50,experimental:50,slowness:50,surrealism:50},watchReasons:[],clubGoal:'',clubWants:[],clubAvoid:'',openToMeet:false,publicProfile:false,dataConsent:false,rulesConsent:false,photoVideoConsent:null,selfGender:''
}

const ideas: FilmIdea[] = [
  {id:'idea-1',title:'лифт едет только вниз',plot:'соседи застревают в лифте, который открывается на этажах их прошлой жизни'},
  {id:'idea-2',title:'голуби отменили понедельник',plot:'город просыпается во вторник, но только голуби помнят, что случилось вчера'},
  {id:'idea-3',title:'последний автобус до моря',plot:'ночной автобус везёт незнакомцев к морю, которого нет ни на одной карте'}
]

const movies: MovieCandidate[] = [
  {id:'movie-1',title:'After Hours',year:1985,runtimeMin:97,reason:'ночная цепочка странных событий, ощущение ловушки и абсурда',score:88},
  {id:'movie-2',title:'The Exterminating Angel',year:1962,runtimeMin:95,reason:'группа людей не может покинуть пространство без очевидной причины',score:84},
  {id:'movie-3',title:'The Bothersome Man',year:2006,runtimeMin:95,reason:'сюрреалистическая реальность, правила которой никто не объясняет',score:81}
]

const predictions: Prediction[] = [
  'главный герой попытается уйти, но обстоятельства вернут его назад',
  'появится персонаж, которому нельзя до конца доверять',
  'будет хотя бы одна сцена с едой или напитком, которая станет важнее, чем кажется',
  'кто-то соврёт ради собственного спасения',
  'пространство окажется частью конфликта',
  'романтическая линия появится хотя бы на короткое время',
  'кто-то потеряет или забудет важный предмет',
  'будет момент, который сначала выглядит смешным, а потом становится тревожным',
  'финал оставит хотя бы один большой вопрос без прямого ответа',
  'последняя сцена изменит отношение к одной из предыдущих сцен'
].map((text,i)=>({id:`p-${i+1}`,position:i+1,text}))

export const initialDemoState: DemoState = {
  event: {
    id:'event-3-oct',slug:'2026-10-03',title:'НАСЫПАТЕЛИ В КИНО — 3 октября',
    startsAt:'2026-10-03T18:00:00+03:00',capacity:30,sold:7,ticketPriceRub:500,maxMovieRuntimeMin:150,status:'SALES_OPEN',paymentsAvailable:true,nonexistentFilmEnabled:false,movieAvailabilityStatus:'unchecked'
  },
  profile: structuredClone(emptyProfile), onboardingComplete:false,
  registration:'none', ideaFinalists:[], movieFinalists:[], predictions:[], predictionSubmitted:false,
  profileStats:{eventsAttended:0,predictionPoints:0,wins:0,ideasSubmitted:0},pastEvents:[],jipitinaMessages:[],
  creature:{born:false,name:'',stage:'stage_0',crumbs:0,growthProgress:0,feedingCost:1,stageThresholds:{stage_0:0,stage_1:10,stage_2:25,stage_3:50,stage_4:90},canFeedToday:true,storyCount:0,traits:{curiosity:0,argumentative:0,social:0,romantic:0,chaotic:0,cinephile:0},cosmetics:[],timeline:[]},
  dating:{enabled:false,selfGender:'',showGender:'',intents:[],paused:false},datingCards:[{userId:'demo-date-1',displayName:'маша',creatureName:'Кишка',creatureStage:'stage_2',favoriteFilms:['Суспирия','Шрек 2','Меланхолия'],favoriteGenres:['хоррор','драма'],taste:{weirdness:78,heaviness:62,atmosphere:84,oldness:55,experimental:73,slowness:66,surrealism:81},matchNote:'вы оба любите Суспирию, но она зачем-то поставила Титанику 3',compatibility:84}],datingMatches:[],
  notificationPrefs:{writeAccess:false,events:true,creature:true,stories:true,matches:true,tickets:true,reminders:true,quietHours:true},
  creatureTaskCompletions:{},
  leaderboard:[
    {name:'аня',points:18,wins:1,events:2},
    {name:'ваня',points:16,wins:0,events:2},
    {name:'саша',points:9,wins:0,events:1}
  ]
}

const KEY='nasypateli-cinema-demo-v3'

function feedDayKey(value:unknown){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value as any))}
  catch{return ''}
}

function normalizeLegacyCreatureStage(stage:unknown):DemoState['creature']['stage']{
  const value=String(stage||'')
  if(['stage_0','stage_1','stage_2','stage_3','stage_4'].includes(value))return value as DemoState['creature']['stage']
  if(value==='grown')return 'stage_4'
  if(value==='young')return 'stage_2'
  return 'stage_0'
}

export function loadDemo():DemoState {
  try {
    const raw=localStorage.getItem(KEY)
    if(!raw)return structuredClone(initialDemoState)
    const parsed=JSON.parse(raw)
    const base=structuredClone(initialDemoState)
    const lastFedAt=parsed.creature?.lastFedAt
    const canFeedToday=!lastFedAt||feedDayKey(lastFedAt)!==feedDayKey(new Date())
    return {...base,...parsed,profile:{...structuredClone(emptyProfile),...(parsed.profile||{}),taste:{...emptyProfile.taste,...(parsed.profile?.taste||{})}},creature:{...base.creature,...(parsed.creature||{}),stage:normalizeLegacyCreatureStage(parsed.creature?.stage),feedingCost:Math.max(1,Number(parsed.creature?.feedingCost||1)),stageThresholds:{...base.creature.stageThresholds,...(parsed.creature?.stageThresholds||{})},canFeedToday}}
  } catch { return structuredClone(initialDemoState) }
}

export function saveDemo(state:DemoState){ localStorage.setItem(KEY,JSON.stringify(state)) }
export function resetDemo(){ localStorage.removeItem(KEY) }

export function applyStageData(state:DemoState,status:EventStatus):DemoState {
  const next=structuredClone(state)
  next.event.status=status
  if (stages.indexOf(status)>=stages.indexOf('TOP3_READY')) next.ideaFinalists=ideas
  if (stages.indexOf(status)>=stages.indexOf('IDEA_RANDOMIZED')) next.selectedIdea=ideas[2]
  if (stages.indexOf(status)>=stages.indexOf('MOVIE_FINALISTS')) next.movieFinalists=movies
  if (stages.indexOf(status)>=stages.indexOf('MOVIE_SELECTED')) { next.selectedMovie=movies[1]; if(status==='MOVIE_SELECTED') next.event.movieAvailabilityStatus='unchecked' }
  if (stages.indexOf(status)>=stages.indexOf('PREDICTIONS_OPEN')) next.predictions=predictions
  return next
}
