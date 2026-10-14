import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import QrScanner from 'qr-scanner'
import { callApi, demoMode } from './lib/api'
import { Button, Card } from './components/UI'
import { hapticSuccess } from './lib/telegram'
import './styles.css'

type Invite = { ok:boolean; token:string; deepLink:string; expiresAt?:string }
type EncounterResult = { ok:boolean; kind:string; sharedFavorites?:number; sharedGenres?:number }
type Banner = { kind:'success'|'error'|'info'; text:string }

const BOT='nasipateli_v_kinobot'
const TOKEN=/^[0-9a-f]{32}$/i
const ENCOUNTER=/^encounter_([0-9a-f]{32})$/i

// only encounter tokens are valid here: ticket and event check-in qr codes stay separate
export function encounterTokenFromQr(value:string):string|null {
  const text=value.trim()
  if(TOKEN.test(text))return text.toLowerCase()
  const raw=ENCOUNTER.exec(text)
  if(raw)return raw[1].toLowerCase()
  try{
    const url=new URL(text)
    const isBot=(url.hostname==='t.me'||url.hostname==='telegram.me')&&url.pathname.toLowerCase()===('/'+BOT).toLowerCase()
    const start=isBot?url.searchParams.get('start')||'':''
    const match=ENCOUNTER.exec(start)
    if(match)return match[1].toLowerCase()
    // telegram's web_app button links can carry the same one-time encounter context
    if(url.protocol==='https:'&&url.hostname==='shalaevadasha1998-dot.github.io'&&url.pathname.startsWith('/nasypateli-cinema_2/')){
      const token=url.searchParams.get('encounter')||''
      if(TOKEN.test(token))return token.toLowerCase()
    }
  }catch{}
  return null
}

function expireText(iso?:string){
  if(!iso)return 'ссылка временная'
  const value=new Date(iso)
  if(!Number.isFinite(value.getTime()))return 'ссылка временная'
  return 'qr действует до '+new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'Europe/Moscow'}).format(value)
}

