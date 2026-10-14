import { useEffect, useRef } from 'react'

export function rutubeVideoId(media:{videoId?:string;sourceUrl?:string}){
  if(/^[a-f0-9]{32}$/i.test(media.videoId||''))return media.videoId!
  try{const url=new URL(media.sourceUrl||'');if(url.protocol!=='https:'||url.hostname!=='rutube.ru')return '';return url.pathname.match(/^\/(?:video|play\/embed)\/([a-f0-9]{32})(?:\/|$)/i)?.[1]||''}catch{return ''}
}
export function RutubeVideo({id,start,end,title,onError}:{id:string;start:number;end?:number;title:string;onError:()=>void}){
  const frame=useRef<HTMLIFrameElement>(null)
  const fail=useRef(onError);fail.current=onError
  useEffect(()=>{
    let stopped=false,ready=false
    const timeout=window.setTimeout(()=>fail.current(),20000)
    const handle=(event:MessageEvent)=>{
      if(event.origin!=='https://rutube.ru'||event.source!==frame.current?.contentWindow)return
      let message:any;try{message=typeof event.data==='string'?JSON.parse(event.data):event.data}catch{return}
      if(!message||typeof message!=='object')return
      if(message.type==='player:ready'){ready=true;window.clearTimeout(timeout)}
      if(message.type==='player:error'){window.clearTimeout(timeout);fail.current()}
      if(ready&&!stopped&&end&&message.type==='player:currentTime'&&Number(message.data?.time)>=end){
        stopped=true;frame.current?.contentWindow?.postMessage(JSON.stringify({type:'player:pause',data:{}}),'https://rutube.ru')
      }
    }
    window.addEventListener('message',handle)
    return()=>{window.clearTimeout(timeout);window.removeEventListener('message',handle)}
  },[id,start,end])
  const params=new URLSearchParams({t:String(Math.max(0,start)),autoplay:'true',q:'720',...(end?{stopTime:String(end)}:{})})
  return <iframe ref={frame} title={title} src={'https://rutube.ru/play/embed/'+id+'?'+params} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
}
