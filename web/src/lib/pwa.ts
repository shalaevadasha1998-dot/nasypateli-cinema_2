type InstallOutcome='accepted'|'dismissed'

type BeforeInstallPromptEvent=Event&{
  prompt:()=>Promise<void>
  userChoice:Promise<{outcome:InstallOutcome;platform?:string}>
}

let deferredPrompt:BeforeInstallPromptEvent|null=null
const listeners=new Set<()=>void>()
let initialized=false

function emit(){for(const listener of listeners)listener()}

export function isStandalonePwa(){
  if(typeof window==='undefined')return false
  return window.matchMedia?.('(display-mode: standalone)').matches===true || (window.navigator as any).standalone===true
}

export function hasInstallPrompt(){return deferredPrompt!==null}

export function subscribePwaInstall(listener:()=>void){
  listeners.add(listener)
  return ()=>{listeners.delete(listener)}
}

export function isIosDevice(){
  if(typeof navigator==='undefined')return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function initPwa(){
  if(initialized||typeof window==='undefined')return
  initialized=true

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault()
    deferredPrompt=event as BeforeInstallPromptEvent
    emit()
  })

  window.addEventListener('appinstalled',()=>{
    deferredPrompt=null
    emit()
  })

  if('serviceWorker' in navigator){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{scope:import.meta.env.BASE_URL})
        .then(registration=>registration.update().catch(()=>undefined))
        .catch(error=>console.warn('PWA service worker registration failed',error))
    },{once:true})
  }
}

export async function promptPwaInstall():Promise<InstallOutcome|'unavailable'>{
  const prompt=deferredPrompt
  if(!prompt)return 'unavailable'
  await prompt.prompt()
  const choice=await prompt.userChoice
  if(choice.outcome==='accepted')deferredPrompt=null
  emit()
  return choice.outcome
}
