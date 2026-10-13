// Participant capability only: never accepted by admin or screen authentication.
export async function testInviteToken(event:{id:string;slug:string;settings?:any}){
  if(event.settings?.test_room!==true||!/^test-[a-z0-9-]+$/.test(event.slug))throw new Error('Not a test room')
  const secret=Deno.env.get('TELEGRAM_BOT_TOKEN')
  if(!secret)throw new Error('Telegram is not configured')
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`test-participant-v1:${event.id}:${event.slug}`))
  return [...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32)
}

export async function testInviteMatches(event:any,token:string){
  if(event?.settings?.test_room!==true||!/^test-[a-z0-9-]+$/.test(event.slug)||!/^[0-9a-f]{32}$/.test(token))return false
  const expected=await testInviteToken(event)
  let diff=0
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^token.charCodeAt(i)
  return diff===0
}
