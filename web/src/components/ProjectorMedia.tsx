import { useEffect, useRef, useState } from 'react'

let youtubeReady:Promise<any>|undefined
function loadYoutube(){
  if((window as any).YT?.Player)return Promise.resolve((window as any).YT)
  if(!youtubeReady)youtubeReady=new Promise((resolve,reject)=>{
    const script=document.createElement('script')
    const timeout=window.setTimeout(()=>reject(Error('YouTube не отвечает')),15000)
    ;(window as any).onYouTubeIframeAPIReady=()=>{clearTimeout(timeout);resolve((window as any).YT)}
    script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{clearTimeout(timeout);reject(Error('YouTube недоступен'))}
    document.head.appendChild(script)
  }).catch(e=>{youtubeReady=undefined;throw e})
  return youtubeReady
}
function YoutubeVideo({id,start,end,title,onError}:{id:string;start:number;end?:number;title:string;onError:()=>void}){
  const host=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    let dead=false,player:any
    loadYoutube().then(YT=>{
      if(dead||!host.current)return
      const mount=document.createElement('div');host.current.replaceChildren(mount)
      player=new YT.Player(mount,{videoId:id,playerVars:{autoplay:1,controls:1,rel:0,playsinline:1,start,...(end?{end}:{}),origin:location.origin},events:{onReady:()=>{player.getIframe()?.setAttribute('title',title)},onError:()=>{if(!dead)onError()}}})
    }).catch(()=>{if(!dead)onError()})
    return()=>{dead=true;player?.destroy()}
  },[id,start,end])
  return <div className="youtube-host" ref={host}/>
}
function DirectVideo({src,start,end,title,onError}:{src:string;start:number;end?:number;title:string;onError:()=>void}){
  const ref=useRef<HTMLVideoElement>(null)
  return <video ref={ref} src={src} title={title} playsInline controls preload="auto" onError={onError} onLoadedMetadata={()=>{const v=ref.current;if(v){v.currentTime=start;void v.play().catch(()=>{})}}} onTimeUpdate={()=>{const v=ref.current;if(v&&end&&v.currentTime>=end)v.pause()}}/>
}
// Keep the same local movie for subsequent fragments in this projector tab only.
const localMovies=new Map<string,string>()
window.addEventListener('pagehide',()=>{for(const src of localMovies.values())URL.revokeObjectURL(src);localMovies.clear()})
export function ProjectorMedia({media,title}:{media:any;title:string}){
  const identity=String(media?.videoId||media?.sourceUrl||title)
  const [local,setLocal]=useState(()=>localMovies.get(identity)||'')
  const [failed,setFailed]=useState(false)
  const [retry,setRetry]=useState(0)
  const picker=useRef<HTMLInputElement>(null)
  const start=Math.max(0,Number(media?.startSec||0)),end=Number(media?.endSec)>start?Number(media.endSec):undefined
  useEffect(()=>{setLocal(localMovies.get(identity)||'');setFailed(false)},[identity,start])
  const choose=(file?:File)=>{
    if(!file)return
    const old=localMovies.get(identity);if(old)URL.revokeObjectURL(old)
    const src=URL.createObjectURL(file);localMovies.set(identity,src);setLocal(src);setFailed(false)
  }
  const direct=local||(['internet_archive','wikimedia_commons','direct'].includes(media?.sourcePlatform)?String(media?.sourceUrl||''):'')
  return <div className="screen-video-wrap projector-media">
    {!failed&&(direct?<DirectVideo key={direct+start+retry} src={direct} start={start} end={end} title={title} onError={()=>setFailed(true)}/>:media?.videoId?<YoutubeVideo key={identity+start+retry} id={String(media.videoId)} start={start} end={end} title={title} onError={()=>setFailed(true)}/>:null)}
    {failed&&<div className="projector-media-error" role="alert"><span>фрагмент недоступен</span><h2>{title}</h2><p>источник ограничил показ или не отвечает</p><button onClick={()=>picker.current?.click()}>открыть видео с ноутбука</button><button onClick={()=>{setFailed(false);setRetry(x=>x+1)}}>повторить загрузку</button><p className="muted">выбери тот же фильм и монтаж, чтобы сохранить таймкоды и вопросы</p></div>}
    {!failed&&<button className="projector-media-backup" onClick={()=>picker.current?.click()}>резервное видео</button>}
    <input ref={picker} type="file" accept="video/*,.mkv" aria-label="резервный видеофайл" hidden onChange={e=>{choose(e.target.files?.[0]);e.target.value=''}}/>
  </div>
}
