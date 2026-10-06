export function nonexistentFilmEnabled(event:any){
  return event?.settings?.modes?.nonexistent_film?.enabled===true || event?.settings?.nonexistent_film_enabled===true
}

export async function eventBySlug(db:any,slugOrId:string){
  const value=String(slugOrId||'').trim()
  const isUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  const query=db.from('events').select('*')
  const r=await (isUuid?query.eq('id',value):query.eq('slug',value)).maybeSingle()
  if(r.error)throw r.error
  if(!r.data)throw new Error('EVENT_NOT_FOUND')
  return r.data
}

export async function nextEvent(db:any){
  const r=await db.from('events').select('*').not('slug','like','test-%').order('starts_at',{ascending:true}).gte('starts_at',new Date(Date.now()-86400000).toISOString()).limit(1).maybeSingle()
  if(r.error)throw r.error
  return r.data||null
}

function normalizeProgram(config:any){
  const raw=Array.isArray(config?.blocks)?config.blocks:[]
  const blocks=raw
    .filter((x:any)=>x&&x.enabled!==false&&String(x.id||'').trim())
    .map((x:any,index:number)=>({
      id:String(x.id),
      type:String(x.type||x.id),
      title:String(x.title||x.id),
      durationMin:Math.max(0,Math.min(240,Number(x.duration_min??x.durationMin??0)||0)),
      roundsTarget:Math.max(0,Math.min(20,Number(x.rounds_target??x.roundsTarget??0)||0)),
      autoAdvance:x.auto_advance===true||x.autoAdvance===true,
      audioPlaylist:(Array.isArray(x.audio_playlist)?x.audio_playlist:Array.isArray(x.audioPlaylist)?x.audioPlaylist:[]).map((v:any)=>String(v)).filter(Boolean).slice(0,20),
      audioVolume:Math.max(0,Math.min(1,Number(x.audio_volume??x.audioVolume??0.28)||0.28)),
      index
    }))
  const rewards=config?.rewards||{}
  return {
    version:Number(config?.version||1),
    roundsTarget:Math.max(1,Math.min(20,Number(config?.rounds_target??config?.roundsTarget??4)||4)),
    rewards:{
      join:Math.max(0,Math.min(100,Number(rewards.join??1)||0)),
      vote:Math.max(0,Math.min(100,Number(rewards.vote??1)||0)),
      round:Math.max(0,Math.min(100,Number(rewards.round??2)||0)),
      finale:Math.max(0,Math.min(100,Number(rewards.finale??3)||0))
    },
    blocks
  }
}

function moviePublic(x:any){
  if(!x)return undefined
  return {
    id:x.id,
    title:x.title,
    originalTitle:x.original_title||undefined,
    year:x.year||undefined,
    runtimeMin:x.runtime_min||undefined,
    genre:x.genre||undefined,
    country:x.country||undefined,
    reason:x.reason||undefined,
    enabledForEvent:x.enabled_for_event!==false,
    trailerStatus:x.trailer_status||'unchecked',
    clipStatus:x.clip_status||'unchecked',
    sourceType:x.source_type||undefined,
    sourcePlatform:x.source_platform||undefined,
    sourceUrl:x.source_url||undefined,
    videoId:x.video_id||undefined,
    startSec:x.start_sec??undefined,
    endSec:x.end_sec??undefined,
    sourceChannel:x.source_channel||undefined,
    sourceVerified:x.source_verified===true,
    verifiedAt:x.verified_at||undefined,
    usageStatus:x.usage_status||'needs_review',
    discussionPrompts:Array.isArray(x.discussion_prompts)?x.discussion_prompts:[],
    animalComment:x.animal_comment||undefined,
    tags:Array.isArray(x.tags)?x.tags:[]
  }
}

function voteSummary(rows:any[]){
  const map=new Map<string,number>()
  for(const row of rows||[]){
    const answer=row?.answer
    const key=typeof answer==='string'?answer:JSON.stringify(answer)
    map.set(key,(map.get(key)||0)+1)
  }
  return [...map.entries()].map(([answer,count])=>{
    let parsed:any=answer
    try{parsed=JSON.parse(answer)}catch{}
    return {answer:parsed,count}
  }).sort((a,b)=>b.count-a.count)
}

