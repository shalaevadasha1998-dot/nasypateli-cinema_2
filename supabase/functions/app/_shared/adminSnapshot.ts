// Load the admin read model in three parallel requests instead of dozens of
// serial PostgREST round trips. The caller must authorize the event first.
const eventSelect=[
  'id',
  'event_programs(*)','event_runtime!event_runtime_event_id_fkey(*)',
  'event_presence(*)','event_screen_status(*)','event_projector_state(*)',
  'event_rounds!event_rounds_event_id_fkey(*,movie_candidates!event_rounds_movie_candidate_id_fkey(*))',
  'event_votes(*)','event_final_votes(*)','event_outputs(*)','event_runtime_log(*)',
  'idea_finalists(*,film_ideas(*))',
  'selected_idea(*,film_ideas(*),users!selected_idea_revealed_author_user_id_fkey(id,display_name,telegram_username,deleted_at))',
  'movie_finalists(*,movie_candidates(*))','event_movie(*,movie_candidates(*))',
  'prediction_questions(*)','film_ideas(*)','invented_films(*)',
  'movie_candidates!movie_candidates_event_id_fkey(*)','movie_source_candidates(*)',
  'registrations(*,users!registrations_user_id_fkey(id,display_name,telegram_username,deleted_at,cinema_profiles(user_id,profile_json),creatures(user_id,name)))',
  'film_packages(*,film_questions(*))',
  'film_assignments(*,submitted_reviews(*),users!film_assignments_user_id_fkey(id,display_name,telegram_username,deleted_at))',
  'film_impressions(*)','film_predictions(*)'
].join(',')

function rows(value:any):any[]{return Array.isArray(value)?value:value&&typeof value==='object'?[value]:[]}

export function snapshotReader(tables:Record<string,any[]>){
  return {from(table:string){
    if(!Object.prototype.hasOwnProperty.call(tables,table))throw new Error(`Missing admin snapshot table: ${table}`)
    let data=[...tables[table]],head=false,count=false,one=false,allowEmpty=false,max:number|undefined
    const orders:{key:string;ascending:boolean;nullsFirst:boolean}[]=[]
    const query:any={
      select(_columns:string,options:any={}){head=options.head===true;count=options.count==='exact';return query},
      eq(key:string,value:any){data=data.filter(x=>x[key]===value);return query},
      in(key:string,values:any[]){data=data.filter(x=>values.includes(x[key]));return query},
      gt(key:string,value:any){data=data.filter(x=>x[key]!=null&&x[key]>value);return query},
      gte(key:string,value:any){data=data.filter(x=>x[key]!=null&&x[key]>=value);return query},
      not(key:string,operator:string,value:any){if(operator!=='is'||value!==null)throw new Error('Unsupported admin snapshot filter');data=data.filter(x=>x[key]!=null);return query},
      order(key:string,options:any={}){orders.push({key,ascending:options.ascending!==false,nullsFirst:options.nullsFirst===true});return query},
      limit(value:number){max=value;return query},
      maybeSingle(){one=true;allowEmpty=true;return query},
      single(){one=true;return query},
      then(resolve:any,reject:any){
        return Promise.resolve().then(()=>{
          const total=data.length
          const sorted=[...data].sort((a,b)=>{
            for(const o of orders){const av=a[o.key],bv=b[o.key];if(av===bv)continue
              if(av==null)return o.nullsFirst?-1:1;if(bv==null)return o.nullsFirst?1:-1
              const c=av<bv?-1:av>bv?1:0;if(c)return o.ascending?c:-c
            }return 0
          })
          const result=max===undefined?sorted:sorted.slice(0,max)
          if(one&&(result.length>1||(!allowEmpty&&!result.length)))return {data:null,error:{code:'PGRST116',message:'Unexpected snapshot row count'},count:count?total:null}
          return {data:head?null:one?(result[0]||null):result,error:null,count:count?total:null}
        }).then(resolve,reject)
      }
    }
    return query
  }}
}

export async function loadAdminSnapshot(db:any,eventId:string){
  const [event,leaders,media]=await Promise.all([
    db.from('events').select(eventSelect).eq('id',eventId).single(),
    db.from('leaderboard').select('*,users(id,display_name,telegram_username,deleted_at)').order('prediction_points',{ascending:false}).limit(20),
    db.from('media_assets').select('asset_key,title,category,mime_type,duration_sec,public_url,status').eq('status','ready').order('asset_key')
  ])
  for(const r of [event,leaders,media])if(r.error)throw r.error
  const raw=event.data||{}
  const tables:Record<string,any[]>={}
  for(const [key,value] of Object.entries(raw))if(key!=='id')tables[key]=rows(value)
  tables.leaderboard=leaders.data||[];tables.media_assets=media.data||[]
  tables.users=[];tables.cinema_profiles=[];tables.creatures=[];tables.film_questions=[];tables.submitted_reviews=[]
  for(const table of ['registrations','selected_idea','film_assignments','leaderboard']){
    for(const row of tables[table]||[]){
      for(const user of rows(row.users)){
        tables.users.push(user)
        tables.cinema_profiles.push(...rows(user.cinema_profiles));tables.creatures.push(...rows(user.creatures))
      }
    }
  }
  tables.users=[...new Map(tables.users.map(x=>[x.id,x])).values()]
  tables.cinema_profiles=[...new Map(tables.cinema_profiles.map(x=>[x.user_id,x])).values()]
  tables.creatures=[...new Map(tables.creatures.map(x=>[x.user_id,x])).values()]
  for(const pack of tables.film_packages||[])tables.film_questions.push(...rows(pack.film_questions))
  for(const assignment of tables.film_assignments||[])tables.submitted_reviews.push(...rows(assignment.submitted_reviews))
  return snapshotReader(tables)
}
