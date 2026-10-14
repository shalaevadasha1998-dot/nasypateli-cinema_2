import { RutubeVideo, rutubeVideoId } from './RutubeVideo'
import { useContext, useEffect, useRef, useState } from 'react'
import { PlaybackContext, projectorSessionId, type PlaybackSample } from './PlaybackContext'

let youtubeReady:Promise<any>|undefined
function loadYoutube(){
  if((window as any).YT?.Player)return Promise.resolve((window as any).YT)
  if(!youtubeReady)youtubeReady=new Promise((resolve,reject)=>{
    const script=document.createElement('script')
    const timeout=window.setTimeout(()=>reject(Error('youtube не отвечает')),15000)
    ;(window as any).onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);resolve((window as any).YT)}
    script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{clearTimeout(timeout);reject(Error('youtube недоступен'))};document.head.appendChild(script)
  }).catch(e=>{youtubeReady=undefined;throw e})
  return youtubeReady
}
type PlayerProps={start:number;end?:number;title:string;paused:boolean;autoplay:boolean;onSample:(sample:PlaybackSample)=>void}
function YoutubeVideo({id,start,end,title,paused,autoplay,onSample}:PlayerProps&{id:string}){
  const host=useRef<HTMLDivElement>(null),playerRef=useRef<any>(null),callback=useRef(onSample),pauseRef=useRef(paused)
  callback.current=onSample;pauseRef.current=paused
  useEffect(()=>{
    let dead=false,player:any,finished=false,blocked=false,timer:number|undefined
    const sample=()=>{
      if(dead||!player?.getCurrentTime)return
      const position=Number(player.getCurrentTime()),state=Number(player.getPlayerState())
      if(!Number.isFinite(position))return
      if(!finished&&end!==undefined&&position>=end-.15&&state===1){finished=true;player.pauseVideo()}
      const status=finished?'ended':blocked?'blocked':state===1?'playing':state===2?'paused':state===3?'buffering':state===0?(end!==undefined&&position>=end-.3?'ended':'error'):'loading'
      callback.current({status,position})
    }
    loadYoutube().then(YT=>{
      if(dead||!host.current)return
      const mount=document.createElement('div');host.current.replaceChildren(mount)
      player=new YT.Player(mount,{videoId:id,playerVars:{autoplay:autoplay&&!pauseRef.current?1:0,controls:1,rel:0,playsinline:1,start,...(end?{end}:{}),origin:location.origin},events:{
        onReady:()=>{player.getIframe()?.setAttribute('title',title);if(pauseRef.current)player.pauseVideo();timer=window.setInterval(sample,250)},
        onStateChange:(event:any)=>{if(event.data===1)blocked=false;sample()},
        onAutoplayBlocked:()=>{blocked=true;callback.current({status:'blocked',position:Number(player?.getCurrentTime?.()||start)})},
        onError:()=>{if(!dead)callback.current({status:'error',position:Number(player?.getCurrentTime?.()||start)})}
      }});playerRef.current=player
    }).catch(()=>{if(!dead)callback.current({status:'error',position:start})})
    return()=>{dead=true;clearInterval(timer);player?.destroy();playerRef.current=null}
  },[id,start,end,autoplay])
  useEffect(()=>{const p=playerRef.current;if(paused)p?.pauseVideo?.();else if(autoplay)p?.playVideo?.()},[paused,autoplay])
  return <div className="youtube-host" ref={host}/>
}
function DirectVideo({src,start,end,title,paused,autoplay,onSample}:PlayerProps&{src:string}){
  const ref=useRef<HTMLVideoElement>(null),done=useRef(false)
  const safe=(()=>{try{const u=new URL(src);return ['https:','blob:'].includes(u.protocol)?u.href:undefined}catch{return undefined}})()
  const emit=(status:PlaybackSample['status'])=>onSample({status:done.current?'ended':status,position:ref.current?.currentTime||start})
  useEffect(()=>{const v=ref.current;if(!v)return;if(paused)v.pause();else if(autoplay&&!done.current&&v.readyState>=1)void v.play().catch(()=>emit('blocked'))},[paused,autoplay])
  return <video ref={ref} src={safe} title={title} playsInline controls preload="auto" onError={()=>emit('error')} onWaiting={()=>emit('buffering')} onStalled={()=>emit('buffering')} onPause={()=>emit('paused')} onPlaying={()=>emit('playing')} onEnded={()=>emit(end===undefined||Number(ref.current?.currentTime)>=end-.3?'ended':'error')} onLoadedMetadata={()=>{const v=ref.current;if(v){v.currentTime=start;if(autoplay&&!paused)void v.play().catch(()=>emit('blocked'))}}} onTimeUpdate={()=>{const v=ref.current;if(!v)return;if(end!==undefined&&v.currentTime>=end-.1){done.current=true;v.pause();emit('ended')}else emit(v.paused?'paused':'playing')}}/>
}
const localMovies=new Map<string,string>()
window.addEventListener('pagehide',(event)=>{if(event.persisted)return;for(const src of localMovies.values())URL.revokeObjectURL(src);localMovies.clear()})
function sourceKey(media:any):string{
  const p=String(media?.sourcePlatform||'youtube')
  if(p==='youtube')return `youtube:${media.videoId}`
  if(p==='rutube')return `rutube:${rutubeVideoId(media).toLowerCase()}`
  try{return `${p}:${new URL(media.sourceUrl).href}`}catch{return ''}
}
const statusText:Record<PlaybackSample['status'],string>={loading:'загружаем фрагмент · шоу ждёт',playing:'идёт показ',buffering:'пауза показа · загрузка или реклама',paused:'видео на паузе · шоу ждёт',ended:'фрагмент показан полностью',error:'ошибка видео · шоу приостановлено',blocked:'нажми воспроизведение в плеере · автозапуск заблокирован'}
export function ProjectorMedia({media,title}:{media:any;title:string}){
  const context=useContext(PlaybackContext),ctx=useRef(context);ctx.current=context
  const identity=sourceKey(media),start=Math.max(0,Number(media?.startSec||0)),end=Number(media?.endSec)>start?Number(media.endSec):undefined
  const [backup,setBackup]=useState(-1),[local,setLocal]=useState(()=>localMovies.get(identity)||''),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0)
  const [status,setStatus]=useState<PlaybackSample['status']>('loading'),[connectionError,setConnectionError]=useState(false)
  const sample=useRef<PlaybackSample>({status:'loading',position:start}),progressAt=useRef(Date.now()),lastPosition=useRef(start),picker=useRef<HTMLInputElement>(null),seq=useRef(0)
  const approved=(Array.isArray(media?.backups)?media.backups:[]).filter((b:any)=>b.sameCut===true&&Number(b.startSec)===start&&Number(b.endSec)===end)
  const selected=backup>=0?approved[backup]:media
  const activeKey=local?identity:sourceKey(selected)
  const onSample=(next:PlaybackSample)=>{
    if(!Number.isFinite(next.position))return
    if(next.position>lastPosition.current+.05)progressAt.current=Date.now()
    lastPosition.current=next.position;sample.current=next;setStatus(next.status)
    if(next.status==='error')setFailed(true)
  }
  useEffect(()=>{setBackup(context&&media?.sourcePlatform==='youtube'?approved.findIndex((b:any)=>['direct','internet_archive','wikimedia_commons'].includes(b.sourcePlatform)):-1);setLocal(localMovies.get(identity)||'');setFailed(false)},[identity,start,end,context?.revision])
  useEffect(()=>{
    sample.current={status:'loading',position:start};lastPosition.current=start;progressAt.current=Date.now();setStatus('loading')
    const fence=ctx.current?{runId:ctx.current.runId,projectorRevision:ctx.current.revision}:null
    let dead=false,pending=false
    const tick=async()=>{
      if(dead)return
      const current=sample.current
      if(ctx.current&&['loading','playing','buffering'].includes(current.status)&&Date.now()-progressAt.current>15000){sample.current={...current,status:'error'};setStatus('error');setFailed(true)}
      if(!ctx.current||!fence||pending)return
      pending=true
      try{const result=await ctx.current.report({...sample.current,...fence,sessionId:projectorSessionId,seq:++seq.current,sourceKey:activeKey,localConfirmed:!!local});if(!dead){setConnectionError(result?.accepted!==true);if(result?.accepted&&(result?.status==='error'||(result?.status==='blocked'&&activeKey.startsWith('youtube:')&&!local))){sample.current={...sample.current,status:'error'};setStatus('error');setFailed(true)}}}catch{if(!dead)setConnectionError(true)}finally{pending=false}
    }
    void tick();const timer=window.setInterval(()=>void tick(),1500)
    return()=>{dead=true;window.clearInterval(timer)}
  },[identity,activeKey,start,end,retry,context?.revision,context?.runId,!!local])
  useEffect(()=>{if(!failed||local||backup+1>=approved.length)return;const timer=window.setTimeout(()=>{setBackup(x=>x+1);setFailed(false);setRetry(x=>x+1)},2000);return()=>clearTimeout(timer)},[failed,backup,approved.length,local])
  const choose=(file?:File)=>{
    if(!file||!window.confirm('ты проверила, что это тот же монтаж, язык и таймкоды? другой файл нельзя использовать с этими вопросами'))return
    const old=localMovies.get(identity);if(old)URL.revokeObjectURL(old)
    const src=URL.createObjectURL(file);localMovies.set(identity,src);setLocal(src);setFailed(false);setRetry(x=>x+1)
  }
  const p=String(selected?.sourcePlatform||'youtube'),rutubeId=p==='rutube'?rutubeVideoId(selected):'',direct=local||(['internet_archive','wikimedia_commons','direct'].includes(p)?String(selected?.sourceUrl||''):'')
  const props:PlayerProps={start,end,title,paused:context?.paused===true,autoplay:!!context,onSample}
  const ready=!!direct||!!rutubeId||(p==='youtube'&&!!selected?.videoId)
  return <div className="screen-video-wrap projector-media" data-playback-status={status}>
    {!failed&&(direct?<DirectVideo key={direct+start+retry} {...props} src={direct}/>:rutubeId?<RutubeVideo key={rutubeId+start+retry} {...props} id={rutubeId}/>:p==='youtube'&&selected?.videoId?<YoutubeVideo key={activeKey+start+retry} {...props} id={String(selected.videoId)}/>:null)}
    <div className="projector-playback-status" role="status" aria-live="polite">{connectionError?'нет подтверждения от сервера · переход заблокирован':statusText[status]}{backup>=0?' · резерв '+(backup+1):''}</div>
    {(failed||!ready)&&<div className="projector-media-error" role="alert"><span>показ приостановлен</span><h2>{title}</h2><p>{backup+1<approved.length&&!local?'переключаем на проверенную копию того же фрагмента':(activeKey.startsWith('youtube:')&&!local?'youtube не подтверждает границу рекламы и фильма · открой проверенную копию того же монтажа':'проверь сеть или открой тот же монтаж с ноутбука')}</p><button onClick={()=>{setFailed(false);setRetry(x=>x+1)}}>повторить фрагмент с начала</button><button onClick={()=>picker.current?.click()}>открыть проверенный файл</button></div>}
    {!failed&&<button className="projector-media-backup" onClick={()=>picker.current?.click()}>резервное видео</button>}
    <input ref={picker} type="file" accept="video/*,.mkv" aria-label="резервный видеофайл" hidden onChange={e=>{choose(e.target.files?.[0]);e.target.value=''}}/>
  </div>
}
