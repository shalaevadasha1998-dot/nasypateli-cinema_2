import { useEffect, useRef } from 'react'
import type { PlaybackSample } from './PlaybackContext'
export function rutubeVideoId(media:{videoId?:string;sourceUrl?:string}){
  if(/^[a-f0-9]{32}$/i.test(String(media.videoId||'')))return media.videoId!
  try{const url=new URL(media.sourceUrl||'');if(url.protocol!=='https:'||url.hostname!=='rutube.ru')return '';return url.pathname.match(/^\/(?:video|play\/embed)\/([a-f0-9]{32})(?:\/|$)/i)?.[1]||''}catch{return ''}
}
export function RutubeVideo({id,start,end,title,paused=false,autoplay=true,onSample,onError}:{id:string;start:number;end?:number;title:string;paused?:boolean;autoplay?:boolean;onSample?:(s:PlaybackSample)=>void;onError?:()=>void}){
  const pauseRef=useRef(paused);pauseRef.current=paused
  const frame=useRef<HTMLIFrameElement>(null),callback=useRef(onSample),fail=useRef(onError);callback.current=onSample;fail.current=onError
  const send=(type:string,data:Record<string,unknown>={})=>frame.current?.contentWindow?.postMessage(JSON.stringify({type,data}),'https://rutube.ru')
  useEffect(()=>{
    let stopped=false,advertising=false,playing=false,position=start
    const emit=(status:PlaybackSample['status'])=>callback.current?.({status,position})
    const timeout=window.setTimeout(()=>{emit('error');fail.current?.()},20000)
    const handle=(event:MessageEvent)=>{
      if(event.origin!=='https://rutube.ru'||event.source!==frame.current?.contentWindow)return
      let m:any;try{m=typeof event.data==='string'?JSON.parse(event.data):event.data}catch{return}
      if(!m||typeof m!=='object')return
      if(m.type==='player:ready'){window.clearTimeout(timeout);if(pauseRef.current)send('player:pause');emit('loading')}
      if(m.type==='player:error'){window.clearTimeout(timeout);emit('error');fail.current?.()}
      if(m.type==='player:adStart'||(m.type==='player:rollState'&&m.data?.state==='play')){advertising=true;emit('buffering')}
      if(m.type==='player:adEnd'||(m.type==='player:rollState'&&m.data?.state==='complete')){advertising=false;emit('loading')}
      if(m.type==='player:currentTime'&&!advertising&&!stopped&&Number.isFinite(Number(m.data?.time))){
        position=Number(m.data.time)
        if(end!==undefined&&position>=end-.15){stopped=true;send('player:pause');emit('ended')}else emit(playing?'playing':'paused')
      }
      if(m.type==='player:changeState'){
        if(stopped){emit('ended');return}
        const state=String(m.data?.state);playing=state==='playing'
        if(advertising)emit('buffering');else if(state==='playing'||state==='paused')emit(state);else if(state==='stopped')emit(end!==undefined&&position>=end-.3?'ended':'error')
      }
      // player:buffering describes buffered ranges, not a playback state; the no-progress watchdog handles stalls.
      if(m.type==='player:playComplete'&&!advertising)emit(end!==undefined&&position>=end-.3?'ended':'error')
    }
    window.addEventListener('message',handle)
    return()=>{window.clearTimeout(timeout);window.removeEventListener('message',handle)}
  },[id,start,end])
  useEffect(()=>{if(paused)send('player:pause');else if(autoplay)send('player:play')},[paused,autoplay])
  const params=new URLSearchParams({t:String(Math.max(0,start)),autoplay:autoplay?'true':'false',q:'720',...(end?{stopTime:String(end)}:{})})
  return <iframe ref={frame} title={title} src={'https://rutube.ru/play/embed/'+id+'?'+params} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>
}
