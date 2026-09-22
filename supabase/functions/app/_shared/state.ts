export function nonexistentFilmEnabled(event:any){
  return event?.settings?.modes?.nonexistent_film?.enabled===true || event?.settings?.nonexistent_film_enabled===true
}

export async function eventBySlug(db:any,slug:string){
  const r=await db.from('events').select('*').eq('slug',slug).single()
  if(r.error)throw r.error
  return r.data
}

export async function nextEvent(db:any){
  const r=await db.from('events').select('*').order('starts_at',{ascending:true}).gte('starts_at',new Date(Date.now()-86400000).toISOString()).limit(1).maybeSingle()
  if(r.error)throw r.error
  return r.data||null
}

export async function buildEventState(db:any,event:any,opts:{includeActuals?:boolean;includePrivateOutputs?:boolean}={}){
  const [ideaF,selIdea,movieF,selMovie,preds,leaders,outputs,paid,reserved]=await Promise.all([
    db.from('idea_finalists').select('rank,film_ideas(id,title,plot)').eq('event_id',event.id).order('rank'),
    db.from('selected_idea').select('revealed_author_user_id,film_ideas(id,title,plot)').eq('event_id',event.id).maybeSingle(),
    db.from('movie_finalists').select('rank,movie_candidates(*)').eq('event_id',event.id).order('rank'),
    db.from('event_movie').select('availability_status,movie_candidates(*)').eq('event_id',event.id).maybeSingle(),
    db.from('prediction_questions').select('*').eq('event_id',event.id).order('position'),
    db.from('leaderboard').select('user_id,prediction_points,wins,events_attended,users(display_name,telegram_username)').order('prediction_points',{ascending:false}).limit(20),
    db.from('event_outputs').select('output_key,payload,approved').eq('event_id',event.id),
    db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',event.id).in('status',['paid','attended']),
    db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',event.id).eq('status','reserved').gt('reservation_expires_at',new Date().toISOString())
  ])
  for(const r of [ideaF,selIdea,movieF,selMovie,preds,leaders,outputs,paid,reserved]) if(r.error) throw r.error

  let selectedIdea:any=(selIdea.data as any)?.film_ideas||undefined
  if(selectedIdea&&(selIdea.data as any)?.revealed_author_user_id){
    const author=await db.from('users').select('display_name,telegram_username').eq('id',(selIdea.data as any).revealed_author_user_id).maybeSingle()
    if(author.error)throw author.error
    selectedIdea={...selectedIdea,author:author.data?.telegram_username?`@${author.data.telegram_username}`:author.data?.display_name||'участник'}
  }

  const publicOutputKeys=new Set(['score_summary','tiebreaker','post_film_synthesis','collective_review'])
  const visibleOutputs=opts.includePrivateOutputs?(outputs.data||[]):(outputs.data||[]).filter((x:any)=>x.approved===true&&publicOutputKeys.has(x.output_key))
  return {
    event:{id:event.id,slug:event.slug,title:event.title,startsAt:event.starts_at,capacity:event.capacity,sold:paid.count||0,held:reserved.count||0,ticketPriceRub:event.ticket_price_rub,maxMovieRuntimeMin:event.max_movie_runtime_min,status:event.status,venueName:event.venue_name,venueAddress:event.venue_address,nonexistentFilmEnabled:nonexistentFilmEnabled(event),movieAvailabilityStatus:(selMovie.data as any)?.availability_status||'unchecked'},
    screenMessage:event.settings?.screen_message||'',
    ideaFinalists:(ideaF.data||[]).map((x:any)=>x.film_ideas),
    selectedIdea,
    movieFinalists:(movieF.data||[]).map((x:any)=>x.movie_candidates),
    selectedMovie:(selMovie.data as any)?.movie_candidates||undefined,
    predictions:(preds.data||[]).map((p:any)=>({id:p.id,position:p.position,text:p.text,...(opts.includeActuals?{actual:p.actual}: {})})),
    leaderboard:(leaders.data||[]).map((x:any)=>({name:x.users?.display_name||x.users?.telegram_username||'участник',points:x.prediction_points,wins:x.wins,events:x.events_attended})),
    outputs:Object.fromEntries(visibleOutputs.map((x:any)=>[x.output_key,x.payload])),
    ...(opts.includePrivateOutputs?{outputApprovals:Object.fromEntries((outputs.data||[]).map((x:any)=>[x.output_key,x.approved===true]))}:{})
  }
}
