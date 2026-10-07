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
async function sha256Hex(value:string){
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))
  return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('')
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
        const amountOk=Number(q.total_amount)===Number(reg.data?.amount_rub||0)*100
        const currencyOk=String(q.currency)==='RUB'
        const payerOk=Number(q.from?.id)===Number(payer.data?.telegram_id)
        if(amountOk&&currencyOk&&payerOk){
          const authorized=await db.rpc('authorize_telegram_checkout',{
            p_event_id:parsed.eventId,p_user_id:parsed.userId,p_amount_rub:Number(reg.data?.amount_rub||0)
          })
          if(authorized.error)throw authorized.error
          const auth=authorized.data?.[0]
          ok=auth?.ok===true
          if(!ok){
            if(auth?.reason==='already_paid')errorMessage='Этот билет уже оплачен.'
            else if(auth?.reason==='sales_closed')errorMessage='Продажа билетов уже закрыта.'
            else if(auth?.reason==='reservation_expired')errorMessage='Резерв места истёк. Откройте мини-приложение и зарезервируйте место заново.'
          }
        }else if(!payerOk) errorMessage='Эта ссылка на оплату создана для другого Telegram-аккаунта.'
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
          const confirmed=await db.rpc('confirm_telegram_payment',{
            p_event_id:parsed.eventId,
            p_user_id:parsed.userId,
            p_amount_rub:Number(reg.data.amount_rub||0),
            p_provider_payment_id:p.provider_payment_charge_id||null,
            p_telegram_charge_id:p.telegram_payment_charge_id||null
          })
          if(confirmed.error)throw confirmed.error
          const result=confirmed.data?.[0]
          if(result&&!result.already_confirmed){
            await emitStoryTrigger(db,parsed.userId,'ticket_paid',{seats_left:Number(result.seats_left||0)},parsed.eventId)
          }
          paymentAccepted=!!result
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
      const payload=String(msg.text||'').split(/\s+/)[1]||'';let launchUrl=webAppUrl;let buttonText='открыть клуб';let intro='это НАСЫПАТЕЛИ В КИНО. здесь билеты, животина, знакомства и механики вечера'
      if(payload.startsWith('encounter_')&&webAppUrl){const token=payload.slice('encounter_'.length);const t=await db.from('encounter_tokens').select('kind').eq('token',token).maybeSingle();const u=new URL(webAppUrl);u.searchParams.set('encounter',token);launchUrl=u.toString();buttonText=t.data?.kind==='event_checkin'?'отметиться на событии':'встретить животину';intro=t.data?.kind==='event_checkin'?'откройте НАСЫПАТЕЛИ В КИНО, чтобы отметиться на событии':'кажется, ваши животины сейчас встретятся'}
      if(payload.startsWith('rehearsal_')&&webAppUrl){
        const token=payload.slice('rehearsal_'.length)
        const hash=await sha256Hex(token)
        const rooms=await db.from('events').select('slug,title,settings').like('slug','test-%')
        if(rooms.error)throw rooms.error
        const room=(rooms.data||[]).find((x:any)=>x.settings?.test_room===true&&String(x.settings?.test_room_token_hash||'')===hash)
        if(room){
          const u=new URL(webAppUrl)
          u.hash=`/rehearsal/${room.slug}?room=${encodeURIComponent(token)}`
          launchUrl=u.toString()
          buttonText='открыть тестовую комнату'
          intro='репетиция завтрашнего вечера. откроется ваш настоящий профиль и животина, а ответы будут записываться только в тестовую комнату'
        }else{
          launchUrl=''
          intro='эта тестовая ссылка больше не действует'
        }
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