export async function buildShowState(db:any,event:any){
  const [programR,runtimeR,presenceR,mediaR,screenR]=await Promise.all([
    db.from('event_programs').select('config,updated_at').eq('event_id',event.id).maybeSingle(),
    db.from('event_runtime').select('*,event_runs(id,run_key,mode,status,sequence_no)').eq('event_id',event.id).maybeSingle(),
    db.from('event_presence').select('*',{count:'exact',head:true}).eq('event_id',event.id).gte('last_seen_at',new Date(Date.now()-45000).toISOString()),
    db.from('media_assets').select('asset_key,title,category,mime_type,duration_sec,public_url').eq('status','ready').order('asset_key'),
    db.from('event_screen_status').select('audio_unlocked,last_seen_at,test_nonce,test_asset_key').eq('event_id',event.id).maybeSingle()
  ])
  for(const r of [programR,runtimeR,presenceR,mediaR,screenR])if(r.error)throw r.error
  const program=normalizeProgram(programR.data?.config||{})
  const raw=runtimeR.data||{}
  const blockIndex=Math.max(0,Math.min(Math.max(0,program.blocks.length-1),Number(raw.current_block_index||0)))
  const block=program.blocks.find((x:any)=>x.id===raw.current_block_id)||program.blocks[blockIndex]||undefined
  let round:any=undefined
  let results:any[]=[]
  let currentBlockRoundCount=0
  if(block?.type==='cinema_rounds'){
    let blockRoundsQ=db.from('event_rounds').select('*',{count:'exact',head:true}).eq('event_id',event.id).eq('block_id',String(block.id))
    if(raw.run_id)blockRoundsQ=blockRoundsQ.eq('run_id',raw.run_id)
    const blockRounds=await blockRoundsQ
    if(blockRounds.error)throw blockRounds.error
    currentBlockRoundCount=Number(blockRounds.count||0)
  }
  if(raw.current_round_id){
    const [roundR,votesR]=await Promise.all([
      db.from('event_rounds').select('*,movie_candidates(*)').eq('id',raw.current_round_id).eq('event_id',event.id).maybeSingle(),
      db.from('event_votes').select('answer').eq('event_id',event.id).eq('round_id',raw.current_round_id)
    ])
    if(roundR.error)throw roundR.error
    if(votesR.error)throw votesR.error
    if(roundR.data){
      const rr:any=roundR.data
      const [pitchCountR,selectedPitchR]=await Promise.all([
        db.from('invented_films').select('*',{count:'exact',head:true}).eq('round_id',rr.id),
        rr.selected_submission_id
          ? db.from('invented_films').select('id,animal_name_snapshot,title,description').eq('id',rr.selected_submission_id).eq('round_id',rr.id).maybeSingle()
          : Promise.resolve({data:null,error:null})
      ])
      if(pitchCountR.error)throw pitchCountR.error
      if((selectedPitchR as any).error)throw (selectedPitchR as any).error
      const selectedPitch:any=(selectedPitchR as any).data
      round={
        id:rr.id,
        roundNo:Number(rr.round_no||0),
        blockId:rr.block_id,
        status:rr.status,
        flowStatus:String(rr.flow_status||'draft'),
        selectedSubmissionId:rr.selected_submission_id||undefined,
        selectedPitch:selectedPitch?{id:String(selectedPitch.id),animalName:String(selectedPitch.animal_name_snapshot),title:String(selectedPitch.title),description:String(selectedPitch.description)}:undefined,
        pitchCount:Number(pitchCountR.count||0),
        questionPosition:Number(rr.question_position||0),
        questionTarget:Number(rr.question_target??3),
        movie:moviePublic(rr.movie_candidates),
        question:rr.question||undefined,
        voteState:rr.vote_state,
        resultsVisible:rr.results_visible===true,
        videoState:rr.video_state||{status:'idle'},
        startedAt:rr.started_at||undefined,
        updatedAt:rr.updated_at||undefined,
        closedAt:rr.closed_at||undefined
      }
      if(rr.results_visible===true)results=voteSummary(votesR.data||[])
    }
  }
  let movie:any=round?.movie
  if(!movie&&raw.current_movie_id){
    const m=await db.from('movie_candidates').select('*').eq('id',raw.current_movie_id).eq('event_id',event.id).maybeSingle()
    if(m.error)throw m.error
    movie=moviePublic(m.data)
  }

  let finalVote:any=undefined
  if(['final_vote','finale','post_event'].includes(String(block?.type||''))||String(raw.run_status)==='finished'){
    let roundMoviesQ=db.from('event_rounds').select('round_no,movie_candidate_id,movie_candidates(id,title,year,genre)').eq('event_id',event.id).not('movie_candidate_id','is',null).order('round_no')
    let finalVotesQ=db.from('event_final_votes').select('movie_candidate_id').eq('event_id',event.id)
    if(raw.run_id){roundMoviesQ=roundMoviesQ.eq('run_id',raw.run_id);finalVotesQ=finalVotesQ.eq('run_id',raw.run_id)}
    const [roundMoviesR,finalVotesR]=await Promise.all([roundMoviesQ,finalVotesQ])
    if(roundMoviesR.error)throw roundMoviesR.error
    if(finalVotesR.error)throw finalVotesR.error
    const counts=new Map<string,number>()
    for(const row of finalVotesR.data||[]){
      const id=String((row as any).movie_candidate_id||'')
      if(id)counts.set(id,(counts.get(id)||0)+1)
    }
    const seen=new Set<string>()
    const options:any[]=[]
    for(const row of roundMoviesR.data||[]){
      const m:any=(row as any).movie_candidates
      const id=String((row as any).movie_candidate_id||m?.id||'')
      if(!id||seen.has(id)||!m)continue
      seen.add(id)
      options.push({id,title:String(m.title||'фильм'),year:m.year?Number(m.year):undefined,genre:m.genre||undefined,count:counts.get(id)||0})
    }
    const max=options.reduce((n,x)=>Math.max(n,Number(x.count||0)),0)
    finalVote={
      options,
      totalVotes:(finalVotesR.data||[]).length,
      winners:max>0?options.filter(x=>Number(x.count||0)===max):[],
      closed:String(block?.type)!=='final_vote'||String(raw.run_status)!=='running'
    }
  }
  return {
    program,
    runtime:{
      runId:raw.run_id||undefined,
      runKey:raw.event_runs?.run_key||undefined,
      runMode:raw.event_runs?.mode||undefined,
      isTest:raw.event_runs?.mode==='test',
      runStatus:raw.run_status||'idle',
      currentBlockId:block?.id||raw.current_block_id||'arrival',
      currentBlockIndex:block?.index??blockIndex,
      currentBlock:block,
      currentRound:Number(raw.current_round||0),
      currentBlockRoundCount,
      currentRoundId:raw.current_round_id||undefined,
      currentMovie:movie,
      currentQuestion:raw.current_question||round?.question||undefined,
      voteState:raw.vote_state||round?.voteState||'closed',
      resultsVisible:raw.results_visible===true||round?.resultsVisible===true,
      videoState:raw.video_state||round?.videoState||{status:'idle'},
      revision:Number(raw.revision||0),
      startedAt:raw.started_at||undefined,
      blockStartedAt:raw.block_started_at||undefined,
      pausedAt:raw.paused_at||undefined,
      updatedAt:raw.updated_at||undefined
    },
    currentRound:round,
    voteResults:results,
    finalVote,
    onlineCount:Number(presenceR.count||0),
    audio:{
      state:raw.audio_state||{mode:'auto',status:'stopped',track_key:null,playlist_index:0,volume:.28},
      assets:(mediaR.data||[]).map((x:any)=>({key:String(x.asset_key),title:String(x.title),category:String(x.category),mimeType:String(x.mime_type),durationSec:Number(x.duration_sec||0),url:String(x.public_url||'')})),
      screen:{
        unlocked:screenR.data?.audio_unlocked===true,
        online:!!screenR.data?.last_seen_at&&Date.now()-new Date(screenR.data.last_seen_at).getTime()<15000,
        lastSeenAt:screenR.data?.last_seen_at||undefined,
        testNonce:screenR.data?.test_nonce||undefined,
        testAssetKey:screenR.data?.test_asset_key||undefined
      }
    }
  }
}

