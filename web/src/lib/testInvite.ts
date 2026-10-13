export const TEST_EVENT_SLUG='test-2026-10-03'
export function telegramStartPath(start:string){
  const invite=/^test_(test-[a-z0-9-]+)_([0-9a-f]{64})$/.exec(start)
  if(invite)return `/rehearsal/${invite[1]}?room=${invite[2]}`
  const admin=/^admin_(test-[a-z0-9-]+)$/.exec(start)
  if(admin)return `/admin/${admin[1]}`
  const event=/^event_([a-z0-9-]+)$/i.exec(start)
  return event?`/event/${event[1]}`:''
}
export function testShareUrl(inviteUrl:string){
  const url=new URL(inviteUrl)
  if(url.origin!=='https://t.me'||url.pathname!=='/nasipateli_v_kinobot'||!/^test_test-[a-z0-9-]+_[0-9a-f]{64}$/.test(url.searchParams.get('startapp')||''))throw new Error('неверная ссылка приглашения')
  return `https://t.me/share/url?${new URLSearchParams({url:inviteUrl,text:'приглашаю на тестовый вечер «насыпатели в кино». открой ссылку в Telegram — у каждого свой профиль и свои голоса. это репетиция, не билет на 17 октября'})}`
}
