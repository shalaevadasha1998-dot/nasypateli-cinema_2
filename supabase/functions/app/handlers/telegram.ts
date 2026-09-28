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
              provider_payment_id:p.provider_payment_charge_id||p.telegram_payment_charge_id,
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
      const payload=String(msg.text||'').split(/\s+/)[1]||'';let launchUrl=webAppUrl;let buttonText='открыть клуб';let intro='это НАСЫПАТЕЛИ В КИНО. здесь билеты, Животина, знакомства и механики вечера'
      if(payload.startsWith('encounter_')&&webAppUrl){const token=payload.slice('encounter_'.length);const t=await db.from('encounter_tokens').select('kind').eq('token',token).maybeSingle();const u=new URL(webAppUrl);u.searchParams.set('encounter',token);launchUrl=u.toString();buttonText=t.data?.kind==='event_checkin'?'отметиться на событии':'встретить Животину';intro=t.data?.kind==='event_checkin'?'откройте НАСЫПАТЕЛИ В КИНО, чтобы отметиться на событии':'кажется, ваши Животины сейчас встретятся'}
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
