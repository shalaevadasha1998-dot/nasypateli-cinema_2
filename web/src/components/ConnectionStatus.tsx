import { useEffect, useState } from 'react'
export function ConnectionStatus(){
  const [offline,setOffline]=useState(()=>!navigator.onLine)
  useEffect(()=>{
    const update=()=>setOffline(!navigator.onLine)
    window.addEventListener('offline',update);window.addEventListener('online',update)
    return()=>{window.removeEventListener('offline',update);window.removeEventListener('online',update)}
  },[])
  return offline?<div className="connection-status" role="status">нет интернета. введённый текст остаётся на экране</div>:null
}
