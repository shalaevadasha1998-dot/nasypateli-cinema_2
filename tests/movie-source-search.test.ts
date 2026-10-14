import { discoverMovieSourcesFast, preferredMovieSource } from '../supabase/functions/app/_shared/movies.ts'
import { sourceTitleMatch } from '../supabase/functions/app/_shared/videoValidation.ts'
function assert(v:unknown,m:string){if(!v)throw Error(m)}
const movie={title:'The Kid',original_title:'The Kid',year:1921}
const json=(x:unknown,status=200)=>Response.json(x,{status})
Deno.test('fast discovery continues through other platforms when YouTube fails and rejects non-video archive URLs',async()=>{
 const original=globalThis.fetch;let probed=0,trailers=0
 globalThis.fetch=async(input,init)=>{
  const url=String(input)
  if(url.includes('youtube.com'))return json({},503)
  if(url.includes('rutube.ru'))return json({results:[]})
  if(url.includes('commons.wikimedia.org'))return json({query:{pages:{}}})
  if(url.includes('advancedsearch.php')){if(url.includes('title%3Atrailer'))trailers++;return json({response:{docs:[{identifier:'kid',title:'The Kid',year:1921,licenseurl:'https://creativecommons.org/publicdomain/mark/1.0/'},{identifier:'news',title:'The Kid Detective',year:2020}]}})}
  if(url.includes('/metadata/kid'))return json({files:[{name:'broken.mp4',size:'4000'},{name:'film.webm',size:'5000'}],metadata:{year:1921}})
  if(url.includes('/download/')){probed++;assert(new Headers(init?.headers).get('Range')==='bytes=0-1023','Unbounded file request');return url.endsWith('.mp4')?new Response('<html>unavailable</html>',{headers:{'content-type':'text/html'}}):new Response(new Uint8Array([0x1a,0x45,0xdf,0xa3,0,0,0,0]),{status:206,headers:{'content-type':'video/webm'}})}
  throw Error('Unexpected network '+url)
 }
 try{const r=await discoverMovieSourcesFast(movie);assert(r.candidates.length===1,'Wrong source count');assert(r.candidates[0].sourcePlatform==='internet_archive','YouTube failure blocked fallback');assert(r.candidates[0].metadata.availabilityCheck==='video_bytes','File not verified');assert(probed===2,'Broken URL not skipped');assert(!r.fallbackUsed&&trailers===0,'Unnecessary trailer fallback')}finally{globalThis.fetch=original}
})
Deno.test('Rutube excludes paid, geo-blocked and trailer results before automatic selection',async()=>{
 const original=globalThis.fetch;const ids=['a','b','c','d'].map(x=>x.repeat(32))
 globalThis.fetch=async(input)=>{
  const url=String(input)
  if(url.includes('/api/search/video/'))return json({results:ids.map(id=>({id}))})
  if(url.includes('/api/video/')){const id=ids.find(x=>url.includes(x));return json({title:'The Kid (1921) scene',description:id===ids[2]?'Official Movie Trailer':'a scene from the film',duration:150,is_paid:id===ids[0],restrictions:{country:{allowed:['RU'],restricted:id===ids[1]?['RU']:[]}},action_reason:{id:0}})}
  if(url.includes('advancedsearch'))return json({response:{docs:[]}})
  if(url.includes('commons'))return json({query:{pages:{}}})
  return json({},503)
 }
 try{const r=await discoverMovieSourcesFast(movie);assert(r.candidates.length===1,'Unavailable or misleading clip survived');assert(r.candidates[0].videoId===ids[3],'Wrong region source selected');assert(r.trace.providers.rutube===1,'Provider trace missing')}finally{globalThis.fetch=original}
})
Deno.test('source identity rejects trailer descriptions and accepts numbered movie scene labels',()=>{
 assert(sourceTitleMatch('The Kid (1921) Featurettes',movie)===0,'DVD extra survives as film scene')
 assert(sourceTitleMatch('The Wolf and The Kid (1921).webm',movie)===0,'Different film with same title suffix survived')
 assert(sourceTitleMatch('The Kid (1921) scene',movie,{description:'Official Movie Trailer'})===0,'Trailer description ignored')
 assert(sourceTitleMatch('Mother (3/12) Movie CLIP (2009)',{title:'Mother',year:2009})>0,'Numbered scene rejected')
})
Deno.test('confirmed video bytes rank ahead of untested embed metadata',()=>{
 const base={useMode:'fragment' as const,sourceUrl:'https://archive.org/download/kid/film.mp4',startSec:0,verified:true,embeddable:true,official:false,rightsStatus:'unknown' as const,confidence:.9}
 const direct={...base,sourceType:'full_film' as const,sourcePlatform:'internet_archive',metadata:{availabilityCheck:'video_bytes'}}
 const embed={...base,sourceType:'clip' as const,sourcePlatform:'youtube',sourceUrl:'https://www.youtube.com/watch?v=foo',metadata:{availabilityCheck:'embed_metadata'}}
 assert(preferredMovieSource([embed,direct])===direct,'Unverified embed outranks a responding file')
})
