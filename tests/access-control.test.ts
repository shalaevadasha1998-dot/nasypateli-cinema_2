import { handleApi } from '../supabase/functions/app/handlers/api.ts'
const assert=(ok:unknown,message:string)=>{if(!ok)throw new Error(message)}
const root='http://127.0.0.1:54321'
const userId='11111111-1111-4111-8111-111111111111'
const eventId='22222222-2222-4222-8222-222222222222'
const realFetch=globalThis.fetch
const localBotToken='unit-test-only-bot'
async function signed(id:number){
  const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Test'})})
  const key=async(raw:Uint8Array)=>crypto.subtle.importKey('raw',raw as BufferSource,{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const secret=await crypto.subtle.sign('HMAC',await key(new TextEncoder().encode('WebAppData')),new TextEncoder().encode(localBotToken))
  const data=[...p].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')
  const signature=await crypto.subtle.sign('HMAC',await key(new Uint8Array(secret)),new TextEncoder().encode(data))
  p.set('hash',[...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join(''))
  return p.toString()
}
Deno.test('server authorization: guests cannot read, start, reset or scan rehearsals',async()=>{
  const env={SUPABASE_URL:root,SUPABASE_SECRET_KEY:'test-only',TELEGRAM_BOT_TOKEN:localBotToken,
    ADMIN_TELEGRAM_IDS:'222',ADMIN_TELEGRAM_USERNAMES:'',ALLOW_DEMO_AUTH:'false',
    ADMIN_ACCESS_TOKEN:'local-admin-test-key',SCREEN_ACCESS_TOKEN:'local-screen-test-key',
    TELEGRAM_WEBAPP_URL:'https://example.invalid/app'}
  const previous=new Map(Object.keys(env).map(k=>[k,Deno.env.get(k)]))
  for(const [k,v] of Object.entries(env))Deno.env.set(k,v)
  let writes=0,allowTestTicket=false
  globalThis.fetch=async(input,init)=>{
    const req=input instanceof Request?input:new Request(input,init)
    const url=new URL(req.url)
    assert(url.origin===root,'Test attempted an external request: '+url.origin)
    const table=url.pathname.split('/').pop()
    let data:unknown=null
    if(allowTestTicket&&table==='cinema_profiles')return new Response(JSON.stringify({profile_json:{completed:true}}),{headers:{'content-type':'application/json'}})
    if(allowTestTicket&&table==='reserve_event_spot')return new Response(JSON.stringify([{reservation_status:'reserved'}]),{headers:{'content-type':'application/json'}})
    if(allowTestTicket&&table==='registrations'&&req.method==='PATCH')return new Response(JSON.stringify({status:'paid'}),{headers:{'content-type':'application/json'}})
    if(req.method!=='GET'){
      writes++
      throw new Error('Unexpected state-changing request '+table)
    }
    if(table==='users')data={id:userId,telegram_id:111,telegram_username:null,display_name:'Test'}
    else if(table==='admins'||table==='admin_handles')data=null
    else if(table==='events'){
      const slug=(url.searchParams.get('slug')||'eq.test-2026-10-17').slice(3)
      data={id:eventId,slug,status:'CHECKIN',ticket_price_rub:0,settings:slug.startsWith('test-')?{test_room:true,admin_only:true}:{}}
    }else throw Error('Unexpected database read '+table)
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}})
  }
  async function call(action:string,slug:string,auth:string,extra:Record<string,unknown>={},headers:Record<string,string>={}){
    return handleApi(new Request(root+'/functions/v1/app',{method:'POST',headers:{'content-type':'application/json','x-telegram-init-data':auth,...headers},body:JSON.stringify({action,slug,...extra})}))
  }
  try{
    const guest=await signed(111),admin=await signed(222)
    for(const action of ['bootstrap','live-refresh','claim-event-ticket','submit-feedback','admin-screen-link','admin-test-room-reset','admin-show-control','admin-checkin-ticket']){
      const res=await call(action,'test-2026-10-17',guest,{op:'start',ticketQr:'test'})
      assert(res.status===403,`${action}: signed non-admin got ${res.status}`)
    }
    for(const headers of [{},{'x-admin-token':'forged'},{'x-test-room-token':'0'.repeat(32)},{'x-demo-telegram-id':'222'}]){
      const res=await call('admin-show-control','test-2026-10-17','',{op:'start'},headers)
      assert(res.status===401,'Forged credentials accepted')
    }
    const guestBootstrap=await call('admin-bootstrap','test-2026-10-17',guest)
    assert(guestBootstrap.status===401,'Guest reached the control desk')
    const link=await call('admin-screen-link','test-2026-10-17',admin)
    assert(link.status===200,'Configured admin could not create screen link')
    const body=await link.json()
    assert(body.screenUrl.includes('token=')&&!body.screenUrl.includes('local-screen-test-key'),'Rehearsal leaked global screen key')
    const crossMode=await call('admin-show-control','test-2026-10-17',admin,{op:'restart_live'})
    assert(crossMode.status===403,'Rehearsal can become live')
    const liveReset=await call('admin-test-room-reset','2026-10-17',admin)
    assert(liveReset.status===403,'Test reset changed real event')
    const sourceTest=await call('admin-show-control','2026-10-17',admin,{op:'restart_test'})
    assert(sourceTest.status===403,'Test run can overwrite a real event')
    assert(writes===0,'Denied actions reached a mutation')
    allowTestTicket=true
    const ticket=await call('claim-event-ticket','test-2026-10-17',admin)
    assert(ticket.status===200,'Admin could not claim rehearsal ticket')
    assert(writes===0,'Rehearsal enqueued a real notification')
  }finally{
    globalThis.fetch=realFetch
    for(const [k,v] of previous)v===undefined?Deno.env.delete(k):Deno.env.set(k,v)
  }
})
