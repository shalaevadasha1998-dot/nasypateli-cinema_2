import { useEffect, useRef, useState } from 'react'
import { callApi } from '../lib/api'

function blobToBase64(blob:Blob){
  return new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||'').split(',')[1]||'');r.onerror=()=>reject(r.error);r.readAsDataURL(blob)})
}

export function useVoiceInput(onText:(text:string)=>void){
  const [recording,setRecording]=useState(false)
  const [transcribing,setTranscribing]=useState(false)
  const [error,setError]=useState('')
  const recorder=useRef<MediaRecorder|null>(null)
  const chunks=useRef<Blob[]>([])
  const timer=useRef<number|undefined>(undefined)

  const mounted=useRef(false)
  const starting=useRef(false)
  const streamRef=useRef<MediaStream|null>(null)
  useEffect(()=>{
    mounted.current=true
    return()=>{
      mounted.current=false
      if(timer.current)window.clearTimeout(timer.current)
      const r=recorder.current
      if(r){r.onstop=null;r.ondataavailable=null;if(r.state!=='inactive')r.stop()}
      streamRef.current?.getTracks().forEach(t=>t.stop())
      streamRef.current=null
    }
  },[])
  const stop=()=>{if(timer.current)window.clearTimeout(timer.current);timer.current=undefined;const r=recorder.current;if(r&&r.state!=='inactive')r.stop()}
  const toggle=async()=>{
    if(recording){stop();return}
    if(starting.current||transcribing)return
    starting.current=true
    setError('')
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('голосовой ввод не поддерживается на этом устройстве')
      const stream=await navigator.mediaDevices.getUserMedia({audio:true})
      if(!mounted.current){stream.getTracks().forEach(t=>t.stop());return}
      streamRef.current=stream
      const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported?.(t))
      const r=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined)
      chunks.current=[];recorder.current=r
      r.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)}
      r.onstop=async()=>{
        if(timer.current)window.clearTimeout(timer.current);timer.current=undefined
        stream.getTracks().forEach(t=>t.stop());streamRef.current=null
        if(!mounted.current)return
        setRecording(false)
        const blob=new Blob(chunks.current,{type:r.mimeType||'audio/webm'})
        if(blob.size<700)return
        if(blob.size>4_500_000){setError('голосовое слишком длинное · максимум около минуты');return}
        try{setTranscribing(true);const audioBase64=await blobToBase64(blob);if(!mounted.current)return;const out:any=await callApi('audio-transcribe',{audioBase64,mimeType:blob.type||'audio/webm'});if(mounted.current&&out?.text)onText(String(out.text))}catch(e:any){if(mounted.current)setError(e.message||'не получилось разобрать голос')}finally{if(mounted.current)setTranscribing(false)}
      }
      r.start(250);setRecording(true);timer.current=window.setTimeout(stop,60000)
    }catch(e:any){streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;if(mounted.current){setRecording(false);setError(e.message||'не получилось включить микрофон')}}finally{starting.current=false}
  }
  return {recording,transcribing,error,toggle,stop}
}
