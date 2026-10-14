import { telegramStartPath } from '../web/src/lib/testInvite.ts'
const check=(v:unknown,m:string)=>{if(!v)throw Error(m)}
Deno.test('retired guest invites never route into a participant rehearsal',()=>{
  const token='a'.repeat(32)
  for(const input of ['test',`t_${token}`,'admin_test-2026-10-17'])
    check(telegramStartPath(input)==='/test/2026-10-17','Legacy link bypassed admin hub')
  for(const input of [`test_test-2026-10-17_${token}`,'rehearsal_test-2026-10-17','test_2026-10-17_bad'])
    check(telegramStartPath(input)==='','Retired capability still routes')
  check(telegramStartPath('event_2026-10-17')==='/event/2026-10-17','Guest event link broken')
  check(telegramStartPath('private_private-live-20261014-7c2f4a9b')==='/private/private-live-20261014-7c2f4a9b','Private ticket link broken')
})
