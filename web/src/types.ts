export type EventStatus =
  | 'DRAFT'|'SALES_OPEN'|'CHECKIN'|'IDEAS_OPEN'|'IDEAS_LOCKED'|'TOP3_READY'|'IDEA_RANDOMIZED'
  | 'MOVIE_SEARCH'|'MOVIE_FINALISTS'|'MOVIE_SELECTED'|'PREDICTIONS_OPEN'|'PREDICTIONS_LOCKED'
  | 'WATCHING'|'PREDICTIONS_SCORED'|'DISCUSSION'|'FINAL_REVIEW'|'FEEDBACK'|'CLOSED'

export type TasteVector = {
  weirdness:number
  heaviness:number
  atmosphere:number
  oldness:number
  experimental:number
  slowness:number
  surrealism:number
}

export type CinemaProfile = {
  completed:boolean
  completedAt?:string
  onboardingStep:number
  displayName:string
  ageRange:string
  city:string
  about:string
  telegramPhotoUrl?:string
  favoriteFilms:string[]
  favoriteGenres:string[]
  dislikedFilm:string
  lastLovedFilm:string
  avoid:string[]
  taste:TasteVector
  watchReasons:string[]
  clubGoal:'cinema'|'people'|'both'|''
  clubWants:string[]
  clubAvoid:string
  openToMeet:boolean
  publicProfile:boolean
  dataConsent:boolean
  rulesConsent:boolean
  photoVideoConsent:boolean|null
  selfGender:'woman'|'man'|''
}

export type EventInfo = {
  id: string
  slug: string
  title: string
  startsAt: string
  capacity: number
  sold: number
  ticketPriceRub: number
  maxMovieRuntimeMin: number
  status: EventStatus
  venueName?: string
  venueAddress?: string
  nonexistentFilmEnabled:boolean
  movieAvailabilityStatus?:'unchecked'|'confirmed'|'unavailable'
}

export type FilmIdea = { id:string; title:string; plot:string; author?:string }
export type MovieCandidate = { id:string; title:string; year?:number; runtimeMin?:number; reason?:string; score?:number }
export type Prediction = { id:string; position:number; text:string; answer?:boolean; actual?:boolean }
export type LeaderRow = { name:string; points:number; wins:number; events:number }
export type JipitinaMessage = { id:string; role:'user'|'assistant'; text:string; mode:string; createdAt:string }
export type PostFilmReaction = {rating:number;stateWord:string;thought:string;recommendation:'yes'|'no'|'depends'|''}
export type ClubEvent = {id:string;slug:string;title:string;startsAt:string;movie?:{title:string;year?:number};review?:Record<string,unknown>}
export type ProfileStats = {eventsAttended:number;predictionPoints:number;wins:number;ideasSubmitted:number}

export type CreatureTrait = 'curiosity'|'argumentative'|'social'|'romantic'|'chaotic'|'cinephile'
export type CreatureCosmetic = {
  code:string
  name:string
  slot:string
  rarity:'common'|'uncommon'|'rare'|'legendary'|'mythic'
  visual?:Record<string,unknown>
  equipped:boolean
}
export type StoryMoment = {
  id:string
  code:string
  title:string
  description:string
  category:string
  rarity:string
  happenedAt:string
  eventTitle?:string
  secret?:boolean
  rewardName?:string
}
export type CreatureState = {
  born:boolean
  bornAt?:string
  name:string
  stage:'tiny'|'young'|'grown'
  crumbs:number
  storyCount:number
  traits:Record<CreatureTrait,number>
  cosmetics:CreatureCosmetic[]
  timeline:StoryMoment[]
}

export type DatingIntent = 'friends'|'cinema_company'|'chat'|'dates'|'anything'
export type DatingProfile = {
  enabled:boolean
  selfGender:'woman'|'man'|''
  showGender:'women'|'men'|'all'|''
  intents:DatingIntent[]
  paused:boolean
}
export type DatingCard = {
  userId:string
  displayName:string
  creatureName:string
  creatureStage:CreatureState['stage']
  favoriteFilms:string[]
  favoriteGenres:string[]
  taste:TasteVector
  matchNote:string
  compatibility?:number
}
export type DatingMatch = {
  id:string
  kind:'friend'|'cinema'|'romantic'
  displayName:string
  creatureName:string
  createdAt:string
  sharedFilms?:string[]
}

export type NotificationPrefs = {
  writeAccess:boolean
  events:boolean
  creature:boolean
  stories:boolean
  matches:boolean
  tickets:boolean
  reminders:boolean
  quietHours:boolean
}

export type DemoState = {
  event: EventInfo
  profile: CinemaProfile
  onboardingComplete:boolean
  registration: 'none'|'reserved'|'paid'|'attended'|'waitlist'|'refunded'
  idea?: FilmIdea
  ideaFinalists: FilmIdea[]
  selectedIdea?: FilmIdea
  movieFinalists: MovieCandidate[]
  selectedMovie?: MovieCandidate
  predictions: Prediction[]
  predictionSubmitted: boolean
  thought?: string
  reaction?:PostFilmReaction
  review?: {rating:number; sentence:string}
  feedback?: {returnIntent:string; strongest:string; improve:string; willingness:number; durationFeel?:string; inviteFriend?:number}
  leaderboard: LeaderRow[]
  profileStats:ProfileStats
  pastEvents:ClubEvent[]
  jipitinaMessages:JipitinaMessage[]
  creature:CreatureState
  dating:DatingProfile
  datingCards:DatingCard[]
  datingMatches:DatingMatch[]
  notificationPrefs:NotificationPrefs
  screenMessage?: string
  outputs?: Record<string, unknown>
  outputApprovals?: Record<string,boolean>
}
