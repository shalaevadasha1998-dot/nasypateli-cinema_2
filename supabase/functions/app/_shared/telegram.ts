export type TelegramUser={id:number;first_name?:string;last_name?:string;username?:string;language_code?:string;photo_url?:string}

function hex(bytes:ArrayBuffer){return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('')}

async function hmac(key:CryptoKey,data:string){return crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data))}
async function importHmac(raw:Uint8Array){return crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign'])}

export async function validateTelegramInitData(initData:string,maxAgeSeconds=86400):Promise<TelegramUser>{
  const botToken=Deno.env.get('TELEGRAM_BOT_TOKEN')
  if(!botToken) throw new Error('TELEGRAM_BOT_TOKEN is missing')
  if(!initData) throw new Error('Telegram initData is missing')
  const params=new URLSearchParams(initData)
  const receivedHash=params.get('hash')
  if(!receivedHash) throw new Error('Telegram hash is missing')
  params.delete('hash')
  const dataCheck=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')

  const webAppDataKey=await importHmac(new TextEncoder().encode('WebAppData'))
  const secretRaw=new Uint8Array(await hmac(webAppDataKey,botToken))
  const secretKey=await importHmac(secretRaw)
  const signature=await hmac(secretKey,dataCheck)
  const computedHash=hex(signature)
  if(computedHash.length!==receivedHash.length) throw new Error('Invalid Telegram signature')
  let diff=0
  for(let i=0;i<computedHash.length;i++) diff |= computedHash.charCodeAt(i)^receivedHash.charCodeAt(i)
  if(diff!==0) throw new Error('Invalid Telegram signature')

  const authDate=Number(params.get('auth_date')||0)
  if(!authDate || Math.abs(Date.now()/1000-authDate)>maxAgeSeconds) throw new Error('Telegram initData expired')
  const rawUser=params.get('user')
  if(!rawUser) throw new Error('Telegram user is missing')
  const user=JSON.parse(rawUser) as TelegramUser
  if(!user.id) throw new Error('Telegram user id is missing')
  return user
}

export async function telegramUserFromRequest(req:Request):Promise<TelegramUser>{
  if(Deno.env.get('ALLOW_DEMO_AUTH')==='true'){
    const demo=req.headers.get('x-demo-telegram-id')
    if(demo) return {id:Number(demo),first_name:'Demo',username:'demo'}
  }
  return validateTelegramInitData(req.headers.get('x-telegram-init-data')||'')
}

export function isConfiguredAdmin(user:TelegramUser){
  const ids=(Deno.env.get('ADMIN_TELEGRAM_IDS')||'').split(',').map(x=>x.trim()).filter(Boolean)
  const usernames=(Deno.env.get('ADMIN_TELEGRAM_USERNAMES')||'').split(',').map(x=>x.trim().replace(/^@/,'').toLowerCase()).filter(Boolean)
  return ids.includes(String(user.id)) || (!!user.username && usernames.includes(user.username.toLowerCase()))
}