export async function buildEventState(db:any,event:any,opts:{includeActuals?:boolean;includePrivateOutputs?:boolean}={}){
  const [ideaF,selIdea,movieF,selMovie,preds,leaders,outputs,paid,reserved,ideas,attended,show]=await Promise.all([
    db.from('idea_finalists').select('rank,film_ideas(id,title,plot)').eq('event_id',event.id).order('rank'),
    db.from('selected_idea').select('revealed_author_user_id,film_ideas(id,title,plot)').eq('event_id',event.id).maybeSingle(),
    db.from('movie_finalists').select('rank,movie_candidates(*)').eq('event_id',event.id).order('rank'),
    db.from('event_movie').select('availability_status,movie_candidates(*)').eq('event_id',event.id).maybeSingle(),
    db.from('prediction_questions').select('*').eq('event_id',event.id).order('position'),
    db.from('leaderboard').select('user_id,prediction_points,wins,events_attended,users(display_name,telegram_username)').order('prediction_points',{ascending:false}).limit(20),
    db.from('event_outputs').select('output_key,payload,approved').eq('event_id',event.id),
    db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',event.id).in('status',['paid','attended']),
    db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',event.id).eq('status','reserved').gt('reservation_expires_at',new Date().toISOString()),
    db.from('film_ideas').select('*',{count:'exact',head:true}).eq('event_id',event.id),
    db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',event.id).eq('status','attended'),
    buildShowState(db,event)
  ])
  for(const r of [ideaF,selIdea,movieF,selMovie,preds,leaders,outputs,paid,reserved,ideas,attended]) if(r.error) throw r.error

  let selectedIdea:any=(selIdea.data as any)?.film_ideas||undefined
  if(selectedIdea&&(selIdea.data as any)?.revealed_author_user_id){
    const author=await db.from('users').select('display_name,telegram_username').eq('id',(selIdea.data as any).revealed_author_user_id).maybeSingle()
    if(author.error)throw author.error
    selectedIdea={...selectedIdea,author:author.data?.telegram_username?`@${author.data.telegram_username}`:author.data?.display_name||'участник'}
  }

  const publicOutputKeys=new Set(['score_summary','tiebreaker','post_film_synthesis','collective_review'])
  const visibleOutputs=opts.includePrivateOutputs?(outputs.data||[]):(outputs.data||[]).filter((x:any)=>x.approved===true&&publicOutputKeys.has(x.output_key))
  return {
    event:{id:event.id,slug:event.slug,title:event.title,startsAt:event.starts_at,capacity:event.capacity,sold:paid.count||0,held:reserved.count||0,ticketPriceRub:event.ticket_price_rub,maxMovieRuntimeMin:event.max_movie_runtime_min,status:event.status,venueName:event.venue_name,venueAddress:event.venue_address,paymentsAvailable:!!String(Deno.env.get('TELEGRAM_PROVIDER_TOKEN')||'').trim(),nonexistentFilmEnabled:nonexistentFilmEnabled(event),movieAvailabilityStatus:(selMovie.data as any)?.availability_status||'unchecked'},
    show,
    screenMessage:event.settings?.screen_message||'',
    ideaProgress:{
      submitted:Number(ideas.count||0),
      attended:Number(attended.count||0),
      ready:Number(attended.count||0)>0&&Number(ideas.count||0)>=Number(attended.count||0)
    },
    ideaFinalists:(ideaF.data||[]).map((x:any)=>x.film_ideas),
    selectedIdea,
    movieFinalists:(movieF.data||[]).map((x:any)=>moviePublic(x.movie_candidates)),
    selectedMovie:moviePublic((selMovie.data as any)?.movie_candidates),
    predictions:(preds.data||[]).map((p:any)=>({id:p.id,position:p.position,text:p.text,...(opts.includeActuals?{actual:p.actual}: {})})),
    leaderboard:(leaders.data||[]).map((x:any)=>({name:x.users?.display_name||x.users?.telegram_username||'участник',points:x.prediction_points,wins:x.wins,events:x.events_attended})),
    outputs:Object.fromEntries(visibleOutputs.map((x:any)=>[x.output_key,x.payload])),
    ...(opts.includePrivateOutputs?{outputApprovals:Object.fromEntries((outputs.data||[]).map((x:any)=>[x.output_key,x.approved===true]))}:{})
  }
}
