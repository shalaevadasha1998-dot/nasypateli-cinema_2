import { adminDb } from '../_shared/db.ts'
import { json } from '../_shared/http.ts'
import { emitStoryTrigger } from '../_shared/stories.ts'

async function tg(method:string,body:Record<string,unknown>){
  const token=Deno.env.get('TELEGRAM_BOT_TOKEN')
  if(!token)throw new Error('TELEGRAM_BOT_TOKEN missing')
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  const j=await r.json()
  if(!j.ok)throw new Error(j.description||method)
  return j.result
}

function verifyWebhook(req:Request){
  const expected=Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  if(!expected) throw new Error('TELEGRAM_WEBHOOK_SECRET missing')
  return req.headers.get('x-telegram-bot-api-secret-token')===expected
}

function parseTicketPayload(payload:unknown){
  const [prefix,eventId,userId]=String(payload||'').split(':')
  if(prefix!=='ticket'||!eventId||!userId)return null
  return {eventId,userId}
}

function normalizeTelegramUsername(value:any){
  return String(value||'').trim().replace(/^@+/,'').toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,64)
}

async function getOrCreateTelegramUser(db:any,from:any){
  const telegramId=Number(from?.id||0)
  if(!telegramId)throw new Error('telegram user id missing')
  const existing=await db.from('users').select('*').eq('telegram_id',telegramId).maybeSingle()
  if(existing.error)throw existing.error
  const username=normalizeTelegramUsername(from?.username)||null
  const displayName=[from?.first_name,from?.last_name].filter(Boolean).join(' ')||null
  if(existing.data){
    const patch:any={}
    if((existing.data.telegram_username||null)!==username)patch.telegram_username=username
    if(!existing.data.display_name&&displayName)patch.display_name=displayName
    if(Object.keys(patch).length){
      patch.updated_at=new Date().toISOString()
      const updated=await db.from('users').update(patch).eq('id',existing.data.id).select('*').single()
      if(updated.error)throw updated.error
      return updated.data
    }
    return existing.data
  }
  const created=await db.from('users').insert({telegram_id:telegramId,telegram_username:username,display_name:displayName}).select('*').single()
  if(created.error){
    if(String(created.error.code||'')==='23505'){
      const raced=await db.from('users').select('*').eq('telegram_id',telegramId).single()
      if(raced.error)throw raced.error
      return raced.data
    }
    throw created.error
  }
  return created.data
}

async function ensureInviteRegistration(db:any,event:any,userId:string){
  const current=await db.from('registrations').select('id,status').eq('event_id',event.id).eq('user_id',userId).maybeSingle()
  if(current.error)throw current.error
  const now=new Date().toISOString()
  if(current.data){
    if(['paid','attended'].includes(String(current.data.status||'')))return String(current.data.status)
    const updated=await db.from('registrations').update({
      status:'paid',queue_position:null,payment_provider:'invite',amount_rub:0,paid_at:now,reservation_expires_at:null
    }).eq('id',current.data.id).select('status').single()
    if(updated.error)throw updated.error
    return String(updated.data.status)
  }
  const inserted=await db.from('registrations').insert({
    event_id:event.id,user_id:userId,status:'paid',payment_provider:'invite',amount_rub:0,paid_at:now,photo_video_consent:false
  }).select('status').single()
  if(inserted.error)throw inserted.error
  return String(inserted.data.status)
}

