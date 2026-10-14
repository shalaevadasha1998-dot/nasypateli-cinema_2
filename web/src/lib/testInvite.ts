// Historical /start links can never grant public test-room entry.
export const TEST_EVENT_SLUG='test-2026-10-17'
export function telegramStartPath(start:string){
  if(start==='test'||/^t_[0-9a-f]{32}$/.test(start))return '/test/2026-10-17'
  const admin=/^admin_(test-[a-z0-9-]+)$/.exec(start)
  if(admin)return '/test/'+admin[1].replace(/^test-/,'')
  const privateEvent=/^private_(private-[a-z0-9-]{8,72})$/.exec(start)
  if(privateEvent)return `/private/${privateEvent[1]}`
  const event=/^event_([a-z0-9-]+)$/i.exec(start)
  return event?`/event/${event[1]}`:''
}
