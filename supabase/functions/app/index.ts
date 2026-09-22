import { handleApi } from './handlers/api.ts'
import { handleInvoice } from './handlers/invoice.ts'
import { handleTelegram } from './handlers/telegram.ts'
import { APP_HTML } from './ui.ts'

Deno.serve(async (req:Request)=>{
  const url=new URL(req.url)
  const mode=url.searchParams.get('mode')
  if(mode==='telegram')return handleTelegram(req)
  if(mode==='invoice')return handleInvoice(req)
  if(req.method==='GET')return new Response(APP_HTML,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})
  return handleApi(req)
})
