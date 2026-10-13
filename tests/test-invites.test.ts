import { testInviteToken, testInviteMatches } from '../supabase/functions/app/_shared/testInvite.ts'
import { telegramStartPath, testShareUrl } from '../web/src/lib/testInvite.ts'

function check(value:unknown,message:string){if(!value)throw new Error(message)}
Deno.test('participant capability is bound to a test event and routes without admin credentials',async()=>{
  Deno.env.set('TELEGRAM_BOT_TOKEN','local-test-token')
  const event={id:'test-event-id',slug:'test-2026-10-03',settings:{test_room:true}}
  const token=await testInviteToken(event)
  check(await testInviteMatches(event,token),'valid invite rejected')
  check(!await testInviteMatches({...event,id:'other-event'},token),'cross-event capability accepted')
  check(!await testInviteMatches({...event,settings:{}},token),'live event accepted')
  check(!await testInviteMatches(event,'0'.repeat(64)),'forged capability accepted')
  const url=`https://t.me/nasipateli_v_kinobot?startapp=test_${event.slug}_${token}`
  const share=new URL(testShareUrl(url))
  check(share.searchParams.get('url')===url,'invite corrupted by share encoding')
  check(!share.href.includes('local-test-token'),'secret leaked')
  check(telegramStartPath(new URL(url).searchParams.get('startapp')!)===`/rehearsal/${event.slug}?room=${token}`,'wrong participant route')
  check(telegramStartPath('admin_test-2026-10-03')==='/admin/test-2026-10-03','wrong admin route')
  check(telegramStartPath('event_2026-10-17')==='/event/2026-10-17','live event routing changed')
  check(telegramStartPath('test_2026-10-17_'+token)==='','live event test route accepted')
  check(telegramStartPath('test_test-2026-10-03_bad')==='','malformed invite routed')
})
