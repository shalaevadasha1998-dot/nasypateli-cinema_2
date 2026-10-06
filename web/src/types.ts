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
  held?: number
  ticketPriceRub: number
  maxMovieRuntimeMin: number
  status: EventStatus
  venueName?: string
  venueAddress?: string
  paymentsAvailable:boolean
  nonexistentFilmEnabled:boolean
  movieAvailabilityStatus?:'unchecked'|'confirmed'|'unavailable'
}

export type FilmIdea = { id:string; title:string; plot:string; author?:string }
export type MovieSourceCandidate = {
  id:string
  useMode:'fragment'|'trailer'
  sourceType:'clip'|'full_film'|'trailer'|'teaser'|'unknown'
  sourcePlatform:string
  sourceUrl:string
  videoId?:string
  title?:string
  sourceChannel?:string
  startSec:number
  endSec?:number
  verified:boolean
  embeddable:boolean
  official:boolean
  rightsStatus:'unknown'|'allowed'|'restricted'|'blocked'
  availabilityStatus:'candidate'|'ready'|'dead'|'blocked'
  confidence:number
  discoveredAt?:string
  selected?:boolean
  manualSelected?:boolean
}

export type MovieCandidate = {
  id:string
  title:string
  originalTitle?:string
  year?:number
  runtimeMin?:number
  genre?:string
  country?:string
  reason?:string
  score?:number
  enabledForEvent?:boolean
  trailerStatus?:string
  clipStatus?:string
  sourceType?:string
  sourcePlatform?:string
  sourceUrl?:string
  videoId?:string
  startSec?:number
  endSec?:number
  sourceChannel?:string
  sourceVerified?:boolean
  verifiedAt?:string
  usageStatus?:string
  discussionPrompts?:unknown[]
  animalComment?:string
  tags?:string[]
  sourceCandidates?:MovieSourceCandidate[]
}
export type Prediction = { id:string; position:number; text:string; answer?:boolean; actual?:boolean }
export type LeaderRow = { name:string; points:number; wins:number; events:number }
export type JipitinaMessage = { id:string; role:'user'|'assistant'; text:string; mode:string; createdAt:string; requestId?:string; deliveryStatus?:'pending'|'completed'|'failed' }
export type PostFilmReaction = {rating:number;stateWord:string;thought:string;recommendation:'yes'|'no'|'depends'|''}
export type CollectiveReview = {intro?:string;caption?:string;averageRating?:number;sentences?:string[]}
export type ClubEvent = {id:string;slug:string;title:string;startsAt:string;movie?:{title:string;year?:number};review?:CollectiveReview;prediction?:{correct:number;total:number;points:number;rank:number};myReview?:{rating:number;sentence:string}}
export type ProfileStats = {eventsAttended:number;predictionPoints:number;wins:number;ideasSubmitted:number}
export type AdminParticipant = {
  registrationId:string
  displayName:string
  telegramUsername?:string
  creatureName?:string
  deleted?:boolean
  profileComplete:boolean
  onboardingStep:number
  status:'reserved'|'paid'|'attended'|'waitlist'|'refunded'|'cancelled'|'no_show'
  queuePosition?:number
  reservationExpiresAt?:string
  photoVideoConsent:boolean
  paidAt?:string
  registeredAt:string
}

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
  visualVariant?:number
  stage:'stage_0'|'stage_1'|'stage_2'|'stage_3'|'stage_4'
  crumbs:number
  growthProgress:number
  lastFedAt?:string
  feedingCost:number
  stageThresholds:Record<'stage_0'|'stage_1'|'stage_2'|'stage_3'|'stage_4',number>
  canFeedToday:boolean
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
  userId:string
  kind:'friend'|'cinema'|'romantic'
  displayName:string
  telegramUsername?:string
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

export type ProgramBlock = {
  id:string
  type:string
  title:string
  durationMin:number
  roundsTarget:number
  autoAdvance:boolean
  audioPlaylist:string[]
  audioVolume:number
  index:number
}

export type EventProgram = {
  version:number
  roundsTarget:number
  rewards:{join:number;vote:number;round:number;finale:number}
  blocks:ProgramBlock[]
}

export type ShowRound = {
  id:string
  roundNo:number
  blockId:string
  status:'draft'|'active'|'closed'|'skipped'
  flowStatus?:'draft'|'round_intro'|'collecting_films'|'films_locked'|'randomizing_submission'|'submission_selected'|'searching_movie'|'movie_found'|'playing_clip'|'one_word_collecting'|'one_word_results'|'generating_question'|'question_open'|'question_results'|'question_reveal'|'next_question'|'assignment_randomizing'|'assignment_selected'|'round_finished'
  selectedSubmissionId?:string
  selectedPitch?:{id:string;animalName:string;title:string;description:string}
  pitchCount?:number
  questionPosition?:number
  questionTarget?:number
  movie?:MovieCandidate
  question?:any
  voteState:'closed'|'open'
  resultsVisible:boolean
  videoState:Record<string,unknown>
  startedAt?:string
  updatedAt?:string
  closedAt?:string
}

