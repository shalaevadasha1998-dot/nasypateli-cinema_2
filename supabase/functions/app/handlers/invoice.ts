import { adminDb } from '../_shared/db.ts'
import { cors, err, json } from '../_shared/http.ts'
import { telegramUserFromRequest } from '../_shared/telegram.ts'

async function tg(method:string,body:Record<string,unknown>){
  const token=Deno.env.get('TELEGRAM_BOT_TOKEN')
  if(!token)throw new Error('TELEGRAM_BOT_TOKEN missing')
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const j=await r.json()
  if(!j.ok)throw new Error(j.description||method)
  return j.result
}

async function sha256Hex(value:string){
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))
  return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('')
}

async function standaloneUserFromRequest(db:any,req:Request){
  const token=String(req.headers.get('x-pwa-session')||'').trim()
  if(!token)return null
  if(token.length<32||token.length>256)return null
  const hash=await sha256Hex(token)
  const session=await db.from('pwa_sessions').select('id,user_id,expires_at,revoked_at').eq('token_hash',hash).maybeSingle()
  if(session.error)throw session.error
  if(!session.data||session.data.revoked_at||new Date(session.data.expires_at).getTime()<=Date.now())return null
  const user=await db.from('users').select('*').eq('id',session.data.user_id).maybeSingle()
  if(user.error)throw user.error
  if(!user.data)return null
  const touched=await db.from('pwa_sessions').update({last_seen_at:new Date().toISOString()}).eq('id',session.data.id)
  if(touched.error)console.warn('pwa invoice session touch failed',String(touched.error.message||touched.error))
  return user.data
}

export async function handleInvoice(req:Request){
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return err('Нужен POST-запрос',405)
  try{
    const body=await req.json()
    const slug=String(body.slug||'2026-10-03')
    const db=adminDb()

    let user=await standaloneUserFromRequest(db,req)
    if(!user){
      const tgUser=await telegramUserFromRequest(req)
      const userR=await db.from('users').select('*').eq('telegram_id',tgUser.id).single()
      if(userR.error)throw userR.error
      user=userR.data
    }
    if(!user)return err('Нужно войти в приложение заново',401)
    const evR=await db.from('events').select('*').eq('slug',slug).single()
    if(evR.error)throw evR.error
    const ev=evR.data
    if(ev.status!=='SALES_OPEN') return err('Продажа билетов сейчас закрыта',409)
    const provider=Deno.env.get('TELEGRAM_PROVIDER_TOKEN')
    if(!provider)return err('Продажи ещё не подключены. Билет пока можно получить только как тестовый через организатора.',503)

    const prof=await db.from('cinema_profiles').select('profile_json').eq('user_id',user.id).maybeSingle()
    if(prof.error)throw prof.error
    if(prof.data?.profile_json?.completed!==true)return err('Сначала завершите обязательный кинопрофиль.',409)
    const reserve=await db.rpc('reserve_event_spot',{
      p_event_id:ev.id,
      p_user_id:user.id,
      p_amount_rub:Number(ev.ticket_price_rub),
      p_photo_video_consent:!!prof.data?.profile_json?.photo_video_consent
    })
    if(reserve.error)throw reserve.error
    const slot=reserve.data?.[0]
    if(!slot)throw new Error('Не удалось зарезервировать место')
    if(['paid','attended'].includes(slot.reservation_status))return json({alreadyPaid:true})
    if(slot.reservation_status==='waitlist')return json({waitlist:true,queuePosition:slot.queue_position},409)

    const providerData=String(Deno.env.get('TELEGRAM_PROVIDER_DATA_JSON')||'').trim()
    const requireReceiptEmail=String(Deno.env.get('TELEGRAM_REQUIRE_RECEIPT_EMAIL')||'').trim()==='true'
    const invoice=await tg('createInvoiceLink',{
      title:'НАСЫПАТЕЛИ В КИНО',
      description:`Билет на ${ev.title}`,
      payload:`ticket:${ev.id}:${user.id}`,
      provider_token:provider,
      currency:'RUB',
      prices:[{label:'Билет',amount:Number(ev.ticket_price_rub)*100}],
      start_parameter:`ticket_${String(slot.registration_id||ev.id).replace(/[^A-Za-z0-9_-]/g,'').slice(0,56)}`,
      ...(requireReceiptEmail?{need_email:true,send_email_to_provider:true}:{}),
      ...(providerData?{provider_data:providerData}:{})
    })
    return json({invoiceUrl:invoice,reservedUntil:slot.reservation_expires_at})
  }catch(e){
    console.error(e)
    return err('Не удалось подготовить оплату. Попробуйте ещё раз.',500)
  }
}
