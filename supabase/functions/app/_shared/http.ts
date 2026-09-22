export const cors={
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'content-type,x-telegram-init-data,x-demo-telegram-id,x-admin-token,x-screen-token,x-cron-token',
  'access-control-allow-methods':'POST,OPTIONS'
}

export function json(data:unknown,status=200){
  return new Response(JSON.stringify(data),{status,headers:{...cors,'content-type':'application/json; charset=utf-8'}})
}
export function err(message:string,status=400){return json({error:message},status)}