export default function CreatureMeetPage(){
  const [name,setName]=useState('животина')
  const [invite,setInvite]=useState<Invite|null>(null)
  const [qr,setQr]=useState('')
  const [loading,setLoading]=useState(true)
  const [banner,setBanner]=useState<Banner|null>(null)
  const [value,setValue]=useState('')
  const [busy,setBusy]=useState(false)
  const [cameraOn,setCameraOn]=useState(false)
  const [cameraBusy,setCameraBusy]=useState(false)
  const [result,setResult]=useState<EncounterResult|null>(null)
  const [fileBusy,setFileBusy]=useState(false)
  const camera=useRef<HTMLVideoElement>(null)
  const scanner=useRef<QrScanner|null>(null)
  const processing=useRef(false)
  const last=useRef({token:'',at:0})

  const stopCamera=()=>{
    try{scanner.current?.stop()}catch{}
    try{scanner.current?.destroy()}catch{}
    scanner.current=null
    setCameraOn(false)
  }
  useEffect(()=>()=>{try{scanner.current?.stop();scanner.current?.destroy()}catch{}},[])

  useEffect(()=>{
    let alive=true
    if(demoMode){setLoading(false);setBanner({kind:'info',text:'qr встреч работает только в настоящем приложении через telegram'});return}
    Promise.allSettled([callApi<any>('bootstrap'),callApi<Invite>('my-encounter-token')]).then(async ([profile,own])=>{
      if(!alive)return
      if(profile.status==='fulfilled')setName(String(profile.value?.creature?.name||'животина'))
      if(own.status==='rejected')throw own.reason
      const info=own.value
      if(!info?.deepLink||!TOKEN.test(info.token))throw new Error('не получилось подготовить qr животины')
      const image=await QRCode.toDataURL(info.deepLink,{width:440,margin:2,errorCorrectionLevel:'M',color:{dark:'#12170e',light:'#f4f1e7'}})
      if(alive){setInvite(info);setQr(image)}
    }).catch(e=>{if(alive)setBanner({kind:'error',text:String(e?.message||e||'не получилось загрузить qr')})}).finally(()=>{if(alive)setLoading(false)})
    return()=>{alive=false}
  },[])

  const meet=async(input:string)=>{
    const token=encounterTokenFromQr(input)
    if(!token){setBanner({kind:'error',text:'это не qr животины. нужен код из раздела «встреча животин», не билет на мероприятие'});return}
    if(invite&&token===invite.token){setBanner({kind:'info',text:'это твоя животина. для встречи попроси другого гостя показать свой qr'});return}
    if(processing.current)return
    if(last.current.token===token&&Date.now()-last.current.at<3500)return
    processing.current=true
    last.current={token,at:Date.now()}
    setBusy(true);setResult(null);setBanner(null)
    try{
      const answer=await callApi<EncounterResult>('encounter',{token,expectedKind:'rabbit'})
      if(answer.kind!=='rabbit')throw new Error('это код другого действия. для встречи нужен qr животины')
      stopCamera()
      setValue('')
      setResult(answer)
      hapticSuccess()
      setBanner({kind:'success',text:'встреча записана в историю обеих животин'})
    }catch(e:any){
      setBanner({kind:'error',text:String(e?.message||'не получилось встретиться, попробуй ещё раз')})
    }finally{setBusy(false);processing.current=false}
  }

  const startCamera=async()=>{
    if(cameraBusy||busy||scanner.current||!camera.current)return
    setCameraBusy(true);setBanner(null)
    try{
      const reader=new QrScanner(camera.current,(found:any)=>void meet(typeof found==='string'?found:found.data),{
        preferredCamera:'environment',highlightScanRegion:true,highlightCodeOutline:true,returnDetailedScanResult:true
      })
      scanner.current=reader
      await reader.start()
      setCameraOn(true)
    }catch(e:any){
      stopCamera()
      const msg=String(e?.message||e).toLowerCase()
      setBanner({kind:'error',text:msg.includes('permission')||msg.includes('denied')||msg.includes('allowed')
        ?'камера запрещена. разреши доступ в настройках telegram или выбери фотографию qr ниже'
        :'не получилось открыть камеру. попробуй загрузить фото qr или вставить ссылку'})
    }finally{setCameraBusy(false)}
  }

  const fromFile=async(file?:File)=>{
    if(!file)return
    setFileBusy(true);setBanner(null)
    try{
      const scanned:any=await QrScanner.scanImage(file,{returnDetailedScanResult:true})
      await meet(typeof scanned==='string'?scanned:scanned.data)
    }catch(e:any){
      setBanner({kind:'error',text:'не получилось прочитать qr на фото. попробуй приблизить код, сделать снимок без бликов или вставить ссылку'})
    }finally{setFileBusy(false)}
  }

  const copy=async()=>{
    if(!invite?.deepLink)return
    try{await navigator.clipboard.writeText(invite.deepLink);setBanner({kind:'success',text:'ссылка на встречу скопирована'})}
    catch{setBanner({kind:'error',text:'копирование недоступно. попробуй кнопку «поделиться»'})}
  }
  const share=async()=>{
    if(!invite?.deepLink)return
    if(navigator.share){
      try{await navigator.share({title:'встреча животин',text:'познакомь наших животин',url:invite.deepLink})}
      catch(e:any){if(e?.name!=='AbortError')setBanner({kind:'error',text:'не получилось поделиться. скопируй ссылку'})}
    }else await copy()
  }

  return <div className="page creature-meet-page">
    <div className="meet-heading">
      <Link to="/profile" className="meet-back">← к моей животине</Link>
      <div className="eyebrow">животины знакомятся</div>
      <h1>у каждой<br/><em>свой код</em></h1>
      <p>покажи свой qr человеку рядом или наведи камеру на его код. животины встретятся, а история сохранится у вас обоих</p>
    </div>

    <div className="meet-card-grid">
      <Card className="meet-own-card">
        <div className="meet-section-head"><span className="meet-number">01</span><div><div className="eyebrow">покажи другу</div><h2>моя животина</h2></div></div>
        <div className="meet-qr-wrap" aria-label="личный qr для встречи животин">
          {qr?<img className="meet-qr" src={qr} alt={'qr-код животины '+name}/>:<div className="meet-qr-placeholder" role="status">{loading?'создаём qr…':'qr пока недоступен'}</div>}
        </div>
        <div className="meet-creature-name">{name}</div>
        <div className="meet-expire">{expireText(invite?.expiresAt)}</div>
        <div className="meet-actions">
          <Button disabled={!invite||loading} onClick={()=>void share()}>поделиться</Button>
          <Button kind="secondary" disabled={!invite||loading} onClick={()=>void copy()}>скопировать ссылку</Button>
        </div>
      </Card>
      <Card className="meet-scan-card">
        <div className="meet-section-head"><span className="meet-number">02</span><div><div className="eyebrow">встреть чужую</div><h2>сканировать qr</h2></div></div>
        <div className={'meet-camera '+(cameraOn?'is-on':'')}><video ref={camera} playsInline muted aria-label="камера для qr животины"/>{!cameraOn&&<div className="meet-camera-empty" aria-hidden="true"><div className="meet-scan-corners"/><span>наведи камеру<br/>на чужой код</span></div>}</div>
        <div className="meet-actions">
          {!cameraOn?<Button disabled={cameraBusy||busy} onClick={()=>void startCamera()}>{cameraBusy?'включаем камеру…':'включить сканер'}</Button>:<Button kind="secondary" disabled={busy} onClick={stopCamera}>выключить камеру</Button>}
          <label className={'btn secondary meet-file '+(fileBusy||busy?'meet-disabled':'')}> {fileBusy?'читаем фото…':'выбрать фото qr'}<input type="file" accept="image/*" disabled={fileBusy||busy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void fromFile(file)}}/></label>
        </div>
        <form className="meet-manual" onSubmit={e=>{e.preventDefault();void meet(value)}}>
          <label htmlFor="meet-qr-link">или вставь ссылку / код животины</label>
          <div><input id="meet-qr-link" autoComplete="off" spellCheck={false} value={value} onChange={e=>setValue(e.target.value)} placeholder="ссылка из telegram"/><Button disabled={busy||!value.trim()} type="submit">{busy?'проверяем…':'встретить'}</Button></div>
        </form>
        {banner&&<div className={'meet-banner '+banner.kind} role="status" aria-live="polite">{banner.text}</div>}
        {result&&<div className="meet-result" role="status"><div className="meet-result-mark">✳</div><div className="eyebrow">животины встретились</div><h3>уже знакомы</h3><p>общих любимых фильмов: <b>{result.sharedFavorites||0}</b><br/>общих любимых жанров: <b>{result.sharedGenres||0}</b></p><span>история добавлена обеим животинам. ваши контакты и переписка не раскрываются</span></div>}
      </Card>
    </div>

    <div className="meet-rules"><div className="eyebrow">чтобы не перепутать</div><div><b>qr животины</b><p>сканируют гости друг у друга. появляется встреча в истории, но не подписка и не мэтч</p></div><div><b>qr билета</b><p>показывают на входе. его сканирует координатор, после чего животина попадает на экран зала</p></div><div><b>знакомства</b><p>вкладка «знакомства» работает отдельно и только по взаимному согласию</p></div></div>
  </div>
}
