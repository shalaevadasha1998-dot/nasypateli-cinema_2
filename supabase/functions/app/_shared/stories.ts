function same(a:any,b:any){return JSON.stringify(a)===JSON.stringify(b)}
function num(v:any){const n=Number(v);return Number.isFinite(n)?n:0}
function feedDayKey(v:any){
  try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}
  catch{return ''}
}

export async function ensureCreature(db:any,userId:string){
  const existing=await db.from('creatures').select('*').eq('user_id',userId).maybeSingle();if(existing.error)throw existing.error
  if(existing.data)return existing.data
  const made=await db.from('creatures').insert({user_id:userId,name:'Животина'}).select('*').single();if(made.error)throw made.error
  return made.data
}

export async function creatureState(db:any,userId:string){
  const creature=await ensureCreature(db,userId)
  const [cosmetics,stories,config]=await Promise.all([
    db.from('user_creature_cosmetics').select('equipped,acquired_at,creature_cosmetics(code,name,slot,rarity,visual)').eq('user_id',userId).order('acquired_at',{ascending:false}),
    db.from('user_stories').select('id,happened_at,event_id,context,story_definitions(code,title,description,category,rarity,visibility,reward),events(title)',{count:'exact'}).eq('user_id',userId).order('happened_at',{ascending:false}).limit(80),
    db.from('creature_game_config').select('feeding_cost').eq('id','default').maybeSingle()
  ])
  if(cosmetics.error)throw cosmetics.error;if(stories.error)throw stories.error;if(config.error)throw config.error
  if(!config.data)throw new Error('creature_game_config_missing')
  const cs=(cosmetics.data||[]).map((x:any)=>({...(x.creature_cosmetics||{}),equipped:!!x.equipped}))
  const timeline=(stories.data||[]).map((x:any)=>({id:x.id,code:x.story_definitions?.code||'',title:x.story_definitions?.title||'',description:x.story_definitions?.description||'',category:x.story_definitions?.category||'',rarity:x.story_definitions?.rarity||'common',secret:x.story_definitions?.visibility==='secret',happenedAt:x.happened_at,eventTitle:x.events?.title||undefined,rewardName:cs.find((c:any)=>c.code===x.story_definitions?.reward?.cosmetic)?.name}))
  const feedingCost=Math.max(1,Number(config.data?.feeding_cost||1))
  const canFeedToday=!creature.last_fed_at||feedDayKey(creature.last_fed_at)!==feedDayKey(new Date())
  return {born:!!creature.born_at,bornAt:creature.born_at||undefined,name:creature.name||'Животина',stage:(['stage_0','stage_1','stage_2','stage_3','stage_4'].includes(String(creature.stage))?creature.stage:(creature.stage==='grown'?'stage_4':creature.stage==='young'?'stage_2':'stage_0')),crumbs:Number(creature.crumbs||0),growthProgress:Number(creature.growth_progress||0),lastFedAt:creature.last_fed_at||undefined,feedingCost,canFeedToday,storyCount:Number(stories.count??timeline.length),traits:{curiosity:0,argumentative:0,social:0,romantic:0,chaotic:0,cinephile:0,...(creature.traits||{})},cosmetics:cs,timeline}
}

async function conditionPasses(db:any,userId:string,trigger:string,condition:any,context:any){
  const eq=condition?.metadata_equals||{};for(const [k,v] of Object.entries(eq))if(!same(context?.[k],v))return false
  const gte=condition?.metadata_gte||{};for(const [k,v] of Object.entries(gte))if(num(context?.[k])<num(v))return false
  const lte=condition?.metadata_lte||{};for(const [k,v] of Object.entries(lte))if(num(context?.[k])>num(v))return false
  const required=Array.isArray(condition?.requires_story_codes)?condition.requires_story_codes:[]
  if(required.length){const defs=await db.from('story_definitions').select('id,code').in('code',required);if(defs.error)throw defs.error;const ids=(defs.data||[]).map((x:any)=>x.id);const got=ids.length?await db.from('user_stories').select('story_id').eq('user_id',userId).in('story_id',ids):{data:[],error:null};if(got.error)throw got.error;const have=new Set((got.data||[]).map((x:any)=>x.story_id));const byCode=new Map((defs.data||[]).map((x:any)=>[x.code,x.id]));if(required.some((x:string)=>!have.has(byCode.get(x))))return false}
  const min=Number(condition?.min_trigger_count||0)
  if(min>0){const count=await db.from('story_trigger_log').select('*',{count:'exact',head:true}).eq('user_id',userId).eq('trigger_key',trigger);if(count.error)throw count.error;if(Number(count.count||0)<min)return false}
  return true
}

export async function emitStoryTrigger(db:any,userId:string,trigger:string,context:Record<string,unknown>={},eventId?:string|null){
  const log=await db.from('story_trigger_log').insert({user_id:userId,trigger_key:trigger,event_id:eventId||null,context});if(log.error)throw log.error
  const defs=await db.from('story_definitions').select('code,title,visibility,condition,repeatable').eq('trigger_key',trigger).eq('active',true);if(defs.error)throw defs.error
  const awards:any[]=[]
  for(const d of defs.data||[]){
    if(!await conditionPasses(db,userId,trigger,d.condition||{},context))continue
    const occurrence=d.repeatable?String(eventId||context.occurrenceKey||new Date().toISOString().slice(0,10)):'once'
    const r=await db.rpc('award_story',{p_user_id:userId,p_story_code:d.code,p_event_id:eventId||null,p_occurrence_key:occurrence,p_context:context});if(r.error)throw r.error
    const row=Array.isArray(r.data)?r.data[0]:r.data;if(row?.awarded){awards.push({code:d.code,title:d.title,visibility:d.visibility,...row});await db.from('notification_queue').upsert({user_id:userId,kind:'stories',text:d.visibility==='secret'?'у вашей Животины появилась новая секретная история':'с Животиной что-то произошло: '+d.title,send_after:new Date().toISOString(),status:'pending',dedupe_key:'story:'+d.code},{onConflict:'user_id,dedupe_key'})}
  }
  return awards
}