export type EventRuntime = {
  runId?:string
  runKey?:string
  runMode?:'test'|'live'
  isTest?:boolean
  runStatus:'idle'|'running'|'paused'|'finished'
  currentBlockId:string
  currentBlockIndex:number
  currentBlock?:ProgramBlock
  currentRound:number
  currentBlockRoundCount?:number
  currentRoundId?:string
  currentMovie?:MovieCandidate
  currentQuestion?:any
  voteState:'closed'|'open'
  resultsVisible:boolean
  videoState:Record<string,unknown>
  revision:number
  startedAt?:string
  blockStartedAt?:string
  pausedAt?:string
  updatedAt?:string
}

export type ShowAudioAsset={key:string;title:string;category:string;mimeType:string;durationSec:number;url:string}
export type ShowAudioState={mode:'auto'|'manual';status:'playing'|'paused'|'stopped';track_key?:string|null;playlist_index?:number;volume?:number;updated_at?:string}
export type ShowAudioScreen={unlocked:boolean;online:boolean;lastSeenAt?:string;testNonce?:string;testAssetKey?:string}
export type FinalVoteOption={id:string;title:string;year?:number;genre?:string;count:number}
export type FinalVoteState={options:FinalVoteOption[];totalVotes:number;winners:FinalVoteOption[];closed:boolean;myVote?:string}
export type ShowState = {
  program:EventProgram
  runtime:EventRuntime
  currentRound?:ShowRound
  voteResults:{answer:any;count:number}[]
  finalVote?:FinalVoteState
  onlineCount:number
  myVote?:any
  audio?:{state:ShowAudioState;assets:ShowAudioAsset[];screen?:ShowAudioScreen}
}

export type ScreenCreature = {
  id:string
  name:string
  visualVariant?:number
  stage:CreatureState['stage']
  crumbs:number
  growthProgress:number
}

export type FilmProjectorState =
  | 'idle'|'arrival'|'round_intro'|'pitch_collecting'|'pitch_locked'|'pitch_preview'|'pitch_randomizing'|'pitch_selected'|'movie_searching'|'movie_found'|'playing_clip'
  | 'film_intro'|'one_word_collecting'|'one_word_results'
  | 'question_open'|'question_results'|'question_reveal'|'round_finished'
  | 'assignment_randomizing'|'assignment_winner'|'past_review_card'

export type FilmMission = {
  id:string
  filmPackageId:string
  filmTitle:string
  status:'assigned'|'watching'|'watched'|'review_in_progress'|'review_ready'|'submitted'|'approved'|'changes_requested'|'published'|'overdue'
  assignedAt:string
  dueAt:string
  daysLeft:number
  beforeWord:string
  afterWord?:string
  correctCount:number
  totalQuestions:number
  watchedAt?:string
  submittedAt?:string
}

export type FilmLiveState = {
  state:FilmProjectorState
  revision:number
  roundId?:string
  filmPackageId?:string
  filmTitle?:string
  payload:Record<string,any>
  myWord?:string
  myPitch?:{id:string;title:string;description:string;updatedAt:string}
  questionTarget?:number
  myAnswers:{question_id:string;answer:any;is_correct:boolean}[]
}

export type FilmPackageAdmin = {
  id:string
  movieCandidateId:string
  title:string
  fragments:any[]
  status:string
  questions:{id:string;position:number;prompt:string;options:any[];correctAnswer:any;revealText:string;revealFragment:any}[]
}

export type ReviewQueueItem = {
  assignmentId:string
  animalName:string
  filmTitle:string
  assignedAt:string
  dueAt:string
  assignmentStatus:string
  beforeWord:string
  afterWord?:string
  correctCount:number
  totalQuestions:number
  oldPredictions?:{position:number;prompt:string;answer:any;isCorrect:boolean;correctAnswer:any;revealText:string}[]
  reviewId?:string
  reviewStatus?:string
  submittedAt?:string
  snapshot?:Record<string,any>
  adminComment?:string
  user:{displayName:string;telegramUsername:string}
}

export type ProjectorState = {
  state:FilmProjectorState
  revision:number
  payload:Record<string,any>
  updatedAt?:string
}

export type DemoState = {
  isAdmin?:boolean
  event: EventInfo
  profile: CinemaProfile
  onboardingComplete:boolean
  registration: 'none'|'reserved'|'paid'|'attended'|'waitlist'|'refunded'|'cancelled'|'no_show'
  queuePosition?: number
  reservationExpiresAt?: string
  idea?: FilmIdea
  ideaProgress?:{submitted:number;attended:number;ready:boolean}
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
  show?:ShowState
  filmAssignments?:FilmMission[]
  filmLive?:FilmLiveState
  filmPackages?:FilmPackageAdmin[]
  inventedFilms?:{id:string;userId:string;animalName:string;title:string;description:string;createdAt:string;updatedAt:string}[]
  reviewQueue?:ReviewQueueItem[]
  projector?:ProjectorState
  screenCreatures?:ScreenCreature[]
  movieCatalog?:MovieCandidate[]
  showLog?:{id:string;action:string;createdAt:string}[]
  creatureTaskCompletions?:Record<string,string>
  screenMessage?: string
  outputs?: Record<string, unknown>
  outputApprovals?: Record<string,boolean>
  adminParticipants?:AdminParticipant[]
}
