export const TEST_EVENT_SLUG='test-2026-10-03'
export function telegramStartPath(start:string){
  if(start==='test')return `/rehearsal/${TEST_EVENT_SLUG}`
  const invite=/^t_([0-9a-f]{32})$/.exec(start)
  if(invite)return `/rehearsal/${TEST_EVENT_SLUG}?room=${invite[1]}`
  const admin=/^admin_(test-[a-z0-9-]+)$/.exec(start)
  if(admin)return `/admin/${admin[1]}`
  const event=/^event_([a-z0-9-]+)$/i.exec(start)
  return event?`/event/${event[1]}`:''
}
export function testShareUrl(inviteUrl:string){
  const url=new URL(inviteUrl)
  const payload=url.searchParams.get('start')||''
  if(url.origin!=='https://t.me'||url.pathname!=='/nasipateli_v_kinobot'||!/^t_[0-9a-f]{32}$/.test(payload))throw new Error('неверная ссылка приглашения')
  return `https://t.me/share/url?${new URLSearchParams({url:inviteUrl,text:'приглашаю на тестовый вечер «насыпатели в кино». открой бота, нажми «попасть на событие» и проверь вечер вместе со мной. это репетиция, не билет на 17 октября'})}`
}
