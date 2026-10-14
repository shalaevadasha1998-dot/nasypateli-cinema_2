import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import QrScanner from 'qr-scanner'
import { callApi, demoMode } from './lib/api'
import './meet.css'

type MeetCode={token:string;expiresAt:string;deepLink:string}
type MeetHistory={creatureName:string;metAt:string;sharedFavorites:number;sharedGenres:number}
type MeetResult={ok:boolean;kind:string;sharedFavorites:number;sharedGenres:number}

// A ticket QR, a test invite, and a creature QR are different capabilities.
// Never navigate to an arbitrary URL supplied by the camera or an image.
export function parseCreatureQr(raw:string):string{
  const value=raw.trim()
  if(/^[0-9a-f]{32}$/.test(value))return value
  const direct=/^encounter_([0-9a-f]{32})$/.exec(value)
  if(direct)return direct[1]
  try{
    const url=new URL(value)
    if(url.protocol==='https:'&&url.hostname==='t.me'&&url.pathname.replace(/\/$/,'')==='/nasipateli_v_kinobot'){
      const start=url.searchParams.get('start')||''
      return /^encounter_([0-9a-f]{32})$/.exec(start)?.[1]||''
    }
    if(url.protocol==='https:'&&url.hostname==='shalaevadasha1998-dot.github.io'&&url.pathname.startsWith('/nasypateli-cinema_2/')){
      const token=url.searchParams.get('encounter')||''
      return /^[0-9a-f]{32}$/.test(token)?token:''
    }
  }catch{}
  return ''
}
function humanDate(date:string){
  const value=new Date(date)
  if(!Number.isFinite(value.getTime()))return ''
  return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(value)
}
function ScannedNotice({favorites,genres}:{favorites:number;genres:number}){
  return <div className="meet-success" role="status">
    <span aria-hidden="true" className="meet-success-icon">✓</span>
    <div><h2>животины встретились</h2><p>встреча сохранена в истории обеих животин</p>
      <div className="meet-overlap"><span>общих любимых фильмов <b>{favorites}</b></span><span>общих жанров <b>{genres}</b></span></div>
    </div>
  </div>
}
export default function EncounterPage(){
  const nav=useNavigate()
  const [searchParams,setSearchParams]=useSearchParams()
  const [mode,setMode]=useState<'show'|'scan'>('show')
  const [code,setCode]=useState<MeetCode|null>(null)
  const [qr,setQr]=useState('')
  const [history,setHistory]=useState<MeetHistory[]>([])
  const [loading,setLoading]=useState(true)
  const [notice,setNotice]=useState('')
  const [copied,setCopied]=useState(false)
  const [cameraOn,setCameraOn]=useState(false)
  const [readingImage,setReadingImage]=useState(false)
  const [input,setInput]=useState('')
  const [candidate,setCandidate]=useState('')
  const [confirming,setConfirming]=useState(false)
  const [result,setResult]=useState<MeetResult|null>(null)
  const video=useRef<HTMLVideoElement>(null)
  const scanner=useRef<QrScanner|null>(null)
  const file=useRef<HTMLInputElement>(null)
  const accepting=useRef(false)
  useEffect(()=>{
    const incoming=searchParams.get('incoming')
    if(!incoming)return
    const token=parseCreatureQr(incoming)
    const next=new URLSearchParams(searchParams)
    next.delete('incoming')
    setSearchParams(next,{replace:true})
    setMode('scan')
    if(!token){setNotice('эта ссылка не подходит для знакомства животин');return}
    accepting.current=true
    setCandidate(token)
  },[searchParams,setSearchParams])
  const stopCamera=()=>{
    const active=scanner.current
    scanner.current=null
    try{active?.stop();active?.destroy()}catch{}
    setCameraOn(false)
  }
  const refreshHistory=async()=>{
    const response=await callApi<{encounters:MeetHistory[]}>('my-encounters')
    setHistory(Array.isArray(response.encounters)?response.encounters:[])
  }
  useEffect(()=>{
    let mounted=true
    if(demoMode){setLoading(false);setNotice('qr-встречи работают только при входе через telegram');return}
    Promise.all([callApi<MeetCode>('my-encounter-token'),callApi<{encounters:MeetHistory[]}>('my-encounters')])
      .then(([mine,seen])=>{if(!mounted)return;setCode(mine);setHistory(Array.isArray(seen.encounters)?seen.encounters:[])})
      .catch((e:any)=>{if(mounted)setNotice(e.message||'не получилось загрузить qr. попробуйте ещё раз')})
      .finally(()=>{if(mounted)setLoading(false)})
    return ()=>{mounted=false;try{scanner.current?.destroy()}catch{};scanner.current=null}
  },[])
  useEffect(()=>{
    if(!code?.deepLink){setQr('');return}
    let alive=true
    void QRCode.toDataURL(code.deepLink,{width:500,margin:2,errorCorrectionLevel:'M',color:{dark:'#161914',light:'#FFFFFF'}})
      .then(image=>{if(alive)setQr(image)})
      .catch(()=>{if(alive)setNotice('не получилось нарисовать qr — можно скопировать ссылку')})
    return ()=>{alive=false}
  },[code?.deepLink])
  const chooseMode=(value:'show'|'scan')=>{
    stopCamera();setMode(value);setNotice('');setCandidate('');setResult(null)
  }
  const accept=(value:string)=>{
    if(accepting.current)return
    const token=parseCreatureQr(value)
    if(!token){setNotice('это не qr животины. билет и код для входа на вечер здесь не подходят');return}
    accepting.current=true
    stopCamera();setCandidate(token);setNotice('');setResult(null)
  }
  const startCamera=async()=>{
    if(!video.current||scanner.current||candidate)return
    setNotice('')
    try{
      if(!window.isSecureContext)throw new Error('камера работает только по защищённой ссылке https')
      const instance=new QrScanner(video.current,(reading)=>accept(typeof reading==='string'?reading:reading.data),{
        preferredCamera:'environment',highlightScanRegion:true,highlightCodeOutline:true,returnDetailedScanResult:true,maxScansPerSecond:5
      })
      scanner.current=instance
      await instance.start()
      setCameraOn(true)
    }catch(e:any){
      try{scanner.current?.destroy()}catch{}
      scanner.current=null;setCameraOn(false)
      const message=String(e?.message||e||'')
      setNotice(message.includes('https')?message:'камера недоступна или доступ запрещён. загрузи фото qr либо вставь ссылку ниже')
    }
  }
  const scanImage=async(image:File|undefined)=>{
    if(!image)return
    setReadingImage(true);setNotice('');setResult(null)
    try{
      if(!image.type.startsWith('image/'))throw new Error('нужно выбрать изображение с qr-кодом')
      if(image.size>15*1024*1024)throw new Error('слишком большое изображение. выбери фото до 15 мб')
      const found=await QrScanner.scanImage(image,{returnDetailedScanResult:true})
      accept(found.data)
    }catch(e:any){setNotice(String(e?.message||'не получилось прочитать qr на картинке'))}
    finally{setReadingImage(false);if(file.current)file.current.value=''}
  }
  const submit=async()=>{
    if(!candidate||confirming)return
    setConfirming(true);setNotice('')
    try{
      const reply=await callApi<MeetResult>('encounter',{token:candidate})
      if(reply.kind!=='rabbit')throw new Error('это qr для другого действия, а не для встречи животин')
      setResult(reply);setCandidate('');setInput('')
      await refreshHistory().catch(()=>setNotice('встреча сохранена, но история пока не обновилась'))
    }catch(e:any){setNotice(e.message||'встречу не удалось сохранить')}
    finally{setConfirming(false);accepting.current=false}
  }
  const share=async()=>{
    if(!code?.deepLink)return
    setNotice('')
    try{
      if(navigator.share){await navigator.share({title:'познакомим животин?',text:'открой мою животину в «насыпателях в кино»',url:code.deepLink});return}
      if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(code.deepLink);setCopied(true);window.setTimeout(()=>setCopied(false),3000)
    }catch(e:any){if(e?.name!=='AbortError')setNotice('скопируй ссылку из поля под qr вручную')}
  }
  const copy=async()=>{
    if(!code?.deepLink)return
    try{await navigator.clipboard.writeText(code.deepLink);setCopied(true);window.setTimeout(()=>setCopied(false),3000)}
    catch{setNotice('скопируй ссылку из поля ниже вручную')}
  }
  return <div className="page meet-page">
    <div className="meet-back"><button type="button" onClick={()=>nav('/profile')}>← к животине</button><span>насыпатели · связи</span></div>
    <section className="meet-hero">
      <div className="eyebrow">когда две животины встречаются</div>
      <h1>давай<br/><em>знакомиться</em></h1>
      <p>покажи свой qr или наведи камеру на чужой. животины запомнят встречу и найдут, что у вас общего в кино</p>
      <div className="meet-steps" aria-label="как это работает"><span><b>01</b> покажи код</span><span><b>02</b> другая животина сканирует</span><span><b>03</b> история сохраняется</span></div>
    </section>
    <div className="meet-switch" role="group" aria-label="способ знакомства">
      <button type="button" aria-pressed={mode==='show'} className={mode==='show'?'active':''} onClick={()=>chooseMode('show')}>мой qr</button>
      <button type="button" aria-pressed={mode==='scan'} className={mode==='scan'?'active':''} onClick={()=>chooseMode('scan')}>сканировать</button>
    </div>
    {mode==='show'?<section className="meet-panel" aria-label="мой qr животины">
      <div className="meet-panel-head"><span>твой код встречи</span><strong>только для животин</strong></div>
      <div className="meet-code-stage">
        <div className="meet-code-corner meet-code-corner-a"/><div className="meet-code-corner meet-code-corner-b"/>
        {qr?<img src={qr} alt="qr-код знакомства животин" width="240" height="240"/>:<div className="meet-code-pending">{loading?'готовим твой qr…':'qr пока недоступен'}</div>}
      </div>
      <h2>покажи код другому человеку</h2>
      <p>пусть откроет «сканировать» у своей животины. если вы не рядом, отправь ссылку</p>
      {code?.expiresAt&&<small className="meet-valid">код действует до {humanDate(code.expiresAt)}</small>}
      <div className="meet-primary-actions"><button type="button" className="meet-main-button" disabled={!code?.deepLink} onClick={()=>void share()}>поделиться встречей ↗</button><button type="button" className="meet-outline-button" disabled={!code?.deepLink} onClick={()=>void copy()}>{copied?'скопировано ✓':'скопировать ссылку'}</button></div>
      {code?.deepLink&&<label className="meet-share-field">ссылка для ручного копирования<input readOnly aria-label="моя ссылка знакомства" value={code.deepLink} onFocus={e=>e.target.select()}/></label>}
    </section>:<section className="meet-panel" aria-label="сканировать чужую животину">
      <div className="meet-panel-head"><span>сканер животин</span><strong>камера только по нажатию</strong></div>
      {!candidate&&!result&&<><div className="meet-camera">
        <video ref={video} playsInline muted aria-label="камера для чтения qr-кода"/>
        {!cameraOn&&<div className="meet-camera-prompt"><span aria-hidden="true">⌗</span><b>наведи на qr другой животины</b><small>камера выключена</small></div>}
      </div>
      <button type="button" className="meet-main-button" disabled={readingImage} onClick={()=>cameraOn?stopCamera():void startCamera()}>{cameraOn?'выключить камеру':'включить камеру'}</button>
      <div className="meet-file-row"><input ref={file} type="file" accept="image/*" aria-label="выбрать фото qr из галереи" onChange={e=>void scanImage(e.target.files?.[0])} id="meet-photo-input"/><label htmlFor="meet-photo-input" className="meet-outline-button">{readingImage?'читаем фото…':'загрузить qr из галереи'}</label></div>
      <form className="meet-input" onSubmit={e=>{e.preventDefault();accept(input)}}><label htmlFor="meet-paste">или вставь ссылку на животину</label><div><input id="meet-paste" value={input} onChange={e=>setInput(e.target.value)} placeholder="ссылка из telegram или код" autoComplete="off"/><button type="submit" disabled={!input.trim()}>проверить</button></div></form>
      </>}
      {candidate&&<div className="meet-confirm" role="status"><div className="eyebrow">qr прочитан</div><h2>познакомить животин?</h2><p>по нажатию встреча сохранится в истории обеих животин. это не подписка и не романтический мэтч</p><button type="button" className="meet-main-button" disabled={confirming} onClick={()=>void submit()}>{confirming?'сохраняем встречу…':'да, познакомить'}</button><button type="button" className="meet-text-button" disabled={confirming} onClick={()=>{setCandidate('');accepting.current=false;setNotice('')}}>отменить</button></div>}
      {result&&<><ScannedNotice favorites={Number(result.sharedFavorites||0)} genres={Number(result.sharedGenres||0)}/><button type="button" className="meet-outline-button" onClick={()=>{setResult(null);accepting.current=false;setNotice('')}}>познакомить ещё одну животину</button></>}
    </section>}
    {notice&&<p className="meet-notice" role="alert">{notice}</p>}
    <section className="meet-history" aria-label="история встреч">
      <div className="meet-history-heading"><div><span className="eyebrow">коллекция встреч</span><h2>кого уже знаем</h2></div><strong>{history.length}</strong></div>
      {history.length?history.map((item,index)=><div className="meet-history-item" key={item.creatureName+'-'+index}><span className="meet-animal-mark" aria-hidden="true">✳</span><div><h3>{item.creatureName}</h3><p>{item.sharedFavorites?item.sharedFavorites+' общих любимых фильмов':item.sharedGenres?item.sharedGenres+' общих жанров':'у вас разные киновкусы'}</p></div><time>{humanDate(item.metAt)}</time></div>):<div className="meet-history-empty"><b>пока никого</b><p>первая встреча появится здесь после сканирования qr. твоя животина не обязана дружить со всеми подряд</p></div>}
    </section>
    <p className="meet-privacy">встреча по qr не открывает чужой telegram, не включает знакомства и не меняет билеты. для свиданий и взаимных симпатий есть отдельный раздел</p>
  </div>
}
