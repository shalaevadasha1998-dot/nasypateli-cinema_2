const endpoint='https://api.openai.com/v1/responses'

type BaseArgs={instructions:string;input:string;maxOutputTokens?:number;model?:string;reasoningEffort?:'none'|'minimal'|'low'|'medium'|'high'|'xhigh'}

function apiKey(){const key=Deno.env.get('OPENAI_API_KEY');if(!key)throw new Error('OPENAI_API_KEY is missing');return key}
function modelFor(args:{model?:string}){return args.model||Deno.env.get('OPENAI_MODEL')||'gpt-5.6-luna'}

async function run(body:Record<string,unknown>){
  const r=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${apiKey()}`,'content-type':'application/json'},body:JSON.stringify(body)})
  const json=await r.json();if(!r.ok)throw new Error(json?.error?.message||`OpenAI ${r.status}`)
  const text=json.output_text || json.output?.flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==='output_text')?.text
  if(!text)throw new Error('OpenAI returned no output_text');return {text:String(text),raw:json}
}

export async function structuredResponse<T>(args:BaseArgs&{name:string;schema:Record<string,unknown>}):Promise<T>{
  const body={model:modelFor(args),instructions:args.instructions,input:args.input,max_output_tokens:args.maxOutputTokens||1200,reasoning:{effort:args.reasoningEffort||'none'},text:{format:{type:'json_schema',name:args.name,strict:true,schema:args.schema}}}
  const {text}=await run(body);return JSON.parse(text) as T
}

export async function textResponse(args:BaseArgs):Promise<string>{
  const body={model:modelFor(args),instructions:args.instructions,input:args.input,max_output_tokens:args.maxOutputTokens||500,reasoning:{effort:args.reasoningEffort||'none'}}
  const {text}=await run(body);return text.trim()
}

export async function transcribeAudio(bytes:Uint8Array,mimeType='audio/webm'){
  const form=new FormData();const ext=mimeType.includes('mp4')?'m4a':mimeType.includes('ogg')?'ogg':mimeType.includes('wav')?'wav':'webm'
  form.append('file',new Blob([bytes],{type:mimeType}),`voice.${ext}`);form.append('model',Deno.env.get('OPENAI_TRANSCRIBE_MODEL')||'gpt-4o-mini-transcribe');form.append('language','ru')
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{authorization:`Bearer ${apiKey()}`},body:form});const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||`OpenAI transcription ${r.status}`);return String(j.text||'').trim()
}