export async function handleTelegram(req:Request){
  try{
    if(req.method!=='POST')return json({ok:false},405)
    if(!verifyWebhook(req))return json({ok:false,error:'invalid webhook secret'},401)

    const update=await req.json()
    const webAppUrl=Deno.env.get('TELEGRAM_WEBAPP_URL')||''
    const db=adminDb()

    if(update.pre_checkout_query){
      const q=update.pre_checkout_query
      const parsed=parseTicketPayload(q.invoice_payload)
      let ok=false
      let errorMessage='Не удалось подтвердить билет. Откройте мини-приложение и попробуйте ещё раз.'

      if(parsed){
        const [reg,payer]=await Promise.all([
          db.from('registrations').select('status,amount_rub,reservation_expires_at').eq('event_id',parsed.eventId).eq('user_id',parsed.userId).maybeSingle(),
          db.from('users').select('telegram_id').eq('id',parsed.userId).maybeSingle()
        ])
        if(reg.error)throw reg.error;if(payer.error)throw payer.error
        const notExpired=!!reg.data?.reservation_expires_at && new Date(reg.data.reservation_expires_at).getTime()>Date.now()
        const amountOk=Number(q.total_amount)===Number(reg.data?.amount_rub||0)*100
        const currencyOk=String(q.currency)==='RUB'
        const payerOk=Number(q.from?.id)===Number(payer.data?.telegram_id)
        ok=reg.data?.status==='reserved'&&notExpired&&amountOk&&currencyOk&&payerOk
        if(!payerOk) errorMessage='Эта ссылка на оплату создана для другого Telegram-аккаунта.'
        else if(reg.data?.status==='paid') errorMessage='Этот билет уже оплачен.'
        else if(!notExpired) errorMessage='Резерв места истёк. Откройте мини-приложение и зарезервируйте место заново.'
      }

      await tg('answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok,...(!ok?{error_message:errorMessage}:{})})
      return json({ok:true})
    }

    const msg=update.message
    if(msg?.successful_payment){
      const p=msg.successful_payment
      const parsed=parseTicketPayload(p.invoice_payload)
      let paymentAccepted=false
      if(parsed){
        const [reg,payer]=await Promise.all([
          db.from('registrations').select('status,amount_rub').eq('event_id',parsed.eventId).eq('user_id',parsed.userId).maybeSingle(),
          db.from('users').select('telegram_id').eq('id',parsed.userId).maybeSingle()
        ])
        if(reg.error)throw reg.error;if(payer.error)throw payer.error
        const amountOk=Number(p.total_amount)===Number(reg.data?.amount_rub||0)*100
        const currencyOk=String(p.currency)==='RUB'
        const payerOk=Number(msg.from?.id)===Number(payer.data?.telegram_id)
        const statusOk=['reserved','paid'].includes(reg.data?.status||'')
        if(reg.data&&amountOk&&currencyOk&&payerOk&&statusOk){
          if(reg.data.status!=='paid'){
            const paid=await db.from('registrations').update({
              status:'paid',
              paid_at:new Date().toISOString(),
              reservation_expires_at:null,
              provider_payment_id:p.provider_payment_charge_id||null,
              telegram_payment_charge_id:p.telegram_payment_charge_id||null,
              payment_provider:'telegram'
            }).eq('event_id',parsed.eventId).eq('user_id',parsed.userId)
            if(paid.error)throw paid.error
            const [ev,occupied]=await Promise.all([db.from('events').select('capacity').eq('id',parsed.eventId).single(),db.from('registrations').select('*',{count:'exact',head:true}).eq('event_id',parsed.eventId).in('status',['paid','attended'])]);if(ev.error)throw ev.error;if(occupied.error)throw occupied.error;const seatsLeft=Math.max(0,Number(ev.data?.capacity||0)-Number(occupied.count||0));await emitStoryTrigger(db,parsed.userId,'ticket_paid',{seats_left:seatsLeft},parsed.eventId)
          }
          paymentAccepted=true
        }else{
          console.error('successful_payment validation failed',{eventId:parsed.eventId,userId:parsed.userId,amountOk,currencyOk,payerOk,status:reg.data?.status})
        }
      }
      try{
        await tg('sendMessage',{chat_id:msg.chat.id,text:paymentAccepted?'оплата прошла. билет уже внутри мини-приложения':'платёж получен Telegram, но билет не удалось автоматически подтвердить. напишите организаторам — мы проверим оплату вручную.'})
      }catch(e){console.error('payment confirmation message failed',e)}
      return json({ok:true})
    }

    if(msg?.text?.startsWith('/start')){
      const botUser=await getOrCreateTelegramUser(db,msg.from||{})
      const payload=String(msg.text||'').split(/\s+/)[1]||'';let launchUrl=webAppUrl;let buttonText='открыть клуб';let intro='это насыпатели в кино. здесь билеты, животина, знакомства и механики вечера'
      if(payload.startsWith('invite_')){
        const token=payload.slice('invite_'.length)
        const invite=await db.from('encounter_tokens').select('id,event_id,owner_user_id,expires_at,metadata').eq('token',token).eq('kind','event_invite').maybeSingle()
        if(invite.error)throw invite.error
        if(!invite.data||!invite.data.event_id||!invite.data.expires_at||new Date(invite.data.expires_at).getTime()<=Date.now()){
          await tg('sendMessage',{chat_id:msg.chat.id,text:'это приглашение уже не действует. попроси организатора прислать новое'})
          return json({ok:true})
        }
        const event=await db.from('events').select('id,slug,title,starts_at,status,settings').eq('id',invite.data.event_id).maybeSingle()
        if(event.error)throw event.error
        if(!event.data||event.data.status==='CLOSED'||event.data.settings?.modes?.nepokoy?.enabled!==true||event.data.settings?.access?.mode!=='invite_only'){
          await tg('sendMessage',{chat_id:msg.chat.id,text:'закрытый просмотр по этой ссылке уже недоступен'})
          return json({ok:true})
        }
        const intended=normalizeTelegramUsername(invite.data.metadata?.invited_username)
        const actual=normalizeTelegramUsername(msg.from?.username)
        if(invite.data.owner_user_id&&String(invite.data.owner_user_id)!==String(botUser.id)){
          await tg('sendMessage',{chat_id:msg.chat.id,text:'это персональное приглашение для другого telegram-аккаунта'})
          return json({ok:true})
        }
        if(!invite.data.owner_user_id&&intended&&actual!==intended){
          await tg('sendMessage',{chat_id:msg.chat.id,text:`это приглашение привязано к @${intended}. открой его из нужного telegram-аккаунта`})
          return json({ok:true})
        }
        await ensureInviteRegistration(db,event.data,String(botUser.id))
        const metadata={...(invite.data.metadata||{}),invited_username:intended||actual,delivery:'redeemed',redeemed_at:new Date().toISOString()}
        const saved=await db.from('encounter_tokens').update({owner_user_id:botUser.id,metadata}).eq('id',invite.data.id)
        if(saved.error)throw saved.error
        const date=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(event.data.starts_at))
        intro=`ты внутри закрытого камерного просмотра «${String(event.data.title||'кино')}». место закреплено за тобой. ${date}. остальные детали появятся внутри приложения`
        buttonText='открыть закрытый просмотр'
        launchUrl=webAppUrl
      }else if(payload.startsWith('encounter_')&&webAppUrl){
        const token=payload.slice('encounter_'.length);const t=await db.from('encounter_tokens').select('kind').eq('token',token).maybeSingle();const u=new URL(webAppUrl);u.searchParams.set('encounter',token);launchUrl=u.toString();buttonText=t.data?.kind==='event_checkin'?'отметиться на событии':'встретить животину';intro=t.data?.kind==='event_checkin'?'откройте насыпатели в кино, чтобы отметиться на событии':'кажется, ваши животины сейчас встретятся'
      }
      const reply_markup=launchUrl?{inline_keyboard:[[{text:buttonText,web_app:{url:launchUrl}}]]}:undefined
      await tg('sendMessage',{chat_id:msg.chat.id,text:intro,...(reply_markup?{reply_markup}:{})})
      return json({ok:true})
    }

    if(msg?.text?.startsWith('/paysupport')){
      await tg('sendMessage',{chat_id:msg.chat.id,text:'по вопросам оплаты напишите организаторам. автоматический возврат подключим после теста платёжного провайдера.'})
      return json({ok:true})
    }

    return json({ok:true})
  }catch(e){
    console.error(e)
    return json({ok:false},500)
  }
}
