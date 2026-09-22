declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string
        initDataUnsafe?: {
          user?: { id:number; first_name?:string; last_name?:string; username?:string; photo_url?:string; language_code?:string }
          start_param?:string
        }
        ready?: () => void
        expand?: () => void
        close?: () => void
        openInvoice?: (url:string, cb?:(status:string)=>void) => void
        themeParams?: Record<string,string>
        disableVerticalSwipes?:()=>void
        requestWriteAccess?:(cb?:(granted:boolean)=>void)=>void
        isVersionAtLeast?:(version:string)=>boolean
        onEvent?:(name:string,cb:(data?:any)=>void)=>void
        offEvent?:(name:string,cb:(data?:any)=>void)=>void
        Accelerometer?:{
          isStarted?:boolean
          x?:number;y?:number;z?:number
          start?:(params?:{refresh_rate?:number},cb?:(ok:boolean)=>void)=>void
          stop?:(cb?:(ok:boolean)=>void)=>void
        }
        HapticFeedback?:{
          impactOccurred?:(style:'light'|'medium'|'heavy'|'rigid'|'soft')=>void
          notificationOccurred?:(type:'error'|'success'|'warning')=>void
          selectionChanged?:()=>void
        }
      }
    }
  }
}

export function telegramWebApp() { return window.Telegram?.WebApp }
export function initTelegram() {
  const app = telegramWebApp()
  try{ app?.ready?.() }catch{}
  try{ app?.expand?.() }catch{}
  try{ app?.disableVerticalSwipes?.() }catch{}
  return app
}
export function telegramInitData() { return telegramWebApp()?.initData || '' }
export function telegramUser() { return telegramWebApp()?.initDataUnsafe?.user }
export function telegramStartParam(){ return telegramWebApp()?.initDataUnsafe?.start_param || '' }
export function requestTelegramWriteAccess(){return new Promise<boolean>(resolve=>{const app=telegramWebApp();if(!app?.requestWriteAccess)return resolve(false);app.requestWriteAccess(granted=>resolve(!!granted))})}
export function haptic(style:'light'|'medium'|'heavy'|'rigid'|'soft'='light'){telegramWebApp()?.HapticFeedback?.impactOccurred?.(style)}
export function hapticSuccess(){telegramWebApp()?.HapticFeedback?.notificationOccurred?.('success')}
