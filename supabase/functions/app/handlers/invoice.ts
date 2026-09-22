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

export async function handleInvoice(req:Request){
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return err('POST only',405)
  try{
    const tgUser=await telegramUserFromRequest(req)
    const body=await req.json()
    const slug=String(body.slug||'2026-10-03')
    const db=adminDb()

    const userR=await db.from('users').select('*').eq('telegram_id',tgUser.id).single()
    if(userR.error)throw userR.error
    const evR=await db.from('events').select('*').eq('slug',slug).single()
    if(evR.error)throw evR.error
    const ev=evR.data
    if(ev.status!=='SALES_OPEN') return err('Ticket sales are closed',409)
    const provider=Deno.env.get('TELEGRAM_PROVIDER_TOKEN')
    if(!provider)return err('Продажи ещё не подключены. Билет пока можно получить только как тестовый через организатора.',503)

    const prof=await db.from('cinema_profiles').select('profile_json').eq('user_id',userR.data.id).maybeSingle()
    if(prof.error)throw prof.error
    if(prof.data?.profile_json?.completed!==true)return err('Сначала завершите обязательный кинопрофиль.',409)
    const reserve=await db.rpc('reserve_event_spot',{
      p_event_id:ev.id,
      p_user_id:userR.data.id,
      p_amount_rub:Number(ev.ticket_price_rub),
      p_photo_video_consent:!!prof.data?.profile_json?.photo_video_consent
    })
    if(reserve.error)throw reserve.error
    const slot=reserve.data?.[0]
    if(!slot)throw new Error('Reservation failed')
    if(['paid','attended'].includes(slot.reservation_status))return json({alreadyPaid:true})
    if(slot.reservation_status==='waitlist')return json({waitlist:true,queuePosition:slot.queue_position},409)

    const invoice=await tg('createInvoiceLink',{
      title:'НАСЫПАТЕЛИ В КИНО',
      description:`Билет на ${ev.title}`,
      payload:`ticket:${ev.id}:${userR.data.id}`,
      provider_token:provider,
      currency:'RUB',
      prices:[{label:'Билет',amount:Number(ev.ticket_price_rub)*100}]
    })
    return json({invoiceUrl:invoice,reservedUntil:slot.reservation_expires_at})
  }catch(e){
    console.error(e)
    return err('Не удалось подготовить оплату. Попробуйте ещё раз.',500)
  }
}
