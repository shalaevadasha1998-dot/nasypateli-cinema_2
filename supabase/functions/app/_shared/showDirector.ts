/** Pure planner. The server owns transitions; the browser only reports playback. */
export type DirectorStep={action:string;body:Record<string,unknown>}|{wait:string}
export const MEDIA_STATES=new Set(['film_intro','playing_clip','question_reveal'])
export function playbackComplete(video:any,projector:any,runId:string):boolean {
  const f=projector?.payload?.revealFragment||projector?.payload?.fragment
  return video?.runId===runId&&video?.projectorRevision===projector?.revision&&video?.status==='ended'&&Number.isFinite(video?.position)&&Number.isFinite(f?.endSec)&&video.position>=f.endSec-.3&&video.continuous===true
}
export function planDirector(input:any,now=Date.now()):DirectorStep{
  const {show,projector,packageId,attended=0}=input,r=show?.runtime,round=show?.currentRound,block=r?.currentBlock
  const wait=(reason:string):DirectorStep=>({wait:reason}),go=(action:string,body:Record<string,unknown>={}):DirectorStep=>({action,body})
  if(!r||r.runStatus!=='running'||r.roundControlMode==='manual')return wait('ручной режим или пауза')
  if(r.directorState?.blocked)return wait(String(r.directorState.message||'нужно решение ведущей'))
  if(!block)return wait('нет текущего блока')
  if(input.screenOnline===false)return wait('экран показа не на связи · переходы остановлены')
  const elapsed=Math.max(0,now-new Date(projector?.updatedAt||round?.updatedAt||round?.startedAt||r.blockStartedAt||now).getTime())
  if(block.type!=='cinema_rounds'){
    if(MEDIA_STATES.has(projector?.state))return wait('видео ещё на экране')
    if(block.autoAdvance&&Number(block.durationMin)>0&&now-new Date(r.blockStartedAt||now).getTime()>=block.durationMin*60000)return go('admin-show-control',{op:'next'})
    return wait('тайминг блока')
  }
  const count=Number(r.currentBlockRoundCount||0),target=Math.max(1,Number(block.roundsTarget||2))
  if(round?.status!=='active')return elapsed<(count<target?6000:8000)?wait('пауза между раундами'):count<target?go('admin-round-start'):go('admin-show-control',{op:'next'})
  const flow=round.flowStatus||'round_intro',pos=Math.max(1,Number(round.questionPosition||1)),qTarget=Number(round.questionTarget??(round.roundNo%2===0?3:0))
  const project=(op:string,extra:Record<string,unknown>={}):DirectorStep=>packageId?go('admin-film-projector',{filmPackageId:packageId,roundId:round.id,op,...extra}):wait('нет проверенного киноблока')
  if(flow==='round_intro')return elapsed>=300000?go('admin-round-pitches-open'):wait('объяснение механики')
  if(flow==='collecting_films'){const n=Number(round.pitchCount||0);return n>0&&((attended>0&&n>=attended)||elapsed>=300000)?go('admin-round-pitches-close'):wait(n?'сбор идей':'нет идей · ведущая может продлить или пропустить раунд')}
  if(flow==='films_locked')return elapsed>=2000?go('admin-round-pitch-draw'):wait('выбор идеи')
  if(flow==='submission_selected')return elapsed>=5000?go('admin-round-find-movie'):wait('идея выбрана')
  if(flow==='movie_found')return elapsed>=9000?project('film_intro'):wait('представление фильма')
  if(flow==='playing_clip'||flow==='question_reveal'){
    if(!playbackComplete(r.videoState,projector,r.runId))return wait('показ приостановлен · ждём подтверждённое окончание видео')
    if(flow==='playing_clip')return qTarget?project('question_open',{position:1}):go('admin-film-assign',{filmPackageId:packageId,roundId:round.id})
    return pos<qTarget?project('question_open',{position:pos+1}):project('assignment_randomizing')
  }
  if(flow==='question_open'){const n=Number(projector?.payload?.answerCount||0);return (attended>0&&n>=attended)||elapsed>=120000?project('question_results',{position:pos}):wait('приём ответов')}
  if(flow==='question_results')return projector?.payload?.judgement?.status!=='decided'?wait('нужно решение ведущей'):elapsed>=10000?project('question_reveal',{position:pos}):wait('результаты вопроса')
  if(flow==='assignment_randomizing')return elapsed>=2200?go('admin-film-assign',{filmPackageId:packageId,roundId:round.id}):wait('назначение миссии')
  if(flow==='assignment_selected')return elapsed>=300000?(qTarget?go('admin-round-close'):project('one_word_open')):wait('миссия')
  if(flow==='one_word_collecting'){const n=(projector?.payload?.wordGroups||[]).reduce((s:number,x:any)=>s+Number(x.count||0),0);return (attended>0&&n>=attended)||elapsed>=300000?project('one_word_results'):wait('сбор впечатлений')}
  if(flow==='one_word_results')return elapsed>=12000?go('admin-round-close'):wait('общие впечатления')
  return wait('операция выполняется или нужно решение ведущей')
}
