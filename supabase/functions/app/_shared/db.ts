import { createClient } from 'npm:@supabase/supabase-js@2'

function secretKey(){
  const modern=Deno.env.get('SUPABASE_SECRET_KEYS')
  if(modern){
    const parsed=JSON.parse(modern)
    if(parsed.default) return parsed.default
  }
  const local=Deno.env.get('SUPABASE_SECRET_KEY')
  if(local) return local
  const legacy=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(legacy) return legacy
  throw new Error('Supabase secret key is missing')
}

export function adminDb(){
  const url=Deno.env.get('SUPABASE_URL')
  if(!url) throw new Error('SUPABASE_URL is missing')
  return createClient(url,secretKey(),{auth:{persistSession:false,autoRefreshToken:false}})
}
