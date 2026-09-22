import { useRef, useState } from 'react'
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

  const stop=()=>{if(timer.current)window.clearTimeout(timer.current);timer.current=undefined;const r=recorder.current;if(r&&r.state!=='inactive')r.stop()}
  const toggle=async()=>{
    if(recording){stop();return}
    setError('')
    try{
      if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('голосовой ввод не поддерживается на этом устройстве')
      const stream=await navigator.mediaDevices.getUserMedia({audio:true})
      const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported?.(t))
      const r=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined)
      chunks.current=[];recorder.current=r
      r.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)}
      r.onstop=async()=>{
        setRecording(false);stream.getTracks().forEach(t=>t.stop())
        const blob=new Blob(chunks.current,{type:r.mimeType||'audio/webm'})
        if(blob.size<700)return
        if(blob.size>4_500_000){setError('голосовое слишком длинное · максимум около минуты');return}
        try{setTranscribing(true);const audioBase64=await blobToBase64(blob);const out:any=await callApi('audio-transcribe',{audioBase64,mimeType:blob.type||'audio/webm'});if(out?.text)onText(String(out.text))}catch(e:any){setError(e.message||'не получилось разобрать голос')}finally{setTranscribing(false)}
      }
      r.start(250);setRecording(true);timer.current=window.setTimeout(stop,60000)
    }catch(e:any){setRecording(false);setError(e.message||'не получилось включить микрофон')}
  }
  return {recording,transcribing,error,toggle,stop}
}
