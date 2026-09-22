import { ensureCreature } from './stories.ts'

function tasteDistance(a:any,b:any){const keys=['weirdness','heaviness','atmosphere','oldness','experimental','slowness','surrealism'];const diffs=keys.map(k=>Math.abs(Number(a?.[k]??50)-Number(b?.[k]??50)));return diffs.reduce((x,y)=>x+y,0)/(keys.length*100)}
function overlap(a:string[]=[],b:string[]=[]){const bs=new Set(b.map(x=>x.toLowerCase().trim()));return a.filter(x=>bs.has(x.toLowerCase().trim()))}
export function allowedGender(show:string,self:string){return show==='all'||(show==='women'&&self==='woman')||(show==='men'&&self==='man')}

export async function datingState(db:any,userId:string){
  const p=await db.from('dating_profiles').select('*').eq('user_id',userId).maybeSingle();if(p.error)throw p.error
  const profile={enabled:!!p.data?.enabled,selfGender:p.data?.self_gender||'',showGender:p.data?.show_gender||'',intents:Array.isArray(p.data?.intents)?p.data.intents:[],paused:!!p.data?.paused}
  if(!p.data)await db.from('dating_profiles').insert({user_id:userId})
  if(!profile.enabled)return {dating:profile,datingCards:[],datingMatches:[]}
  const mine=await db.from('cinema_profiles').select('favorite_films,favorite_genres,profile_json').eq('user_id',userId).maybeSingle();if(mine.error)throw mine.error
  const blocks=await db.from('user_blocks').select('blocker_id,blocked_id').or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);if(blocks.error)throw blocks.error
  const blocked=new Set((blocks.data||[]).map((x:any)=>x.blocker_id===userId?x.blocked_id:x.blocker_id))
  const swipes=await db.from('dating_swipes').select('target_id').eq('swiper_id',userId);if(swipes.error)throw swipes.error;const seen=new Set((swipes.data||[]).map((x:any)=>x.target_id))
  const cards:any[]=[]
  if(profile.enabled&&!profile.paused&&profile.showGender){
    const candidates=await db.from('dating_profiles').select('user_id,self_gender,show_gender,intents').eq('enabled',true).eq('paused',false).neq('user_id',userId).limit(80);if(candidates.error)throw candidates.error
    for(const c of candidates.data||[]){
      if(seen.has(c.user_id)||blocked.has(c.user_id)||!allowedGender(profile.showGender,c.self_gender)||!allowedGender(c.show_gender,profile.selfGender))continue
      const [u,cp,cr]=await Promise.all([db.from('users').select('display_name').eq('id',c.user_id).single(),db.from('cinema_profiles').select('favorite_films,favorite_genres,profile_json').eq('user_id',c.user_id).maybeSingle(),ensureCreature(db,c.user_id)])
      if(u.error||cp.error)continue
      const sharedFilms=overlap(mine.data?.favorite_films||[],cp.data?.favorite_films||[]);const sharedGenres=overlap(mine.data?.favorite_genres||[],cp.data?.favorite_genres||[]);const dist=tasteDistance(mine.data?.profile_json?.taste,cp.data?.profile_json?.taste);const compatibility=Math.round(Math.max(0,Math.min(100,50+sharedFilms.length*18+sharedGenres.length*7+(1-dist)*25)))
      let note=sharedFilms.length?`у вас совпал ${sharedFilms[0]}`:sharedGenres.length?`вы оба зачем-то любите ${sharedGenres[0]}`:dist>.55?'по кино вы почти противоположности. это подозрительно интересно':'ваши вкусы стоят довольно близко'
      cards.push({userId:c.user_id,displayName:u.data.display_name||'участник',creatureName:cr.name||'Животина',creatureStage:cr.stage||'tiny',favoriteFilms:cp.data?.favorite_films||[],favoriteGenres:cp.data?.favorite_genres||[],taste:cp.data?.profile_json?.taste||{},matchNote:note,compatibility})
    }
    cards.sort((a,b)=>b.compatibility-a.compatibility)
  }
  const con=await db.from('social_connections').select('*').or(`user_a.eq.${userId},user_b.eq.${userId}`).eq('status','active').order('created_at',{ascending:false}).limit(30);if(con.error)throw con.error
  const matches:any[]=[]
  for(const x of con.data||[]){if(Array.isArray(x.metadata?.hidden_by)&&x.metadata.hidden_by.includes(userId))continue;const other=x.user_a===userId?x.user_b:x.user_a;const [u,cr]=await Promise.all([db.from('users').select('display_name').eq('id',other).single(),ensureCreature(db,other)]);if(u.error)continue;matches.push({id:x.id,kind:x.kind,displayName:u.data.display_name||'участник',creatureName:cr.name||'Животина',createdAt:x.created_at,sharedFilms:x.metadata?.shared_films||[]})}
  return {dating:profile,datingCards:cards.slice(0,12),datingMatches:matches}
}

export function connectionKind(a:string[]=[],b:string[]=[]){if(a.includes('dates')&&b.includes('dates'))return 'romantic';if(a.includes('cinema_company')&&b.includes('cinema_company'))return 'cinema';return 'friend'}
