import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Layout from './components/Layout'
import { Button, Card, Empty, Field, Pill } from './components/UI'
import { buyTicket, callAdminApi, callApi, callScreenApi, demoMode } from './lib/api'
import { initTelegram, telegramUser } from './lib/telegram'
import { useVoiceInput } from './hooks/useVoiceInput'
import { ArchivePage, BirthPage, CreatureProfilePage, DatingPage, NotificationPage, RulesPage } from './ProductPages'
import { emptyProfile, stages } from './demo'
import type { AdminParticipant, CinemaProfile, DemoState, EventStatus, PostFilmReaction, TasteVector } from './types'
import './styles.css'

function downloadText(name:string,text:string,type:string){const blob=new Blob([text],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),0)}
function csvCell(value:unknown){const raw=Array.isArray(value)?value.join(' | '):value==null?'':typeof value==='object'?JSON.stringify(value):String(value);return `"${raw.replaceAll('\"','\"\"')}"`}
function downloadEventExport(data:any,format:'csv'|'json'){const slug=String(data?.event?.slug||'event').replace(/[^a-zA-Z0-9_-]+/g,'-');if(format==='json'){downloadText(`nasypateli-${slug}.json`,JSON.stringify(data,null,2),'application/json;charset=utf-8');return}const rows=Array.isArray(data?.rows)?data.rows:[];const keys=rows.length?Object.keys(rows[0]):[];const csv=[keys.map(csvCell).join(','),...rows.map((row:any)=>keys.map(k=>csvCell(row[k])).join(','))].join('\n');downloadText(`nasypateli-${slug}.csv`,`\uFEFF${csv}`,'text/csv;charset=utf-8')}
function moscowInputValue(iso:string){const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T')}
function moscowIso(value:string){const d=new Date(`${value}:00+03:00`);return Number.isFinite(d.getTime())?d.toISOString():''}

function useStateData(enabled=true){
  const [data,setData]=useState<DemoState|null>(null)
  const [error,setError]=useState('')
  const reload=(fresh=false)=>enabled?callApi<DemoState>('bootstrap',fresh?{fresh:true}:{}).then(d=>{setData(d);setError('');return d}).catch(e=>{setError(e.message);return undefined}):Promise.resolve(undefined)
  const showLive=['running','paused'].includes(data?.show?.runtime.runStatus||'')
  useEffect(()=>{if(!enabled)return;initTelegram();reload();const h=()=>reload();window.addEventListener('nasypateli-demo-change',h);window.addEventListener('storage',h);const timer=demoMode?undefined:window.setInterval(()=>{if(document.visibilityState==='visible')reload()},showLive?1500:30000);return()=>{window.removeEventListener('nasypateli-demo-change',h);window.removeEventListener('storage',h);if(timer)window.clearInterval(timer)}},[enabled,showLive])
  return {data,error,reload}
}

function usePrivilegedState(kind:'admin'|'screen',slug:string|undefined){
  const [search,setSearch]=useSearchParams();const [data,setData]=useState<DemoState|null>(null);const [error,setError]=useState('')
  const storageKey=`nasypateli-${kind}-token`;const queryToken=search.get('token')||''
  const token=queryToken||(typeof sessionStorage!=='undefined'?sessionStorage.getItem(storageKey)||'':'')
  useEffect(()=>{if(!queryToken)return;sessionStorage.setItem(storageKey,queryToken);const next=new URLSearchParams(search);next.delete('token');setSearch(next,{replace:true})},[queryToken,storageKey])
  const reload=()=>{if(!slug){setError('не указано событие');return Promise.resolve()}if(kind==='screen'&&!token&&!demoMode){setError('нужен закрытый ключ экрана');return Promise.resolve()}const action=kind==='admin'?'admin-bootstrap':'screen-bootstrap';const fn=kind==='admin'?callAdminApi:callScreenApi;return fn<DemoState>(action,{slug},token).then(d=>{setData(d);setError('')}).catch(e=>setError(e.message))}
  useEffect(()=>{reload();const timer=window.setInterval(reload,kind==='screen'?1000:1500);return()=>window.clearInterval(timer)},[kind,slug,token])
  return {data,error,reload,token}
}

function Loading({error}:{error?:string}){const initMissing=String(error||'').toLowerCase().includes('initdata');if(initMissing)return <div className="telegram-gate"><div className="telegram-gate-noise"/><div className="eyebrow">мини-приложение</div><h1>откройте нас<br/>из telegram</h1><p>браузер не передаёт ваш telegram-профиль. внутри бота всё откроется нормально</p><a className="btn telegram-gate-btn" href="https://t.me/nasipateli_v_kinobot">открыть бота</a></div>;return <div className="page loading-page"><div className="loading-stage"><div className="loading-brand">насыпатели <span>в кино</span></div>{error?<><div className="loading-error">не загрузилось</div><p>{error}</p><Button kind="secondary" onClick={()=>location.reload()}>попробовать ещё раз</Button></>:<><div className="loading-track"><i/></div><div className="loading-words" aria-live="polite"><span>собираем кинопрофиль</span><span>будим животину</span><span>открываем клуб</span></div></>}</div></div>}
function parseLines(v:string){return v.split(/\n+/).map(x=>x.trim()).filter(Boolean)}
function parseCommaList(v:string){return v.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean)}
function eventDate(iso:string){try{return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',timeZone:'Europe/Moscow'}).format(new Date(iso))}catch{return iso}}
function eventTime(iso:string){try{return new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(iso))}catch{return ''}}
function eventShortDate(iso:string){try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',timeZone:'Europe/Moscow'}).format(new Date(iso))}catch{return iso}}

function Onboarding(){
  const {data,error,reload}=useStateData();const [search]=useSearchParams();const nav=useNavigate();const editing=search.get('edit')==='1'
  const [step,setStep]=useState(0);const [form,setForm]=useState<CinemaProfile|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('')
  const [listDrafts,setListDrafts]=useState({favoriteFilms:'',favoriteGenres:'',avoid:''})
  useEffect(()=>{if(data&&!form){const tg=telegramUser();const p=data.profile||emptyProfile;const initial={...emptyProfile,...p,displayName:p.displayName||tg?.first_name||'',telegramPhotoUrl:p.telegramPhotoUrl||tg?.photo_url||'',taste:{...emptyProfile.taste,...(p.taste||{})},favoriteFilms:Array.isArray(p.favoriteFilms)?p.favoriteFilms:[],favoriteGenres:Array.isArray(p.favoriteGenres)?p.favoriteGenres:[],avoid:Array.isArray(p.avoid)?p.avoid:[],watchReasons:Array.isArray(p.watchReasons)?p.watchReasons:[],clubWants:Array.isArray(p.clubWants)?p.clubWants:[]};setForm(initial);setListDrafts({favoriteFilms:initial.favoriteFilms.join('\n'),favoriteGenres:initial.favoriteGenres.join(', '),avoid:initial.avoid.join('\n')});setStep(editing?1:Math.max(0,Math.min(7,p.onboardingStep||0))) }},[data,form,editing])
  if(!data||!form)return <Loading error={error}/>
  if(data.onboardingComplete&&!editing)return <Navigate to="/" replace/>
  const patch=(p:Partial<CinemaProfile>)=>{setMessage('');setForm(prev=>prev?{...prev,...p}:prev)}
  const patchList=(key:keyof typeof listDrafts,value:string)=>{setMessage('');setListDrafts(prev=>({...prev,[key]:value}));if(key==='favoriteFilms')patch({favoriteFilms:parseLines(value)});else if(key==='favoriteGenres')patch({favoriteGenres:parseCommaList(value)});else patch({avoid:parseLines(value)})}
  const validationMessage=()=>{
    if(step===1){const missing=[];if(form.displayName.trim().length<2)missing.push('имя');if(!form.selfGender)missing.push('как к вам обращаться');if(!form.ageRange)missing.push('возраст');if(form.city.trim().length<2)missing.push('город');if(form.about.trim().length<3)missing.push('строка о себе');return missing.length?`заполните: ${missing.join(', ')}`:''}
    if(step===2){const missing=[];if(form.favoriteFilms.length<3)missing.push(`ещё ${3-form.favoriteFilms.length} любим. фильм${form.favoriteFilms.length===2?'':'а'}`);if(form.favoriteGenres.length<2)missing.push(`ещё ${2-form.favoriteGenres.length} жанр`);if(!form.lastLovedFilm.trim())missing.push('последний понравившийся фильм');return missing.length?`не хватает: ${missing.join(', ')}`:''}
    if(step===3){const missing=[];if(!form.dislikedFilm.trim())missing.push('фильм, который не понравился');if(form.avoid.length<1)missing.push('что вам не стоит показывать');return missing.length?`заполните: ${missing.join(', ')}`:''}
    if(step===5)return form.watchReasons.length<1?'выберите хотя бы один вариант':''
    if(step===6){const missing=[];if(form.clubWants.length<1)missing.push('что хочется от клуба');if(typeof form.photoVideoConsent!=='boolean')missing.push('решение по фото/видео');if(!form.dataConsent)missing.push('согласие на обработку данных');if(!form.rulesConsent)missing.push('правила клуба');return missing.length?`нужно отметить: ${missing.join(', ')}`:''}
    return ''
  }
  const next=async()=>{const validation=validationMessage();if(validation){setMessage(validation);setTimeout(()=>document.querySelector('.form-error')?.scrollIntoView({behavior:'smooth',block:'center'}),0);return}setMessage('');if(step===7){try{setBusy(true);if(editing)await callApi('save-profile-progress',{profile:{...form,onboardingStep:7},step:7});else await callApi('save-profile',{profile:{...form,onboardingStep:7}});await reload();nav(editing?'/profile':'/birth')}catch(e:any){setMessage(e.message||'не получилось сохранить профиль')}finally{setBusy(false)};return}const n=Math.min(7,step+1);if(editing){setStep(n);return}try{setBusy(true);await callApi('save-profile-progress',{profile:form,step:n});setStep(n)}catch(e:any){setMessage(e.message||'не получилось сохранить прогресс')}finally{setBusy(false)}}
  const back=()=>{setMessage('');if(editing&&step===1){nav('/profile');return}setStep(Math.max(0,step-1))}
  return <div className="onboarding-page">
    <div className="onboarding-head"><div className="brand-static">НАСЫПАТЕЛИ <span>В КИНО</span></div>{step>0&&<div className="onboarding-counter">0{step}/07</div>}{step>0&&<div className="progress-dots">{[1,2,3,4,5,6,7].map(n=><i key={n} className={n<=step?'on':''}/>)}</div>}</div>
    <div className="onboarding-atmosphere" aria-hidden><i/><i/><i/><i/></div><div key={step} className={`onboarding-body ${step===0?'onboarding-intro':''}`} data-step={step}>
      {step===0&&<><div className="eyebrow">перед входом</div><h1 className="onboarding-title"><span>сначала</span><span>познакомимся</span></h1><p className="onboarding-copy">мы будем выбирать кино не совсем нормальным способом, а животина будет помогать вам с выбором, запоминать вкус и обсуждать просмотренное, поэтому сначала соберём кинопрофиль</p><Button onClick={next}>собрать мой кинопрофиль</Button></>}
      {step===1&&<><StepTitle n="01" title="кто вы"/><Field label="как вас называть"><input value={form.displayName} onChange={e=>patch({displayName:e.target.value})}/></Field><div className="choice-question onboarding-gender"><span>как к вам обращаться в текстах</span><div className="binary"><button type="button" className={form.selfGender==='woman'?'active':''} onClick={()=>patch({selfGender:'woman'})}>женский род</button><button type="button" className={form.selfGender==='man'?'active':''} onClick={()=>patch({selfGender:'man'})}>мужской род</button></div></div><Field label="возраст"><select value={form.ageRange} onChange={e=>patch({ageRange:e.target.value})}><option value="">выберите</option><option value="18-24">18–24</option><option value="25-34">25–34</option><option value="35-44">35–44</option><option value="45+">45+</option></select></Field><Field label="город"><input value={form.city} onChange={e=>patch({city:e.target.value})}/></Field><Field label="одна строка о себе" hint="не резюме, просто что про вас полезно знать в клубе"><textarea maxLength={300} value={form.about} onChange={e=>patch({about:e.target.value})}/></Field></>}
      {step===2&&<><StepTitle n="02" title="что вы любите"/><Field label="минимум 3 любимых фильма" hint={`${form.favoriteFilms.length}/3. каждый фильм с новой строки`}><textarea rows={4} placeholder={'например:\nПаразиты\nАмели\nСуспирия'} value={listDrafts.favoriteFilms} onChange={e=>patchList('favoriteFilms',e.target.value)}/></Field><Field label="любимые жанры. только через запятую" hint="только через запятую. например: хоррор, триллер, драма"><input placeholder="хоррор, триллер" value={listDrafts.favoriteGenres} onChange={e=>patchList('favoriteGenres',e.target.value)}/></Field><Field label="последний фильм, который реально понравился"><input placeholder="название фильма" value={form.lastLovedFilm} onChange={e=>{setMessage('');patch({lastLovedFilm:e.target.value})}}/></Field></>}
      {step===3&&<><StepTitle n="03" title="а теперь наоборот"/><Field label="фильм, который вам вообще не понравился"><input placeholder="название фильма" value={form.dislikedFilm} onChange={e=>{setMessage('');patch({dislikedFilm:e.target.value})}}/></Field><Field label="что вам почти точно не стоит показывать" hint={`${form.avoid.length} добавлено. каждый пункт с новой строки`}><textarea rows={4} placeholder={'например:\nбайопики\nскримеры\nслишком сладкие ромкомы'} value={listDrafts.avoid} onChange={e=>patchList('avoid',e.target.value)}/></Field></>}
      {step===4&&<><StepTitle n="04" title="покажи, что нравится"/><TasteSliders value={form.taste} onChange={taste=>patch({taste})}/></>}
      {step===5&&<><StepTitle n="05" title="зачем вы смотрите кино"/><ChoiceChips multiple value={form.watchReasons} onChange={v=>patch({watchReasons:v as string[]})} options={[['switch_off','отключиться от всего'],['story','залипнуть в историю'],['feel','почувствовать что-то'],['think','подумать после'],['discuss','обсудить с кем-то'],['new','увидеть что-то новое'],['laugh','поржать'],['fear','испугаться / понервничать'],['cry','поплакать'],['atmosphere','поймать атмосферу'],['beauty','посмотреть на красивое'],['surprise','удивиться / Ахуеть'],['other_life','прожить чужую жизнь'],['people_understand','понять других людей'],['lingers','найти кино, которое потом не отпускает']]}/></>}
      {step===6&&<><StepTitle n="06" title="что вам хочется от клуба"/><ChoiceChips multiple value={form.clubWants} onChange={v=>patch({clubWants:v as string[]})} options={[['unexpected',form.selfGender==='woman'?'смотреть то, что сама бы не включила':form.selfGender==='man'?'смотреть то, что сам бы не включил':'смотреть то, что сам(а) бы не включил(а)'],['discuss','обсуждать кино после'],['meet','знакомиться с людьми'],['same_taste','находить людей с похожим вкусом'],['different_taste','спорить с людьми с другим вкусом'],['weird_formats','приходить на странные форматы'],['games','участвовать в играх и механиках'],['just_watch','иногда просто приходить смотреть кино'],['everything','хочу всё']]}/><Field label="есть что-то, чего вам здесь точно не хочется?" hint="можно оставить пустым"><textarea maxLength={300} value={form.clubAvoid} onChange={e=>patch({clubAvoid:e.target.value})}/></Field><ToggleRow label={form.selfGender==='woman'?'готова знакомиться с людьми на мероприятиях':form.selfGender==='man'?'готов знакомиться с людьми на мероприятиях':'готов(а) знакомиться с людьми на мероприятиях'} value={form.openToMeet} onChange={v=>patch({openToMeet:v})}/><ToggleRow label="можно показывать мой профиль другим участникам клуба" value={form.publicProfile} onChange={v=>patch({publicProfile:v})}/><TriChoice label="можно снимать меня и использовать фото/видео с мероприятия" value={form.photoVideoConsent} onChange={v=>patch({photoVideoConsent:v})}/><label className="check"><input type="checkbox" checked={form.dataConsent} onChange={e=>patch({dataConsent:e.target.checked})}/><span>{form.selfGender==='woman'?'согласна на обработку данных профиля для работы клуба и персонализации':form.selfGender==='man'?'согласен на обработку данных профиля для работы клуба и персонализации':'согласен(а) на обработку данных профиля для работы клуба и персонализации'}</span></label><label className="check"><input type="checkbox" checked={form.rulesConsent} onChange={e=>patch({rulesConsent:e.target.checked})}/><span>{form.selfGender==='woman'?'мне 18+, я согласна с правилами насыпателей в кино':form.selfGender==='man'?'мне 18+, я согласен с правилами насыпателей в кино':'мне 18+, я согласен(а) с правилами насыпателей в кино'}</span></label><button type="button" className="text-link" disabled={busy} onClick={async()=>{try{setBusy(true);setMessage('');await callApi('save-profile-progress',{profile:form,step});nav('/rules')}catch(e:any){setMessage(e.message||'не получилось открыть правила')}finally{setBusy(false)}}}>прочитать правила</button></>}
      {step===7&&<><StepTitle n="07" title="кинопрофиль готов"/><ProfilePreview profile={form}/><p className="muted">это стартовая карта вкуса, животина будет уточнять её после реальных просмотров</p></>}
      {message&&<div className="form-error">{message}</div>}
      {step>0&&<div className="onboarding-actions"><Button kind="secondary" onClick={back}>назад</Button><Button disabled={busy} onClick={next}>{step===7?(editing?'сохранить изменения':'войти в клуб'):'дальше'}</Button></div>}
    </div>
  </div>
}

function StepTitle({n,title}:{n:string;title:string}){return <div className="step-title"><span>{n}</span><h2>{title}</h2></div>}
function ChoiceChips({options,value,onChange,multiple=false}:{options:[string,string][];value:string|string[];onChange:(v:string|string[])=>void;multiple?:boolean}){const vals=Array.isArray(value)?value:[value];return <div className="chips">{options.map(([id,label])=><button type="button" key={id} className={`${vals.includes(id)?'active ':''}${id==='surprise'?'preserve-case':''}`.trim()} onClick={()=>{if(!multiple)return onChange(id);const next=vals.includes(id)?vals.filter(x=>x!==id):[...vals,id];onChange(next)}}>{label}</button>)}</div>}
function ToggleRow({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}){return <button type="button" className="toggle-row" aria-pressed={value} onClick={()=>onChange(!value)}><span>{label}</span><span className={value?'switch on':'switch'} aria-hidden="true"><i/></span></button>}
function TriChoice({label,value,onChange}:{label:string;value:boolean|null;onChange:(v:boolean)=>void}){return <div className="choice-question"><span>{label}</span><div className="binary"><button type="button" className={value===true?'active':''} onClick={()=>onChange(true)}>да</button><button type="button" className={value===false?'active':''} onClick={()=>onChange(false)}>нет</button></div></div>}
function TasteSliders({value,onChange}:{value:TasteVector;onChange:(v:TasteVector)=>void}){const defs:[keyof TasteVector,string,string][]=[['weirdness','понятное','странное'],['heaviness','лёгкое','тяжёлое'],['atmosphere','сюжет','атмосфера'],['oldness','новое','старое'],['experimental','мейнстрим','экспериментальное'],['slowness','быстрое','медленное'],['surrealism','реалистичное','безумное']];return <div className="sliders">{defs.map(([k,l,r])=><label className="slider-row" key={k}><div><b>{l}</b><b>{r}</b></div><input aria-label={`${l} — ${r}`} type="range" min="0" max="100" value={value[k]} onChange={e=>onChange({...value,[k]:Number(e.target.value)})}/></label>)}</div>}
function ProfilePreview({profile}:{profile:CinemaProfile}){return <Card className="profile-preview"><div className="profile-person">{profile.telegramPhotoUrl?<img src={profile.telegramPhotoUrl} alt=""/>:<div className="avatar-fallback">{profile.displayName.slice(0,1).toLowerCase()}</div>}<div><h3>{profile.displayName||'участник'}</h3><p>{profile.city}. 18+</p></div></div><p>{profile.about}</p><div className="tag-row">{profile.favoriteFilms.slice(0,4).map(x=><span key={x}>{x}</span>)}</div></Card>}

function RequireProfile({children}:{children:ReactNode}){const {data,error}=useStateData();if(!data)return <Loading error={error}/>;if(!data.onboardingComplete)return <Navigate to="/onboarding" replace/>;if(data.creature&&!data.creature.born)return <Navigate to="/birth" replace/>;return <>{children}</>}

function answerText(value:any){if(value===null||value===undefined)return '';if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')return String(value);if(typeof value==='object'&&'label' in value)return String(value.label);try{return JSON.stringify(value)}catch{return String(value)}}


function missionStatusLabel(status:string){
  const labels:Record<string,string>={assigned:'назначено',watching:'смотрю',watched:'просмотрено',review_in_progress:'разговор идёт',review_ready:'черновик готов',submitted:'отправлено',approved:'одобрено',changes_requested:'нужно уточнить',published:'опубликовано',overdue:'просрочено'}
  return labels[status]||status
}

function FilmLiveParticipant({data,reload}:{data:DemoState;reload:(fresh?:boolean)=>Promise<DemoState|undefined>}){
  const live=data.filmLive
  const [word,setWord]=useState(live?.myWord||'')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  useEffect(()=>{setWord(live?.myWord||'')},[live?.myWord,live?.revision])
  if(!live||!data.show||data.registration!=='attended')return null
  const state=live.state
  const questionId=String(live.payload?.questionId||'')
  const mine=(live.myAnswers||[]).find(x=>x.question_id===questionId)
  const submitWord=async()=>{try{setBusy(true);setMessage('');await callApi('film-one-word',{slug:data.event.slug,word});setMessage('слово ушло на экран');await reload(true)}catch(e:any){setMessage(e.message||'не получилось отправить слово')}finally{setBusy(false)}}
  const predict=async(answer:any)=>{try{setBusy(true);setMessage('');await callApi('film-prediction',{slug:data.event.slug,questionId,answer});setMessage('ответ принят');await reload(true)}catch(e:any){setMessage(e.message||'не получилось отправить ответ')}finally{setBusy(false)}}
  if(state==='film_intro')return <section className="participant-show film-live"><div className="eyebrow">киноблок</div><h2>{live.filmTitle||'смотрите на экран'}</h2><p>первый фрагмент идёт на общем экране. телефон пока вниз.</p></section>
  if(state==='one_word_collecting')return <section className="participant-show film-live"><div className="eyebrow">животина спрашивает</div><h2>одно слово. что это за фильм?</h2><div className="film-one-word"><input maxLength={80} value={word} placeholder="одно слово" onChange={e=>{setWord(e.target.value);setMessage('')}}/><Button disabled={busy||!word.trim()} onClick={submitWord}>{busy?'отправляем…':live.myWord?'обновить слово':'отправить слово'}</Button></div>{live.myWord&&<p className="muted">сейчас на стене: «{live.myWord}»</p>}{message&&<div className={message.includes('ушло')?'success':'form-error'}>{message}</div>}</section>
  if(state==='one_word_results')return <section className="participant-show film-live"><div className="eyebrow">зал сказал</div><h2>слова уже на экране</h2><p>{live.myWord?'твоя животина сказала «'+live.myWord+'».':'если ты не успел отправить слово, в рандом этого фильма не попадёшь.'}</p></section>
  if(state==='question_open')return <section className="participant-show film-live"><div className="row spread participant-show-head"><div><div className="eyebrow">что будет дальше</div><h2>{String(live.payload?.prompt||'выбери ответ')}</h2></div><Pill>{Number(live.payload?.position||0)}/5</Pill></div><div className="participant-votes">{(Array.isArray(live.payload?.options)?live.payload.options:[]).map((option:any)=>{const selected=JSON.stringify(mine?.answer)===JSON.stringify(option);return <button type="button" className={selected?'selected':''} disabled={busy} key={String(option)} onClick={()=>predict(option)}>{answerText(option)}</button>})}</div>{mine&&<p className="muted">ответ можно поменять, пока вопрос открыт</p>}{message&&<div className={message==='ответ принят'?'success':'form-error'}>{message}</div>}</section>
  if(state==='question_results')return <section className="participant-show film-live"><div className="eyebrow">зал решил</div><h2>{String(live.payload?.prompt||'результаты')}</h2><p>распределение ответов сейчас на проекторе.</p></section>
  if(state==='question_reveal')return <section className="participant-show film-live"><div className="eyebrow">что случилось</div><h2>{answerText(live.payload?.correctAnswer)}</h2>{live.payload?.revealText&&<p>{String(live.payload.revealText)}</p>}<p className="muted">смотрите продолжение на большом экране</p></section>
  if(state==='assignment_randomizing')return <section className="participant-show film-live"><div className="eyebrow">рандом</div><h2>кому достанется фильм?</h2><p>участвуют только животинки, которые дошли до конца этого киноблока.</p></section>
  if(state==='assignment_winner'){
    const winner=String(live.payload?.animalName||'животина')
    const mineWinner=winner.trim().toLowerCase()===String(data.creature.name||'').trim().toLowerCase()
    const assignment=(data.filmAssignments||[]).find(x=>x.filmPackageId===live.filmPackageId)
    return <section className={mineWinner?'participant-show film-live film-winner':'participant-show film-live'}><div className="eyebrow">{mineWinner?'это ты':'фильм достался'}</div><h2>{winner}</h2><p>{mineWinner?'этот фильм твой. досмотри его за 7 дней. потом животина спросит.':'у '+winner+' теперь есть неделя на полный просмотр.'}</p>{mineWinner&&assignment&&<Button onClick={()=>{location.hash='#/mission/'+assignment.id}}>открыть задание</Button>}</section>
  }
  return null
}

function FilmMissionCards({data,onOpen}:{data:DemoState;onOpen:(id:string)=>void}){
  const missions=(data.filmAssignments||[]).filter(x=>x.status!=='published').slice(0,4)
  if(!missions.length)return null
  return <section className="home-missions"><div className="eyebrow">фильмы животины</div>{missions.map(m=>{
    const overdue=m.status==='overdue'||m.daysLeft<0
    const left=overdue?'срок прошёл':m.daysLeft===0?'сегодня дедлайн':m.daysLeft===1?'остался 1 день':'осталось '+m.daysLeft+' дн.'
    return <Card className={overdue?'mission-card overdue':'mission-card'} key={m.id}><div className="row spread"><div><small>{missionStatusLabel(m.status)}</small><h3>{data.creature.name||'животина'}, у тебя фильм.</h3></div><Pill>{overdue?'overdue':left}</Pill></div><div className="mission-film-title">{m.filmTitle}</div><p>посмотреть до {eventDate(m.dueAt)}. {left}</p><div className="mission-before">до просмотра: «{m.beforeWord}» · прогнозы {m.correctCount}/{m.totalQuestions}</div><Button onClick={()=>onOpen(m.id)}>{['assigned','watching','overdue'].includes(m.status)?'открыть задание':m.status==='watched'?'поговорить с животинкой':m.status==='review_ready'?'посмотреть черновик':m.status==='changes_requested'?'уточнить рецензию':'открыть'}</Button></Card>
  })}</section>
}

function ParticipantShow({data,reload}:{data:DemoState;reload:(fresh?:boolean)=>Promise<DemoState|undefined>}){
  const show=data.show
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  if(!show||show.runtime.runStatus==='idle'||!['paid','attended'].includes(data.registration))return null
  const block=show.runtime.currentBlock
  if(!block)return null
  const round=show.currentRound
  const question=round?.question
  const myVote=show.myVote
  const vote=async(answer:any)=>{
    if(busy||round?.voteState!=='open')return
    try{
      setBusy(true);setMessage('')
      const result:any=await callApi('event-vote',{slug:data.event.slug,answer})
      if(result?.crumbs&&!result.crumbs.alreadyAwarded&&result.crumbs.rewardCrumbs)setMessage(`принято. +${result.crumbs.rewardCrumbs} крошка${Number(result.crumbs.rewardCrumbs)===1?'':'и'}`)
      else setMessage('принято')
      await reload(true)
    }catch(e:any){setMessage(e.message||'не получилось отправить ответ')}
    finally{setBusy(false)}
  }
  if(block.type==='music_live')return <section className="participant-show music"><div className="eyebrow">сейчас</div><h2>{block.title}</h2><p>убери телефон. там люди играют музыку</p></section>
  if(block.type==='post_event')return <section className="participant-show"><div className="eyebrow">вечер закончился</div><h2>животина остаётся с вами</h2><p>крошки, история и всё, что случилось сегодня, никуда не исчезнут</p></section>
  const intro=block.type==='arrival'?'ты внутри. животина тоже':block.type==='onboarding'?'знакомимся с животиной':block.type==='warm_up'?'первый общий интерактив':block.type==='final_vote'?'финальный выбор':block.type==='finale'?'итог вечера':block.title
  return <section className="participant-show">
    <div className="row spread participant-show-head"><div><div className="eyebrow">сейчас</div><h2>{intro}</h2></div>{round&&<Pill>раунд {round.roundNo}</Pill>}</div>
    {show.runtime.runStatus==='paused'&&<div className="participant-show-pause">пауза. ведущий скоро продолжит</div>}
    {round?.movie&&<div className="participant-show-movie"><span>фильм</span><b>{round.movie.title}</b>{round.movie.year&&<small>{round.movie.year}</small>}</div>}
    {question&&<div className="participant-question"><div className="section-title">животина спрашивает</div><h3>{question.prompt}</h3>{round?.voteState==='open'&&Array.isArray(question.options)&&question.options.length>0&&<div className="participant-votes">{question.options.map((option:any)=>{const selected=JSON.stringify(myVote)===JSON.stringify(option);return <button type="button" className={selected?'selected':''} disabled={busy} key={String(option)} onClick={()=>vote(option)}>{answerText(option)}</button>})}</div>}{round?.voteState==='closed'&&myVote!==undefined&&<p className="muted">ваш ответ. {answerText(myVote)}</p>}</div>}
    {message&&<div className={message.startsWith('принято')?'success':'form-error'}>{message}</div>}
    {round?.resultsVisible&&show.voteResults.length>0&&<div className="participant-results">{show.voteResults.map((x,i)=><div key={i}><span>{answerText(x.answer)}</span><b>{x.count}</b></div>)}</div>}
    {!round&&block.type==='arrival'&&<p className="muted">пока можно убрать телефон. приложение само синхронизируется, когда начнётся следующий блок</p>}
  </section>
}

function Home(){
  const {data,error,reload}=useStateData();const nav=useNavigate();const [buyError,setBuyError]=useState('');const [buyNotice,setBuyNotice]=useState('');const [buyBusy,setBuyBusy]=useState(false);const [claimBusy,setClaimBusy]=useState(false);const [claimError,setClaimError]=useState('');const [cancelBusy,setCancelBusy]=useState(false);const [cancelError,setCancelError]=useState('');const [ticketOpen,setTicketOpen]=useState(false);const [encounterMsg,setEncounterMsg]=useState('');const [now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!data?.creature?.born)return;const u=new URL(location.href);const token=u.searchParams.get('encounter');if(!token)return;u.searchParams.delete('encounter');history.replaceState({},'',u.toString());callApi<any>('encounter',{token}).then(r=>{setEncounterMsg(r.kind==='event_checkin'?'вы внутри. животина запомнила, что вы пришли':'животины встретились');reload()}).catch(e=>setEncounterMsg(e.message))},[data?.creature?.born]);useEffect(()=>{if(!['reserved','waitlist'].includes(data?.registration||''))return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void reload(true)},10000);return()=>window.clearInterval(timer)},[data?.registration]);useEffect(()=>{if(data?.registration!=='reserved'||!data.reservationExpiresAt)return;setNow(Date.now());const tick=window.setInterval(()=>setNow(Date.now()),1000);const remaining=Math.max(0,new Date(data.reservationExpiresAt).getTime()-Date.now());const expiry=window.setTimeout(()=>void reload(true),remaining+250);return()=>{window.clearInterval(tick);window.clearTimeout(expiry)}},[data?.registration,data?.reservationExpiresAt]);useEffect(()=>{if(!data)return;if(['paid','attended'].includes(data.registration)){setBuyNotice('');setBuyError('');return}if(data.registration==='reserved'){setBuyNotice(prev=>prev.includes('листе ожидания')?'':prev)}if(data.registration==='none'){setBuyNotice(prev=>prev.includes('место пока')||prev.includes('резерв')?'резерв истёк. можно оформить билет заново':prev);setBuyError(prev=>prev.includes('место пока')?'резерв истёк. попробуйте оформить билет заново':prev)}},[data?.registration]);if(!data)return <Loading error={error}/>
  const e=data.event;const held=Number(e.held||0);const left=Math.max(0,e.capacity-e.sold-held);const salesOpen=e.status==='SALES_OPEN';const freeEntry=Number(e.ticketPriceRub)===0;const freeClaimOpen=freeEntry&&['SALES_OPEN','CHECKIN'].includes(e.status);const checkoutAvailable=salesOpen&&e.paymentsAvailable;const reserveSeconds=data.registration==='reserved'&&data.reservationExpiresAt?Math.max(0,Math.ceil((new Date(data.reservationExpiresAt).getTime()-now)/1000)):0;const reserveCountdown=data.registration==='reserved'&&data.reservationExpiresAt?`${Math.floor(reserveSeconds/60)}:${String(reserveSeconds%60).padStart(2,'0')}`:''
  const buy=async()=>{if(buyBusy||!checkoutAvailable)return;try{setBuyBusy(true);setBuyError('');setBuyNotice('');const result:any=await buyTicket(e.slug);if(result?.waitlist){setBuyNotice(result.queuePosition?'вы в листе ожидания. позиция '+result.queuePosition:'вы в листе ожидания');await reload(true);return}const status=String(result?.invoiceStatus||'');if(status==='cancelled'){const latest=await reload(true);setBuyNotice(latest?.registration==='reserved'?'оплата отменена. место пока остаётся в резерве, можно продолжить оплату':'оплата отменена. резерв уже истёк, можно оформить билет заново');return}if(status==='failed'){const latest=await reload(true);setBuyError(latest?.registration==='reserved'?'Telegram не завершил оплату. место пока остаётся в резерве, попробуйте ещё раз':'Telegram не завершил оплату. резерв уже истёк, оформите билет заново');return}if(status==='paid'){setBuyNotice('оплата прошла. подтверждаем билет…');for(const delay of [0,700,1400,2500]){if(delay)await new Promise(resolve=>window.setTimeout(resolve,delay));const latest=await reload(true);if(latest&&['paid','attended'].includes(latest.registration)){setBuyNotice('');return}}setBuyNotice('оплата прошла в Telegram. билет подтверждается, статус обновится автоматически');return}await reload(true)}catch(err:any){setBuyError(err.message||'не получилось открыть оплату')}finally{setBuyBusy(false)}}
  const claimTicket=async()=>{if(claimBusy||!freeClaimOpen)return;try{setClaimBusy(true);setClaimError('');setCancelError('');setBuyNotice('');const result:any=await callApi('claim-event-ticket',{slug:e.slug});if(result?.status==='waitlist'){setBuyNotice(result.queuePosition?`места закончились. вы в листе ожидания. позиция ${result.queuePosition}`:'места закончились. вы в листе ожидания');await reload(true);return}setTicketOpen(true);await reload(true)}catch(err:any){setClaimError(err.message||'не получилось получить билет')}finally{setClaimBusy(false)}}
  const cancelTicket=async()=>{if(cancelBusy||data.registration!=='paid'||!freeEntry||!salesOpen)return;if(!window.confirm('отменить билет? место освободится для другого человека'))return;try{setCancelBusy(true);setCancelError('');setClaimError('');setBuyNotice('');await callApi('cancel-event-ticket',{slug:e.slug});setTicketOpen(false);setBuyNotice('билет отменён. место освобождено');await reload(true)}catch(err:any){setCancelError(err.message||'не получилось отменить билет')}finally{setCancelBusy(false)}}
    const rebuyStatus=data.registration==='refunded'?'билет возвращён':data.registration==='cancelled'?'билет отменён':''
  return <div className="page home-page cinematic-page">
    <section className="home-creature-hero home-creature-static">
      <div className="home-creature-top"><div><div className="eyebrow">ваша животина</div><span className="home-creature-stage-label">ваша личная животина внутри насыпателей в кино</span></div><button className="micro-link" onClick={()=>nav('/profile')}>открыть профиль ↗</button></div>
      <button type="button" className="home-creature-static-art" onClick={()=>nav('/profile')} aria-label="открыть профиль животины"><img src={`${import.meta.env.BASE_URL}assets/rabbit-baby.png`} alt={data.creature.name||'животина'} draggable={false}/></button>
      <div className="home-creature-name">{data.creature.name||'животина'}</div>
      <p className="home-creature-copy">{data.creature.name||'животина'} знает ваш кинопрофиль и может обсуждать с вами фильмы, вкусы и происходящее в клубе</p>
      <Button onClick={()=>nav('/zhivotina')}>поговорить с {data.creature.name||'животиной'}</Button>
    </section>
    {encounterMsg&&<div className="success floating-success">{encounterMsg}</div>}
    <FilmMissionCards data={data} onOpen={id=>nav('/mission/'+id)}/>
    <section className="home-event-hero">
      <div className="home-event-date"><div className="eyebrow">ближайший вечер</div><h1>{eventDate(e.startsAt)}</h1><p>{eventTime(e.startsAt)}. {e.venueName?e.venueName:'место объявим позже'}. москва{e.venueAddress&&<><br/>{e.venueAddress}</>}</p></div>
      <div className="home-event-ticket">
        <div className="home-ticket-head"><div><span>{e.title}</span><strong>{freeEntry?'вход по регистрации':`${e.ticketPriceRub} ₽`}</strong></div><Pill>{left} свободно</Pill></div>
        <div className="seat-line"><i style={{width:`${Math.min(100,(e.sold+held)/e.capacity*100)}%`}}/></div><div className="seat-copy">{left?`ещё ${left} мест`:'мест больше нет'}</div>
        {data.registration==='none'&&<>{freeClaimOpen?<><p className="ticket-invite">вы зарегистрировались в клубе. теперь заберите билет на этот вечер, и место будет закреплено за вами.</p><Button disabled={claimBusy} onClick={claimTicket}>{claimBusy?'выдаём билет…':left?'получить билет':'встать в лист ожидания'}</Button><p className="muted">билет останется внутри приложения. печатать и показывать qr-код не нужно.</p></>:salesOpen?<><Button disabled={buyBusy||!e.paymentsAvailable} onClick={buy}>{!e.paymentsAvailable?'оплата скоро откроется':buyBusy?'открываем оплату…':left?'войти в этот вечер':'встать в лист ожидания'}</Button>{!e.paymentsAvailable&&<p className="muted">продажа ещё настраивается. кнопка включится, когда подключим оплату</p>}</>:<div className="muted">регистрация на этот вечер сейчас закрыта</div>}</>}
        {data.registration==='reserved'&&<><div className="success">место держим за вами{reserveCountdown?`. ещё ${reserveCountdown}`:''}</div>{freeEntry?<Button disabled={claimBusy||!freeClaimOpen} onClick={claimTicket}>{claimBusy?'подтверждаем…':'подтвердить билет'}</Button>:salesOpen?<Button disabled={buyBusy||!e.paymentsAvailable} onClick={buy}>{!e.paymentsAvailable?'оплата временно недоступна':buyBusy?'открываем оплату…':'продолжить оплату'}</Button>:<p className="muted">новую ссылку на оплату сейчас открыть нельзя: продажа закрыта</p>}</>}
        {data.registration==='paid'&&<div className="success">{freeEntry?'вы в списке. вход подтверждён':'билет внутри. вы участвуете'}</div>}{data.registration==='attended'&&<div className="success">вы отметились на входе. билет внутри</div>}
        {freeEntry&&['paid','attended'].includes(data.registration)&&<><Button kind="secondary" onClick={()=>setTicketOpen(v=>!v)}>{ticketOpen?'свернуть билет':'открыть билет'}</Button>{data.registration==='paid'&&salesOpen&&<Button kind="danger" disabled={cancelBusy} onClick={cancelTicket}>{cancelBusy?'отменяем…':'отменить билет'}</Button>}{ticketOpen&&<EventPass event={e} attended={data.registration==='attended'}/>}</>}
        {data.registration==='waitlist'&&<div className="success">вы в листе ожидания{data.queuePosition?`. позиция ${data.queuePosition}`:''}</div>}
        {rebuyStatus&&<><div className="muted">{rebuyStatus}</div>{freeEntry?freeClaimOpen&&<Button disabled={claimBusy} onClick={claimTicket}>{claimBusy?'выдаём билет…':'получить билет снова'}</Button>:salesOpen&&<Button disabled={buyBusy||!e.paymentsAvailable} onClick={buy}>{!e.paymentsAvailable?'оплата временно недоступна':buyBusy?'открываем оплату…':'оформить билет заново'}</Button>}</>}
        {data.registration==='no_show'&&<div className="muted">вечер завершён без отметки о посещении</div>}
        {buyNotice&&<div className="success">{buyNotice}</div>}{buyError&&<div className="form-error">{buyError}</div>}{claimError&&<div className="form-error">{claimError}</div>}{cancelError&&<div className="form-error">{cancelError}</div>}
      </div>
    </section>
    <FilmLiveParticipant data={data} reload={reload}/>
    <ParticipantShow data={data} reload={reload}/>
    {!['DRAFT','SALES_OPEN','CHECKIN'].includes(e.status)&&<NextAction data={data} onOpen={()=>nav(`/event/${e.slug}`)} onBuy={buy} onClaim={claimTicket} buyBusy={buyBusy} claimBusy={claimBusy} reserveCountdown={reserveCountdown}/>} 
    <section className="zhivotina-portal">
      <div className="zhivotina-portrait" aria-hidden><img src={`${import.meta.env.BASE_URL}assets/rabbit-baby.png`} alt="" draggable={false}/></div><div><div className="eyebrow">чат с животиной</div><div className="zhivotina-portal-name">{data.creature.name||'животина'}</div><p>спросите про свой вкус, попросите рекомендацию или обсудите фильм</p></div><Button kind="secondary" onClick={()=>nav('/zhivotina')}>поговорить с {data.creature.name||'животиной'}</Button>
    </section>
    {data.isAdmin&&<button type="button" className="admin-entry-link" onClick={()=>nav(`/admin/event/${e.slug}`)}>админка шоу ↗</button>}
    {demoMode&&<Card className="dev"><b>демо</b><span>админка: <a href={`${import.meta.env.BASE_URL}#/admin/${e.slug}`}>/admin/{e.slug}</a>. экран: <a href={`${import.meta.env.BASE_URL}#/screen/${e.slug}`}>/screen/{e.slug}</a></span></Card>}
  </div>
}


function FilmMissionPage(){
  const {assignmentId}=useParams()
  const {data,error,reload}=useStateData()
  const [confirmWatch,setConfirmWatch]=useState(false)
  const [reviewState,setReviewState]=useState<any>(null)
  const [answer,setAnswer]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  if(!data)return <Loading error={error}/>
  const mission=(data.filmAssignments||[]).find(x=>x.id===assignmentId)
  if(!mission)return <div className="page"><Empty>такого задания нет</Empty></div>
  const startReview=async()=>{try{setBusy(true);setMessage('');const x:any=await callApi('film-review-start',{assignmentId:mission.id});setReviewState(x);setAnswer('')}catch(e:any){setMessage(e.message||'не получилось начать разговор')}finally{setBusy(false)}}
  const watching=async()=>{try{setBusy(true);setMessage('');await callApi('film-mark-watching',{assignmentId:mission.id});setConfirmWatch(false);await reload(true)}catch(e:any){setMessage(e.message||'не получилось сохранить статус')}finally{setBusy(false)}}
  const watched=async()=>{try{setBusy(true);setMessage('');await callApi('film-mark-watched',{assignmentId:mission.id,confirm:'credits'});setConfirmWatch(false);await reload(true);const x:any=await callApi('film-review-start',{assignmentId:mission.id});setReviewState(x)}catch(e:any){setMessage(e.message||'не получилось отметить просмотр')}finally{setBusy(false)}}
  const sendAnswer=async(value:any=answer)=>{try{setBusy(true);setMessage('');const x:any=await callApi('film-review-answer',{assignmentId:mission.id,answer:value});setReviewState(x);setAnswer('')}catch(e:any){setMessage(e.message||'не получилось сохранить ответ')}finally{setBusy(false)}}
  const reopen=async()=>{try{setBusy(true);setMessage('');await callApi('film-review-reopen',{assignmentId:mission.id});const x:any=await callApi('film-review-start',{assignmentId:mission.id});setReviewState(x);setAnswer('')}catch(e:any){setMessage(e.message||'не получилось вернуться к разговору')}finally{setBusy(false)}}
  const submit=async()=>{try{setBusy(true);setMessage('');await callApi('film-review-submit',{assignmentId:mission.id});await reload(true);setReviewState(null);setMessage('рецензия отправлена в админку')}catch(e:any){setMessage(e.message||'не получилось отправить рецензию')}finally{setBusy(false)}}
  const current=reviewState
  const draft=current?.draft
  return <div className="page mission-page">
    <div className="mission-hero"><div className="eyebrow">персональный фильм</div><h1>{mission.filmTitle}</h1><p><b>{data.creature.name||'животина'}</b>, этот фильм твой. посмотреть до {eventDate(mission.dueAt)}.</p><div className="mission-meta"><span>до: «{mission.beforeWord}»</span><span>прогнозы: {mission.correctCount}/{mission.totalQuestions}</span><span>{missionStatusLabel(mission.status)}</span></div></div>
    {message&&<div className={message.startsWith('рецензия отправлена')?'success':'form-error'}>{message}</div>}
    {['assigned','watching','overdue'].includes(mission.status)&&!reviewState&&<Card><div className="section-title">после полного просмотра</div>{!confirmWatch?<><p>когда досмотришь фильм целиком, животина вспомнит твои старые прогнозы и начнёт интервью.</p><Button onClick={()=>setConfirmWatch(true)}>я посмотрел(а)</Button></>:<><div className="big-copy">точно до конца?</div><Button disabled={busy} onClick={watched}>да, до титров</Button><Button kind="secondary" disabled={busy} onClick={watching}>нет, ещё смотрю</Button></>}</Card>}
    {['watched','review_in_progress','changes_requested','review_ready'].includes(mission.status)&&!reviewState&&<Card><div className="section-title">рецензия через животинку</div>{mission.status==='changes_requested'&&<p>админ попросил уточнить рецензию. животина откроет прошлый разговор и комментарий.</p>}<Button disabled={busy} onClick={startReview}>{mission.status==='review_ready'?'открыть черновик':'поговорить с животинкой'}</Button></Card>}
    {current?.adminComment&&<div className="review-admin-comment"><b>комментарий админа</b><p>{current.adminComment}</p></div>}
    {current?.previousDraft&&<Card className="review-previous-draft"><div className="section-title">прошлый отправленный черновик</div><div className="review-before-after compact"><span><small>до</small>«{current.previousDraft.beforeWord}»</span><span><small>после</small>«{current.previousDraft.afterWord}»</span></div><p>{current.previousDraft.userReview}</p><p className="muted">животинка: {current.previousDraft.animalTake}</p></Card>}
    {current?.status==='active'&&current.nextQuestion&&<section className="mission-review-chat"><div className="review-chat-head"><img src={import.meta.env.BASE_URL+'assets/rabbit-baby.png'} alt="" draggable={false}/><div><div className="eyebrow">специальный режим</div><h2>{data.creature.name||'животина'} × {mission.filmTitle}</h2></div></div><div className="review-history">{(Array.isArray(current.messages)?current.messages:[]).map((m:any,i:number)=><div key={i} className={'chat-msg '+(m.role==='user'?'user':'assistant')}>{m.text}</div>)}</div><div className="zhivotina-reply">{current.nextQuestion.text}</div>{current.nextQuestion.kind==='rating'?<div className="rating review-rating">{[1,2,3,4,5].map(n=><button disabled={busy} key={n} onClick={()=>sendAnswer(n)}>{n}</button>)}</div>:<div className="review-compose"><textarea rows={3} value={answer} placeholder={current.nextQuestion.key==='after_word'?'одно слово':'ответ животинке'} onChange={e=>setAnswer(e.target.value)}/><Button disabled={busy||!answer.trim()} onClick={()=>sendAnswer()}>{busy?'сохраняем…':'ответить'}</Button></div>}</section>}
    {draft&&<Card className="review-preview"><div className="eyebrow">preview. ещё не отправлено</div><h2>{draft.animalName} × {draft.filmTitle}</h2><div className="review-before-after"><span><small>до просмотра</small>«{draft.beforeWord}»</span><span><small>после просмотра</small>«{draft.afterWord}»</span></div><div className="review-crumbs">{draft.crumbs}/5 крошек</div><p><b>что осталось в голове:</b> {draft.whatStayed}</p><p><b>что сработало:</b> {draft.worked}</p><p><b>что не сработало:</b> {draft.didntWork}</p><p><b>кому смотреть:</b> {draft.recommendTo}</p><p><b>рецензия:</b> {draft.userReview}</p><p><b>животинка считает:</b> {draft.animalTake}</p><div className="review-preview-actions"><Button kind="secondary" disabled={busy} onClick={reopen}>вернуться и поправить</Button><Button disabled={busy} onClick={submit}>отправить рецензию</Button></div></Card>}
    {['submitted','approved','published'].includes(mission.status)&&<Card><div className="eyebrow">{missionStatusLabel(mission.status)}</div><h2>рецензия уже у организаторов</h2><p>{mission.status==='submitted'?'она ждёт проверки. отправленный snapshot больше не переписывается.':mission.status==='approved'?'рецензия одобрена.':'рецензия опубликована.'}</p></Card>}
  </div>
}

function EventPass({event,attended=false}:{event:DemoState['event'];attended?:boolean}){return <div className="event-pass" role="group" aria-label="билет на мероприятие"><div className="event-pass-top"><span>насыпатели в кино. билет</span><b>{attended?'вход отмечен':'вход подтверждён'}</b></div><div className="event-pass-date">{eventShortDate(event.startsAt)}</div><div className="event-pass-grid"><div><small>начало</small><strong>{eventTime(event.startsAt)}</strong></div><div><small>место</small><strong>{event.venueName||'место объявим позже'}</strong></div></div>{event.venueAddress&&<div className="event-pass-address">{event.venueAddress}</div>}<div className="event-pass-stub"><span>билет живёт внутри приложения</span><span>что будет дальше, приложение откроет по ходу вечера</span></div></div>}

function NextAction({data,onOpen,onBuy,onClaim,buyBusy=false,claimBusy=false,reserveCountdown=''}:{data:DemoState;onOpen:()=>void;onBuy:()=>void;onClaim:()=>void;buyBusy?:boolean;claimBusy?:boolean;reserveCountdown?:string}){
  const s=data.event.status;const salesOpen=s==='SALES_OPEN';const freeEntry=Number(data.event.ticketPriceRub)===0;const freeClaimOpen=freeEntry&&['SALES_OPEN','CHECKIN'].includes(s)
  if(data.registration==='none'&&freeEntry)return <Card className="next-card"><div className="eyebrow">3 октября</div><h3>{freeClaimOpen?'заберите билет':'регистрация закрыта'}</h3><p>{freeClaimOpen?'одна кнопка, и место закрепится за вами. дальше билет останется внутри приложения.':'новый билет сейчас получить нельзя'}</p>{freeClaimOpen&&<Button disabled={claimBusy} onClick={onClaim}>{claimBusy?'выдаём билет…':'получить билет'}</Button>}</Card>
  if(data.registration==='none')return <Card className="next-card"><div className="eyebrow">следующий шаг</div><h3>{salesOpen?(data.event.paymentsAvailable?'сначала билет':'продажа скоро откроется'):'продажа закрыта'}</h3><p>{salesOpen?(data.event.paymentsAvailable?'откроется, когда вы купите билет':'оплата ещё настраивается. здесь появится кнопка, как только касса будет готова'):'новый билет сейчас оформить нельзя'}</p><p className="muted">игровая механика события доступна только участникам этого вечера</p></Card>
  if(data.registration==='waitlist')return <Card className="next-card"><div className="eyebrow">сейчас</div><h3>ждём место{data.queuePosition?`. вы №${data.queuePosition}`:''}</h3><p>как только очередь дойдёт до вас, место автоматически закрепится за вами на 15 минут и придёт уведомление</p></Card>
  if(data.registration==='refunded'||data.registration==='cancelled')return <Card className="next-card"><div className="eyebrow">{data.registration==='refunded'?'билет возвращён':'билет отменён'}</div><h3>доступ к событию закрыт</h3><p>{freeEntry?(freeClaimOpen?'можно получить новый билет':'регистрация уже закрыта'):(salesOpen?'если хотите снова участвовать, билет можно оформить заново':'продажа билетов сейчас закрыта')}</p>{freeEntry?freeClaimOpen&&<Button disabled={claimBusy} onClick={onClaim}>{claimBusy?'выдаём билет…':'получить билет снова'}</Button>:salesOpen&&<Button disabled={buyBusy||!data.event.paymentsAvailable} onClick={onBuy}>{!data.event.paymentsAvailable?'оплата временно недоступна':buyBusy?'открываем оплату…':'оформить билет'}</Button>}</Card>
  if(data.registration==='no_show')return <Card className="next-card"><div className="eyebrow">вечер завершён</div><h3>посещение не отмечено</h3><p>этот статус не требует повторной оплаты</p></Card>
  if(data.registration==='reserved')return <Card className="next-card"><div className="eyebrow">место ваше</div><h3>{freeEntry?'подтвердите билет':'закончите оплату'}{reserveCountdown?`. ${reserveCountdown}`:''}</h3>{freeEntry?<Button disabled={claimBusy||!freeClaimOpen} onClick={onClaim}>{claimBusy?'подтверждаем…':'подтвердить билет'}</Button>:salesOpen?<Button disabled={buyBusy||!data.event.paymentsAvailable} onClick={onBuy}>{!data.event.paymentsAvailable?'оплата временно недоступна':buyBusy?'открываем оплату…':'продолжить оплату'}</Button>:<p>продажа закрыта, новую ссылку на оплату открыть нельзя</p>}</Card>
  if(!['paid','attended'].includes(data.registration))return <Card className="next-card"><div className="eyebrow">статус билета</div><h3>проверьте билет с организатором</h3><p>приложение не предлагает повторную оплату для этого статуса</p></Card>
  if(!data.event.nonexistentFilmEnabled)return <Card className="next-card"><div className="eyebrow">вы внутри</div><h3>механика пока закрыта</h3><p>её включат организаторы в нужный момент. заранее кнопки и задания не открываются</p></Card>
  const copy:Partial<Record<EventStatus,[string,string]>>={IDEAS_OPEN:['приём идей открыт','придумать фильм'],IDEAS_LOCKED:['идеи закрыты','ждём выбор животины'],TOP3_READY:['три идеи выбраны','сейчас решит рандом'],IDEA_RANDOMIZED:['идея выбрана','ищем реального двойника'],MOVIE_SEARCH:['животина ищет','проверяем реальные фильмы'],MOVIE_FINALISTS:['финальная тройка','сейчас рандом выберет фильм'],MOVIE_SELECTED:['фильм выбран','скоро откроются прогнозы'],PREDICTIONS_OPEN:['10 прогнозов','решите, что будет в фильме'],PREDICTIONS_LOCKED:['прогнозы закрыты','ответы уже зафиксированы'],WATCHING:['смотрим','телефоны вниз'],PREDICTIONS_SCORED:['результаты','смотрите, кто угадал больше'],DISCUSSION:['фильм закончился','оставьте первую реакцию'],FINAL_REVIEW:['одна финальная фраза','она попадёт в коллективную рецензию'],FEEDBACK:['3 минуты','помогите улучшить следующий вечер'],CLOSED:['вечер закрыт','архив останется в клубе']}
  const c=copy[s]||['вы внутри','ждём начала'];return <Card className="next-card"><div className="eyebrow">следующий шаг</div><h3>{c[0]}</h3><p>{c[1]}</p><Button onClick={onOpen}>открыть</Button></Card>
}

function Profile(){const {data,error}=useStateData();const nav=useNavigate();if(!data)return <Loading error={error}/>;return <div className="page"><div className="row spread profile-head"><div><div className="eyebrow">ваш профиль</div><h2>{data.profile.displayName}</h2></div><Button kind="secondary" onClick={()=>nav('/onboarding?edit=1')}>изменить</Button></div><ProfilePreview profile={data.profile}/><div className="stats-grid"><Card><strong>{data.profileStats.eventsAttended}</strong><span>вечеров</span></Card><Card><strong>{data.profileStats.predictionPoints}</strong><span>очков</span></Card><Card><strong>{data.profileStats.ideasSubmitted}</strong><span>идей</span></Card></div><Card><div className="section-title">ваш киноднк</div><TasteSummary taste={data.profile.taste}/><Button kind="secondary" onClick={()=>nav('/zhivotina?mode=taste')}>что {data.creature.name||'животина'} думает о моём вкусе</Button></Card></div>}
function TasteSummary({taste}:{taste:TasteVector}){const rows:[string,number][]=[['странность',taste.weirdness],['атмосфера',taste.atmosphere],['эксперимент',taste.experimental],['медленность',taste.slowness],['сюрреализм',taste.surrealism]];return <div>{rows.map(([k,v])=><div className="taste-line" key={k}><span>{k}</span><div><i style={{width:`${v}%`}}/></div><b>{v}</b></div>)}</div>}

function EventPage(){
  const {data,error,reload}=useStateData();const {slug}=useParams();const nav=useNavigate();const [title,setTitle]=useState('');const [plot,setPlot]=useState('');const [actionError,setActionError]=useState('');const [actionBusy,setActionBusy]=useState(false);useEffect(()=>{if(data?.idea&&!title&&!plot){setTitle(data.idea.title||'');setPlot(data.idea.plot||'')}},[data?.idea,title,plot]);if(!data)return <Loading error={error}/>;if(slug!==data.event.slug)return <div className="page"><Empty>такого события нет</Empty></div>
  if(!['paid','attended'].includes(data.registration))return <div className="page"><Card><div className="big-copy">это механика участников</div><p>доступ появляется после подтверждённого билета на конкретное событие</p><Button onClick={()=>nav('/')}>к событию</Button></Card></div>
  if(!data.event.nonexistentFilmEnabled)return <div className="page"><Card><div className="eyebrow">режим закрыт</div><div className="big-copy">организаторы ещё не включили механику</div><p>когда начнём, этот экран изменится сам</p></Card></div>
  const s=data.event.status;const submitIdea=async()=>{if(!title.trim()||!plot.trim()){setActionError(!title.trim()&&!plot.trim()?'нужны название и сюжет':!title.trim()?'добавьте название':'добавьте короткий сюжет');return}try{setActionBusy(true);setActionError('');await callApi('submit-idea',{slug:data.event.slug,title:title.trim(),plot:plot.trim()});await reload()}catch(e:any){setActionError(e.message)}finally{setActionBusy(false)}}
  return <div className="page event-page"><div className="row spread event-page-head"><div><div className="eyebrow">режим «несуществующий фильм»</div><h2>{eventDate(data.event.startsAt)}</h2></div><Pill>{statusLabel(s)}</Pill></div>
    {['DRAFT','SALES_OPEN','CHECKIN'].includes(s)&&<Card><div className="big-copy">вы внутри</div><p>режим уже включён, но первое задание откроют организаторы прямо на вечере</p></Card>}
    {s==='IDEAS_OPEN'&&<><Card><div className="section-title">придумайте фильм, которого не существует</div><Field label="название. до 5–7 слов"><input maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></Field><Field label="сюжет. до 500 знаков"><textarea maxLength={500} value={plot} onChange={e=>setPlot(e.target.value)}/></Field><Button disabled={actionBusy} onClick={submitIdea}>{actionBusy?'сохраняем…':data.idea?'обновить анонимную заявку':'отправить анонимно'}</Button>{actionError&&<div className="form-error">{actionError}</div>}{data.idea&&<div className="success">заявка сохранена. автора сейчас не видят даже участники</div>}</Card><IdeaCoach data={data} title={title} plot={plot}/></>}
    {['IDEAS_LOCKED','TOP3_READY'].includes(s)&&<Finalists title="три идеи животины" items={data.ideaFinalists.map(x=>({name:x.title,sub:x.plot}))}/>} 
    {['IDEA_RANDOMIZED','MOVIE_SEARCH'].includes(s)&&<Card><div className="eyebrow">выбрано рандомом</div><h3>{data.selectedIdea?.title}</h3><p>{data.selectedIdea?.plot}</p>{data.selectedIdea?.author&&<p className="success">автор раскрыт: {data.selectedIdea.author}</p>}<div className="scan">животина ищет реального двойника…</div></Card>}
    {s==='MOVIE_FINALISTS'&&<Finalists title="три проверенных двойника" items={data.movieFinalists.map(x=>({name:`${x.title}${x.year?`. ${x.year}`:''}`,sub:`${x.runtimeMin||'?'} мин. ${x.reason||''}`}))}/>} 
    {s==='MOVIE_SELECTED'&&<Card><div className="eyebrow">фильм вечера</div><h3>{data.selectedMovie?.title}</h3><p>{data.selectedMovie?.year}. {data.selectedMovie?.runtimeMin} минут</p><p>{data.selectedMovie?.reason}</p></Card>}
    {s==='PREDICTIONS_OPEN'&&<PredictionForm data={data} reload={reload}/>} 
    {['PREDICTIONS_LOCKED','WATCHING'].includes(s)&&<Card><div className="big-copy">телефоны вниз</div><p>{data.predictionSubmitted?'ваши прогнозы зафиксированы.':'прогнозы закрыты.'} сейчас лучше просто смотреть кино</p></Card>}
    {s==='PREDICTIONS_SCORED'&&<Card><div className="big-copy">прогнозы посчитаны</div><p>результаты уже на общем экране и в рейтинге клуба</p></Card>}
    {s==='DISCUSSION'&&<ReactionForm data={data} reload={reload}/>} 
    {s==='FINAL_REVIEW'&&<ReviewForm data={data} reload={reload}/>} 
    {s==='FEEDBACK'&&<FeedbackForm data={data} reload={reload}/>} 
    {s==='CLOSED'&&<><Card><div className="big-copy">вечер закрыт</div><p>фильм, результаты и коллективная рецензия останутся в архиве клуба</p><Button kind="secondary" onClick={()=>nav('/archive')}>в архив</Button></Card><FeedbackForm data={data} reload={reload}/></>}
  </div>
}

function IdeaCoach({data,title,plot}:{data:DemoState;title:string;plot:string}){const creatureName=data.creature.name||'животина';const [q,setQ]=useState('');const [reply,setReply]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const ask=async(text=q)=>{if(!text.trim())return;try{setBusy(true);setMessage('');const r:any=await callApi('jipitina-chat',{slug:data.event.slug,mode:'idea_coach',message:text,draftTitle:title,draftPlot:plot});setReply(r.reply);setQ('')}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};return <Card className="coach-card"><div className="row spread"><div className="section-title">позвать {creatureName}</div><Pill>помощь с идеей</Pill></div><div className="chips"><button onClick={()=>ask('у меня вообще нет идеи')}>нет идеи</button><button onClick={()=>ask('помоги докрутить этот черновик')}>докрутить</button><button onClick={()=>ask('сделай направление страннее, но не пиши фильм за меня')}>страннее</button><button onClick={()=>ask('проверь, что в заявке сейчас самое слабое')}>проверить</button></div>{reply&&<div className="zhivotina-reply">{reply}</div>}{message&&<div className="form-error">{message}</div>}<div className="idea-coach-compose"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="спросить про идею" onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void ask()}}}/><button type="button" disabled={busy||!q.trim()} onClick={()=>void ask()}>→</button></div></Card>}

function PredictionForm({data,reload}:{data:DemoState;reload:()=>void}){const [answers,setAnswers]=useState<Record<string,boolean>>(()=>Object.fromEntries(data.predictions.filter(p=>p.answer!==undefined).map(p=>[p.id,p.answer!])));const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const answeredCount=data.predictions.filter(p=>typeof answers[p.id]==='boolean').length;const done=data.predictions.length===10&&answeredCount===10;const choose=(id:string,value:boolean)=>{if(data.predictionSubmitted||busy)return;setMessage('');setAnswers(prev=>({...prev,[id]:value}))};const submit=async()=>{if(!done){setMessage(`ответьте на все 10 прогнозов. сейчас ${answeredCount}/10`);return}try{setBusy(true);setMessage('');const predictions=data.predictions.map(p=>({...p,answer:answers[p.id]}));await callApi('submit-predictions',{slug:data.event.slug,predictions});await reload()}catch(e:any){setMessage(e.message||'не получилось сохранить прогнозы')}finally{setBusy(false)}};return <Card><div className="section-title">10 прогнозов</div><p className="muted">после фиксации изменить ответы нельзя</p>{data.predictions.map(p=><div className="prediction" key={p.id}><b>{p.position}. {p.text}</b><div className="binary"><button type="button" disabled={busy||data.predictionSubmitted} className={answers[p.id]===true?'active':''} onClick={()=>choose(p.id,true)}>будет</button><button type="button" disabled={busy||data.predictionSubmitted} className={answers[p.id]===false?'active':''} onClick={()=>choose(p.id,false)}>не будет</button></div></div>)}{message&&<div className="form-error">{message}</div>}<Button disabled={busy||data.predictionSubmitted||data.predictions.length!==10} onClick={submit}>{busy?'сохраняем…':data.predictionSubmitted?'ответы зафиксированы':data.predictions.length!==10?'прогнозы ещё загружаются':'зафиксировать прогнозы'}</Button></Card>}

function ReactionForm({data,reload}:{data:DemoState;reload:()=>void}){const nav=useNavigate();const [rating,setRating]=useState(data.reaction?.rating||7);const [stateWord,setState]=useState(data.reaction?.stateWord||'');const [thought,setThought]=useState(data.reaction?.thought||'');const [recommendation,setRec]=useState<PostFilmReaction['recommendation']>(data.reaction?.recommendation||'');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const save=async()=>{const missing=[];if(!stateWord.trim())missing.push('одно слово про состояние');if(!thought.trim())missing.push('мысль после фильма');if(!recommendation)missing.push('рекомендацию');if(missing.length){setMessage(`заполните: ${missing.join(', ')}`);return}try{setBusy(true);setMessage('');await callApi('submit-reaction',{slug:data.event.slug,reaction:{rating,stateWord:stateWord.trim(),thought:thought.trim(),recommendation}});await reload()}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};return <><Card><div className="section-title">первая реакция</div><p className="muted">не рецензия. что осталось сразу после титров</p><div className="rating">{[1,2,3,4,5,6,7,8,9,10].map(n=><button type="button" className={rating===n?'active':''} key={n} onClick={()=>setRating(n)}>{n}</button>)}</div><Field label="одно слово про состояние"><input maxLength={80} value={stateWord} onChange={e=>{setMessage('');setState(e.target.value)}}/></Field><Field label="что осталось в голове"><textarea maxLength={500} value={thought} onChange={e=>{setMessage('');setThought(e.target.value)}}/></Field><div className="choice-question"><span>посоветовали бы?</span><ChoiceChips value={recommendation} onChange={v=>{setMessage('');setRec(v as PostFilmReaction['recommendation'])}} options={[['yes','да'],['no','нет'],['depends','смотря кому']]}/></div><Button disabled={busy} onClick={save}>{busy?'сохраняем…':'сохранить реакцию'}</Button>{message&&<div className="form-error">{message}</div>}</Card><Card><div className="section-title">обсудить с {data.creature.name||'Животиной'}</div><p className="muted">{data.creature.name||'животина'} видит ваши прогнозы, реакцию и кинопрофиль — но не выдаёт чужие приватные ответы</p><Button kind="secondary" onClick={()=>nav('/zhivotina?mode=post_film')}>поговорить с {data.creature.name||'Животиной'}</Button></Card></>}

function ReviewForm({data,reload}:{data:DemoState;reload:()=>void}){const [rating,setRating]=useState(data.review?.rating||data.reaction?.rating||7);const [sentence,setSentence]=useState(data.review?.sentence||'');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const save=async()=>{if(!sentence.trim()){setMessage('напишите одну финальную фразу');return}try{setBusy(true);setMessage('');await callApi('submit-review',{slug:data.event.slug,rating,sentence:sentence.trim()});await reload()}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};return <Card><div className="section-title">ваша строка в общей рецензии</div><div className="rating">{[1,2,3,4,5,6,7,8,9,10].map(n=><button type="button" className={rating===n?'active':''} key={n} onClick={()=>setRating(n)}>{n}</button>)}</div><Field label="ровно одна финальная фраза"><textarea maxLength={180} value={sentence} onChange={e=>{setMessage('');setSentence(e.target.value)}}/></Field><Button disabled={busy} onClick={save}>{busy?'сохраняем…':'сохранить без редактуры'}</Button>{message&&<div className="form-error">{message}</div>}</Card>}
function FeedbackForm({data,reload}:{data:DemoState;reload:()=>void}){const [returnIntent,setReturn]=useState(data.feedback?.returnIntent||'да');const [strongest,setStrongest]=useState(data.feedback?.strongest||'');const [improve,setImprove]=useState(data.feedback?.improve||'');const [willingness,setWtp]=useState(data.feedback?.willingness??900);const [durationFeel,setDuration]=useState(data.feedback?.durationFeel||'нормально');const [inviteFriend,setInvite]=useState(data.feedback?.inviteFriend??8);const [message,setMessage]=useState('');const [saved,setSaved]=useState(false);const [busy,setBusy]=useState(false);const change=()=>{setSaved(false);setMessage('')};const save=async()=>{try{setBusy(true);setMessage('');setSaved(false);await callApi('submit-feedback',{slug:data.event.slug,feedback:{returnIntent,strongest,improve,willingness,durationFeel,inviteFriend}});await reload();setSaved(true)}catch(e:any){setMessage(e.message||'не получилось сохранить обратную связь')}finally{setBusy(false)}};return <Card><div className="section-title">3 минуты на исследование</div><Field label="придёте ещё?"><select value={returnIntent} onChange={e=>{change();setReturn(e.target.value)}}><option>да</option><option>скорее да</option><option>не знаю</option><option>скорее нет</option><option>нет</option></select></Field><Field label="что было самым сильным?"><textarea maxLength={1000} value={strongest} onChange={e=>{change();setStrongest(e.target.value)}}/></Field><Field label="что надо исправить?"><textarea maxLength={1000} value={improve} onChange={e=>{change();setImprove(e.target.value)}}/></Field><Field label="по длительности"><select value={durationFeel} onChange={e=>{change();setDuration(e.target.value)}}><option>коротко</option><option>нормально</option><option>долго</option></select></Field><Field label="насколько вероятно, что позовёте друга?. 0–10"><input type="number" inputMode="numeric" min="0" max="10" value={inviteFriend} onChange={e=>{change();setInvite(Math.max(0,Math.min(10,Number(e.target.value))))}}/></Field><Field label="сколько нормально платить за следующий офлайн?"><input type="number" inputMode="numeric" min="0" step="100" value={willingness} onChange={e=>{change();setWtp(Math.max(0,Number(e.target.value)||0))}}/></Field><Button disabled={busy} onClick={save}>{busy?'отправляем…':data.feedback?'обновить ответ':'отправить'}</Button>{saved&&<div className="success">ответ сохранён</div>}{message&&<div className="form-error">{message}</div>}</Card>}
function Finalists({title,items}:{title:string;items:{name:string;sub:string}[]}){return <Card><div className="section-title">{title}</div>{items.length?items.map((x,i)=><div className="finalist" key={i}><span>0{i+1}</span><div><b>{x.name}</b><p>{x.sub}</p></div></div>):<Empty>животина ещё думает</Empty>}</Card>}

function cleanAiText(text:string){return text.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/__([^_]+)__/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/^#{1,6}\s+/gm,'').replace(/^\s*[-*]\s+/gm,'— ')}
function ZhivotinaPage(){
  const {data,error,reload}=useStateData();const [search]=useSearchParams();const [text,setText]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [localMessages,setLocalMessages]=useState<any[]>([]);const threadEnd=useRef<HTMLDivElement|null>(null)
  useEffect(()=>{if(data&&!busy)setLocalMessages(data.jipitinaMessages||[])},[data?.jipitinaMessages,busy])
  useEffect(()=>{window.requestAnimationFrame(()=>threadEnd.current?.scrollIntoView({behavior:'smooth',block:'end'}))},[localMessages.length,busy])
  if(!data)return <Loading error={error}/>;const requested=search.get('mode')||'general';const mode=requested==='post_film'?'post_film':requested==='taste'?'taste':'general'
  const send=async(raw=text,forcedMode=mode)=>{const messageText=raw.trim();if(!messageText||busy)return;const optimistic={id:`local-${Date.now()}`,role:'user',text:messageText,mode:forcedMode,createdAt:new Date().toISOString()};setLocalMessages(prev=>[...prev,optimistic]);setText('');setBusy(true);setMessage('');try{const r:any=await callApi('jipitina-chat',{slug:data.event.slug,mode:forcedMode,message:messageText});setLocalMessages(prev=>[...prev,{id:`local-a-${Date.now()}`,role:'assistant',text:cleanAiText(String(r.reply||'')),mode:forcedMode,createdAt:new Date().toISOString()}]);void reload()}catch(e:any){setLocalMessages(prev=>prev.filter(m=>m.id!==optimistic.id));setText(messageText);setMessage(e.message||'чат временно недоступен. попробуйте ещё раз')}finally{setBusy(false)}}
  const suggestions=mode==='post_film'?['почему мне это могло понравиться?','что в моих прогнозах сильнее всего разошлось с фильмом?','задай мне один неприятно точный вопрос про фильм']:mode==='taste'?['какой у меня сейчас кинопортрет?','где мой вкус противоречит сам себе?','что мне стоит попробовать посмотреть вне привычного?']:['что посмотреть сегодня?','какой у меня вообще вкус?','разбери мои любимые фильмы']
  const creatureName=data.creature?.name||'животина'
  return <div className="page chat-page">
    <div className="chat-head"><div className="chat-creature-identity"><div className="chat-creature-portrait" aria-hidden><img src={`${import.meta.env.BASE_URL}assets/rabbit-baby.png`} alt="" draggable={false}/></div><div><div className="eyebrow">ваша животина</div><h2>{creatureName}</h2></div></div><p className="muted">помогает только с кино. подбирает фильмы, разбирает ваш вкус и обсуждает просмотренное</p></div>
    <div className="chips chat-suggestions">{suggestions.map(s=><button type="button" disabled={busy} key={s} onClick={()=>send(s,mode)}>{s}</button>)}</div>
    {message&&<div className="form-error chat-error">{message}</div>}
    <div className="chat-thread">{localMessages.length===0&&<div className="zhivotina-reply">начни изучать кино. расскажи, что тебе нравится, или спроси, что посмотреть</div>}{localMessages.map(m=><div key={m.id} className={`chat-msg ${m.role}`}>{m.role==='assistant'?cleanAiText(m.text):m.text}</div>)}{busy&&<div className="chat-msg assistant typing"><i/><i/><i/></div>}<div ref={threadEnd}/></div>
    {typeof document!=='undefined'&&createPortal(<div className="chat-compose chat-compose-portal"><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}} placeholder="сообщение"/><button className="send" disabled={busy||!text.trim()} onClick={()=>send()}>{busy?'…':'→'}</button></div>,document.body)}
  </div>
}

function Club(){const {data,error}=useStateData();if(!data)return <Loading error={error}/>;return <div className="page"><div className="eyebrow">клуб</div><h2>что остаётся после вечера</h2><Card><div className="section-title">таблица прогнозистов</div>{data.leaderboard.map((r,i)=><div className="leader" key={`${r.name}-${i}`}><span>{i+1}</span><b>{r.name}</b><strong>{r.points}</strong><small>{r.wins} побед. {r.events} веч.</small></div>)}</Card><Card><div className="section-title">архив</div>{data.pastEvents.length?data.pastEvents.map(ev=><div className="archive-event" key={ev.id}><small>{eventDate(ev.startsAt)}</small><b>{ev.movie?.title||ev.title}</b>{ev.review&&<span>есть коллективная рецензия</span>}</div>):<Empty>первый вечер ещё впереди</Empty>}</Card><Card><div className="section-title">дальше</div><p>здесь появятся люди клуба, артефакты, история ваших оценок и совпадения по кино. публичный профиль будет только у тех, кто сам это разрешил</p></Card></div>}


function showRunStatusLabel(status:string){return status==='idle'?'готово':status==='running'?'эфир':status==='paused'?'пауза':status==='finished'?'завершено':status}
function registrationStatusLabel(status:AdminParticipant['status']){return status==='paid'?'билет':status==='attended'?'пришёл':status==='reserved'?'резерв':status==='waitlist'?'ожидание':status==='cancelled'?'билет сброшен':status==='no_show'?'не пришёл':status==='refunded'?'возврат':status}

function ShowControl({data,busy,run}:{data:DemoState;busy:boolean;run:(action:string,payload?:Record<string,unknown>)=>Promise<any>}){
  const show=data.show
  if(!show)return <Card><p>runtime шоу пока не загружен</p></Card>
  const rows=data.adminParticipants||[]
  const confirmed=rows.filter(row=>['paid','attended'].includes(row.status)).length
  const attended=rows.filter(row=>row.status==='attended').length
  const waiting=rows.filter(row=>row.status==='waitlist').length
  const runtime=show.runtime
  const block=runtime.currentBlock
  const music=block?.type==='music_live'
  const finished=runtime.runStatus==='finished'
  const command=(op:string,extra:Record<string,unknown>={})=>run('admin-show-control',{op,...extra})
  return <section className={runtime.runStatus==='running'?'show-console live':'show-console'}>
    <div className="show-console-head">
      <div><div className="eyebrow">{finished?'вечер закончен':runtime.runStatus==='idle'?'готово к запуску':runtime.runStatus==='paused'?'шоу на паузе':'шоу идёт'}</div><h1>{block?.title||'программа вечера'}</h1></div>
      <span className={runtime.runStatus==='running'?'show-live-dot on':'show-live-dot'}>{showRunStatusLabel(runtime.runStatus)}</span>
    </div>
    <div className="show-console-stats"><span><b>{confirmed}</b>в списке</span><span><b>{attended}</b>пришли</span><span><b>{show.onlineCount}</b>online</span><span><b>{waiting}</b>ожидание</span></div>
    <div className="show-timeline">{show.program.blocks.map(b=><button type="button" disabled={busy} onClick={()=>command('jump',{blockId:b.id})} className={b.id===runtime.currentBlockId?'current':''} key={b.id}><span>{b.index+1}</span><b>{b.title}</b><small>{b.durationMin?b.durationMin+' мин':'без таймера'}</small></button>)}</div>
    {runtime.runStatus==='idle'&&<Button disabled={busy} onClick={()=>command('start')}>начать мероприятие</Button>}
    {runtime.runStatus==='paused'&&<Button disabled={busy} onClick={()=>command('resume')}>продолжить шоу</Button>}
    {runtime.runStatus==='running'&&!music&&<div className="show-primary-controls"><Button kind="secondary" disabled={busy||runtime.currentBlockIndex===0} onClick={()=>command('back')}>← назад</Button><Button disabled={busy} onClick={()=>command('next')}>следующий блок →</Button></div>}
    {runtime.runStatus==='running'&&music&&<Button disabled={busy} onClick={()=>command('end_music')}>закончить выступление</Button>}
    {runtime.runStatus==='running'&&!music&&show.program.blocks.some(b=>b.type==='music_live')&&<Button kind="secondary" disabled={busy} onClick={()=>command('start_music')}>начать music live</Button>}
    {['running','paused'].includes(runtime.runStatus)&&<div className="show-secondary-controls">
      {runtime.runStatus==='running'&&<Button kind="secondary" disabled={busy} onClick={()=>command('pause')}>пауза</Button>}
      <Button kind="secondary" disabled={busy} onClick={()=>command('restart')}>перезапустить блок</Button>
      <Button kind="secondary" disabled={busy} onClick={()=>command('skip')}>пропустить блок</Button>
    </div>}
    {!finished&&runtime.runStatus!=='idle'&&<Button kind="danger" disabled={busy} onClick={()=>{if(window.confirm('закончить мероприятие? это переведёт всех в финальное состояние'))void command('end_event')}}>закончить мероприятие</Button>}
  </section>
}

function ShowRoundControl({data,busy,run}:{data:DemoState;busy:boolean;run:(action:string,payload?:Record<string,unknown>)=>Promise<any>}){
  const show=data.show
  const block=show?.runtime.currentBlock
  const round=show?.currentRound
  const [movieId,setMovieId]=useState('')
  const [prompt,setPrompt]=useState('')
  const [options,setOptions]=useState('')
  useEffect(()=>{setMovieId(round?.movie?.id||'');setPrompt(String(round?.question?.prompt||''));setOptions(Array.isArray(round?.question?.options)?round.question.options.join(', '):'')},[round?.id,round?.movie?.id,round?.question?.prompt])
  if(!show||!block)return null
  if(!['cinema_rounds','warm_up','final_vote'].includes(block.type))return <Card className="show-round-card"><div className="section-title">раунд</div><p className="muted">в блоке «{block.title}» кинораунд не нужен</p></Card>
  const catalog=data.movieCatalog||[]
  const canMovie=block.type==='cinema_rounds'
  return <Card className="show-round-card">
    <div className="row spread"><div><div className="section-title">текущий раунд</div><h2>{round?'раунд '+round.roundNo:'ещё не запущен'}</h2></div>{round&&<Pill>{round.status}</Pill>}</div>
    {!round||round.status!=='active'?<Button disabled={busy||show.runtime.runStatus!=='running'} onClick={()=>run('admin-round-start')}>{show.runtime.currentRound?'следующий раунд':'запустить раунд'}</Button>:<>
      {canMovie&&<div className="show-round-section"><div className="section-title">фильм</div>{round.movie?<div className="show-current-movie"><b>{round.movie.title}</b><span>{round.movie.usageStatus||'needs_review'}{round.movie.videoId?'. video ready':'. без video id'}</span></div>:<p className="muted">фильм пока не выбран</p>}<div className="inline"><Button disabled={busy} onClick={()=>run('admin-round-random-movie')}>запустить рандом</Button><Button kind="secondary" disabled={busy||!movieId} onClick={()=>run('admin-round-set-movie',{movieId})}>выбрать вручную</Button></div><select value={movieId} onChange={e=>setMovieId(e.target.value)}><option value="">выберите фильм из каталога</option>{catalog.map(m=><option value={m.id} key={m.id}>{m.title}. {m.usageStatus||'needs_review'}</option>)}</select>{round.movie&&(round.movie.usageStatus==='no_video'||(!round.movie.videoId&&!round.movie.sourceUrl))&&<div className="show-fallback"><b>fallback животины</b><p>{round.movie.animalComment||'видео нет. название и вопрос всё равно можно показать на экране'}</p></div>}</div>}
      <div className="show-round-section"><div className="section-title">вопрос аудитории</div><Field label="вопрос"><textarea value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="например: ты бы продолжил смотреть после такого трейлера?"/></Field><Field label="варианты. через запятую"><input value={options} onChange={e=>setOptions(e.target.value)} placeholder="да, нет, только если меня заставят"/></Field><Button kind="secondary" disabled={busy||!prompt.trim()} onClick={()=>run('admin-round-question',{question:{key:'round_'+round.id,prompt,options:options.split(',').map(x=>x.trim()).filter(Boolean)}})}>сохранить вопрос</Button></div>
      <div className="show-round-section"><div className="section-title">голосование</div><div className="show-vote-controls">{round.voteState==='open'?<Button kind="danger" disabled={busy} onClick={()=>run('admin-vote-control',{op:'close'})}>закрыть голосование</Button>:<Button disabled={busy||!round.question} onClick={()=>run('admin-vote-control',{op:'open'})}>открыть голосование</Button>}{round.resultsVisible?<Button kind="secondary" disabled={busy} onClick={()=>run('admin-vote-control',{op:'hide'})}>скрыть результаты</Button>:<Button kind="secondary" disabled={busy} onClick={()=>run('admin-vote-control',{op:'show'})}>показать результаты</Button>}</div>{round.resultsVisible&&show.voteResults.length>0&&<div className="admin-vote-results">{show.voteResults.map((x,i)=><div key={i}><span>{answerText(x.answer)}</span><b>{x.count}</b></div>)}</div>}</div>
      {canMovie&&<div className="show-round-section"><div className="section-title">видео</div><div className="inline"><Button disabled={busy||!round.movie} onClick={()=>run('admin-video-control',{op:'play'})}>запустить видео</Button><Button kind="secondary" disabled={busy} onClick={()=>run('admin-video-control',{op:'stop'})}>остановить видео</Button></div></div>}
      <div className="show-round-section"><div className="section-title">крошки</div><Button kind="secondary" disabled={busy} onClick={()=>run('admin-award-crumbs',{scope:'round_voters',amount:show.program.rewards.round,sourceId:'round:'+round.id})}>выдать по {show.program.rewards.round} крошки голосовавшим</Button></div>
      <Button kind="secondary" disabled={busy} onClick={()=>run('admin-round-close')}>закрыть раунд</Button>
    </>}
  </Card>
}

function ProgramEditor({data,busy,run}:{data:DemoState;busy:boolean;run:(action:string,payload?:Record<string,unknown>)=>Promise<any>}){
  const program=data.show?.program
  const [blocks,setBlocks]=useState<any[]>([])
  const [roundsTarget,setRoundsTarget]=useState(7)
  const [rewards,setRewards]=useState({join:1,vote:1,round:2,finale:3})
  useEffect(()=>{if(!program)return;setBlocks(program.blocks.map(b=>({...b})));setRoundsTarget(program.roundsTarget);setRewards({...program.rewards})},[JSON.stringify(program)])
  if(!program)return null
  const move=(index:number,delta:number)=>setBlocks(prev=>{const to=index+delta;if(to<0||to>=prev.length)return prev;const next=[...prev];const item=next.splice(index,1)[0];next.splice(to,0,item);return next.map((x,i)=>({...x,index:i}))})
  const patch=(index:number,p:any)=>setBlocks(prev=>prev.map((x,i)=>i===index?{...x,...p}:x))
  const remove=(index:number)=>setBlocks(prev=>prev.filter((_,i)=>i!==index).map((x,i)=>({...x,index:i})))
  const add=()=>setBlocks(prev=>[...prev,{id:'block_'+Date.now(),type:'cinema_rounds',title:'новый блок',durationMin:10,roundsTarget:1,index:prev.length}])
  return <Card className="program-editor"><div className="section-title">программа вечера. хранится в конфиге</div><p className="muted">порядок и тайминги можно менять без переписывания приложения</p><div className="program-blocks">{blocks.map((b,i)=><div className="program-block" key={b.id}><div className="program-block-order"><button type="button" disabled={i===0} onClick={()=>move(i,-1)}>↑</button><button type="button" disabled={i===blocks.length-1} onClick={()=>move(i,1)}>↓</button></div><input value={b.title} onChange={e=>patch(i,{title:e.target.value})}/><select value={b.type} onChange={e=>patch(i,{type:e.target.value})}><option value="arrival">arrival</option><option value="onboarding">onboarding</option><option value="warm_up">warm_up</option><option value="cinema_rounds">cinema_rounds</option><option value="music_live">music_live</option><option value="final_vote">final_vote</option><option value="finale">finale</option><option value="post_event">post_event</option></select><label>мин<input type="number" min="0" max="240" value={b.durationMin} onChange={e=>patch(i,{durationMin:Number(e.target.value)})}/></label>{b.type==='cinema_rounds'&&<label>раундов<input type="number" min="0" max="20" value={b.roundsTarget} onChange={e=>patch(i,{roundsTarget:Number(e.target.value)})}/></label>}<button type="button" className="text-link" onClick={()=>remove(i)}>удалить</button></div>)}</div><Button kind="secondary" onClick={add}>добавить блок</Button><div className="program-config-grid"><Field label="ориентир фильмов за вечер"><input type="number" min="1" max="20" value={roundsTarget} onChange={e=>setRoundsTarget(Number(e.target.value))}/></Field><Field label="крошки за вход"><input type="number" min="0" max="100" value={rewards.join} onChange={e=>setRewards(v=>({...v,join:Number(e.target.value)}))}/></Field><Field label="крошки за голос"><input type="number" min="0" max="100" value={rewards.vote} onChange={e=>setRewards(v=>({...v,vote:Number(e.target.value)}))}/></Field><Field label="крошки за раунд"><input type="number" min="0" max="100" value={rewards.round} onChange={e=>setRewards(v=>({...v,round:Number(e.target.value)}))}/></Field></div><Button disabled={busy||!blocks.length} onClick={()=>run('admin-program-save',{blocks,roundsTarget,rewards})}>сохранить программу</Button></Card>
}

function MovieCatalogAdmin({data,busy,run}:{data:DemoState;busy:boolean;run:(action:string,payload?:Record<string,unknown>)=>Promise<any>}){
  const catalog=data.movieCatalog||[]
  const empty={movieId:'',title:'',year:'',genre:'',videoId:'',sourceUrl:'',sourcePlatform:'youtube',startSec:0,endSec:'',usageStatus:'needs_review',sourceVerified:false,animalComment:''}
  const [draft,setDraft]=useState<any>(empty)
  const edit=(m:any)=>setDraft({movieId:m.id,title:m.title,year:m.year||'',genre:m.genre||'',videoId:m.videoId||'',sourceUrl:m.sourceUrl||'',sourcePlatform:m.sourcePlatform||'youtube',startSec:m.startSec||0,endSec:m.endSec??'',usageStatus:m.usageStatus||'needs_review',sourceVerified:m.sourceVerified===true,animalComment:m.animalComment||''})
  const save=async()=>{const res=await run('admin-movie-save',draft);if(res)setDraft(empty)}
  const selectedMovie=draft.movieId?catalog.find(m=>m.id===draft.movieId):undefined
  const sources=selectedMovie?.sourceCandidates||[]
  const selectedSource=sources.find(s=>s.selected)||sources.find(s=>s.sourceUrl===selectedMovie?.sourceUrl)
  const sourceLabel=(s:any)=>s.useMode==='fragment'?(s.sourceType==='full_film'?'фрагмент из полного фильма':'фрагмент'):(s.sourceType==='teaser'?'тизер':'трейлер')
  return <Card className="movie-catalog-admin">
    <div className="section-title">каталог видео. preflight</div>
    <p className="muted">животина сначала ищет фрагменты по всем подключённым источникам. трейлеры и тизеры используются только как fallback.</p>
    <div className="movie-preflight-list">{catalog.map(m=>{
      const picked=(m.sourceCandidates||[]).find(s=>s.selected)
      return <button type="button" onClick={()=>edit(m)} key={m.id}>
        <b>{m.title}</b>
        <span>{picked?sourceLabel(picked):m.videoId?'старый источник':'источник не выбран'} · {(m.sourceCandidates||[]).length} найдено</span>
      </button>
    })}</div>
    {selectedMovie&&<div className="movie-source-panel">
      <div className="row spread">
        <div>
          <div className="section-title">источники · {selectedMovie.title}</div>
          <p className="muted">{selectedSource
            ?<>сейчас выбрано: <b>{sourceLabel(selectedSource)}</b> · {selectedSource.sourcePlatform}{selectedSource.manualSelected?' · вручную':' · автоматически'}</>
            :'подходящий источник пока не выбран'}</p>
        </div>
        <Button kind="secondary" disabled={busy} onClick={()=>run('admin-discover-movie-sources',{movieId:selectedMovie.id})}>перепроверить источники</Button>
      </div>
      {sources.length?<div className="movie-source-list">{sources.map(s=>{
        const unavailable=s.availabilityStatus==='dead'||s.availabilityStatus==='blocked'
        const canSelect=!unavailable&&s.verified&&s.embeddable&&s.rightsStatus!=='blocked'
        return <div className={'movie-source-row'+(s.selected?' selected':'')+(unavailable?' unavailable':'')} key={s.id}>
          <div className="movie-source-main">
            <div className="movie-source-title">
              <b>{sourceLabel(s)}</b>
              {s.selected&&<span className="movie-source-selected">выбран</span>}
              {s.manualSelected&&<span className="movie-source-manual">ручной выбор</span>}
              <span>{s.sourcePlatform}</span>
            </div>
            <small>{s.title||s.sourceChannel||s.sourceUrl}</small>
            <div className="movie-source-flags">
              <span>{Math.round(Number(s.confidence||0)*100)}% confidence</span>
              <span>{s.verified?'verified':'не проверен'}</span>
              <span>{s.embeddable?'встраивается':'не встраивается'}</span>
              <span>{s.rightsStatus}</span>
              <span>{s.availabilityStatus}</span>
              {s.official&&<span>official</span>}
            </div>
          </div>
          <div className="movie-source-actions">
            <a href={s.sourceUrl} target="_blank" rel="noreferrer">открыть ↗</a>
            <Button kind="secondary" disabled={busy||!canSelect||s.manualSelected} onClick={()=>run('admin-movie-source-action',{sourceId:s.id,op:'select'})}>{s.manualSelected?'выбран вручную':'выбрать этот'}</Button>
            <Button kind="secondary" disabled={busy||s.availabilityStatus==='dead'} onClick={()=>{if(window.confirm('пометить источник как мёртвый? животина сразу выберет следующий доступный.'))void run('admin-movie-source-action',{sourceId:s.id,op:'dead'})}}>источник умер</Button>
            <Button kind="danger" disabled={busy||s.availabilityStatus==='blocked'} onClick={()=>{if(window.confirm('заблокировать этот источник? он больше не будет участвовать в автоматическом выборе.'))void run('admin-movie-source-action',{sourceId:s.id,op:'block'})}}>заблокировать</Button>
          </div>
        </div>
      })}</div>:<p className="muted movie-source-empty">источников ещё нет. нажмите «перепроверить источники».</p>}
    </div>}
    <div className="movie-editor">
      <Field label="фильм"><input value={draft.title} onChange={e=>setDraft((v:any)=>({...v,title:e.target.value}))} placeholder="название"/></Field>
      <div className="inline"><Field label="год"><input type="number" value={draft.year} onChange={e=>setDraft((v:any)=>({...v,year:e.target.value}))}/></Field><Field label="жанр"><input value={draft.genre} onChange={e=>setDraft((v:any)=>({...v,genre:e.target.value}))}/></Field></div>
      <Field label="youtube video id"><input value={draft.videoId} onChange={e=>setDraft((v:any)=>({...v,videoId:e.target.value}))} placeholder="без полного url"/></Field>
      <Field label="или source url"><input value={draft.sourceUrl} onChange={e=>setDraft((v:any)=>({...v,sourceUrl:e.target.value}))}/></Field>
      <div className="inline"><Field label="start sec"><input type="number" min="0" value={draft.startSec} onChange={e=>setDraft((v:any)=>({...v,startSec:Number(e.target.value)}))}/></Field><Field label="end sec"><input type="number" min="0" value={draft.endSec} onChange={e=>setDraft((v:any)=>({...v,endSec:e.target.value}))}/></Field></div>
      <Field label="статус"><select value={draft.usageStatus} onChange={e=>setDraft((v:any)=>({...v,usageStatus:e.target.value}))}><option value="needs_review">needs_review</option><option value="ready">ready</option><option value="partial">partial</option><option value="no_video">no_video</option><option value="blocked">blocked</option></select></Field>
      <Field label="fallback животины"><textarea value={draft.animalComment} onChange={e=>setDraft((v:any)=>({...v,animalComment:e.target.value}))} placeholder="что сказать, если видео нет"/></Field>
      <label className="toggle-row"><span>источник проверен вручную</span><button type="button" className={draft.sourceVerified?'switch on':'switch'} onClick={()=>setDraft((v:any)=>({...v,sourceVerified:!v.sourceVerified}))}><i/></button></label>
      <Button disabled={busy||!draft.title.trim()} onClick={save}>{draft.movieId?'сохранить фильм':'добавить фильм'}</Button>{draft.movieId&&<Button kind="secondary" onClick={()=>setDraft(empty)}>новый фильм</Button>}
    </div>
  </Card>
}

function FilmPackagePrepAdmin({data,busy,run}:{data:DemoState;busy:boolean;run:(action:string,payload?:Record<string,unknown>)=>Promise<any>}){
  const catalog=(data.movieCatalog||[]).filter(m=>m.enabledForEvent!==false)
  const [movieId,setMovieId]=useState(()=>catalog[0]?.id||'')
  const movie=catalog.find(m=>m.id===movieId)
  const pack=movie?(data.filmPackages||[]).find(x=>x.movieCandidateId===movie.id):undefined
  const selectedSource=(movie?.sourceCandidates||[]).find(s=>s.selected)
  const makeFragments=()=>Array.from({length:6},(_,i)=>({label:i===0?'первый фрагмент':'продолжение '+i,sourcePlatform:'youtube',videoId:'',sourceUrl:'',startSec:0,endSec:'' as any}))
  const makeQuestions=()=>Array.from({length:5},(_,i)=>({prompt:'',options:'',correctAnswer:'',revealText:'',position:i+1}))
  const [fragments,setFragments]=useState<any[]>(makeFragments)
  const [questions,setQuestions]=useState<any[]>(makeQuestions)
  useEffect(()=>{if(!movieId&&catalog[0]?.id)setMovieId(catalog[0].id)},[catalog.length,movieId])
  useEffect(()=>{
    if(pack){
      const fs=makeFragments();(pack.fragments||[]).slice(0,6).forEach((f:any,i:number)=>{fs[i]={...fs[i],...f,endSec:f?.endSec??''}});setFragments(fs)
      const qs=makeQuestions();(pack.questions||[]).forEach((q:any)=>{const i=Math.max(0,Number(q.position)-1);if(i<5)qs[i]={position:i+1,prompt:q.prompt||'',options:Array.isArray(q.options)?q.options.join(', '):'',correctAnswer:answerText(q.correctAnswer),revealText:q.revealText||''}});setQuestions(qs)
    }else{setFragments(makeFragments());setQuestions(makeQuestions())}
  },[pack?.id,movieId])
  if(!catalog.length)return <Card className="film-prep-card"><div className="section-title">пул киноблоков</div><p className="muted">сначала добавьте фильмы в каталог. после этого здесь можно заранее подготовить 6 фрагментов и 5 вопросов для каждого фильма.</p></Card>
  const patchFragment=(i:number,p:any)=>setFragments(v=>v.map((x,n)=>n===i?{...x,...p}:x))
  const applySelectedSource=()=>{if(!selectedSource)return;setFragments(v=>v.map(x=>({...x,sourcePlatform:selectedSource.sourcePlatform,videoId:selectedSource.sourcePlatform==='youtube'?String(selectedSource.videoId||''):'',sourceUrl:String(selectedSource.sourceUrl||'')})))}
  const patchQuestion=(i:number,p:any)=>setQuestions(v=>v.map((x,n)=>n===i?{...x,...p}:x))
  const ready=(data.filmPackages||[]).filter(p=>p.status==='ready').length
  const save=()=>movie&&run('admin-film-package-save',{
    movieCandidateId:movie.id,
    fragments:fragments.map((f,i)=>({label:f.label||('фрагмент '+(i+1)),sourcePlatform:String(f.sourcePlatform||((f.videoId)?'youtube':'')).trim(),videoId:String(f.videoId||'').trim(),sourceUrl:String(f.sourceUrl||'').trim(),startSec:Number(f.startSec)||0,endSec:f.endSec===''?null:Number(f.endSec)||null})),
    questions:questions.map((q,i)=>({prompt:q.prompt,options:String(q.options||'').split(',').map((x:string)=>x.trim()).filter(Boolean),correctAnswer:q.correctAnswer,revealText:q.revealText,revealFragment:{...fragments[i+1],index:i+1}}))
  })
  return <Card className="film-prep-card">
    <div className="row spread"><div><div className="section-title">пул киноблоков до мероприятия</div><h2>готово {ready} из {catalog.length}</h2></div>{pack&&<Pill>{pack.questions.length===5?'5/5 вопросов':'неполный'}</Pill>}</div>
    <Field label="фильм"><select value={movieId} onChange={e=>setMovieId(e.target.value)}>{catalog.map(m=><option value={m.id} key={m.id}>{m.title}{(data.filmPackages||[]).some(p=>p.movieCandidateId===m.id)?' · готовится/готов':''}</option>)}</select></Field>
    {movie&&<details open={!pack}><summary>{pack?'изменить пакет заранее':'подготовить пакет заранее'}</summary>
      <p className="muted">это подготовка до шоу. во время мероприятия останется только нажимать «показать фрагмент», «открыть вопрос» и «выбрать животинку».</p>
      {selectedSource&&<div className="film-source-seed"><span>выбранный источник: {selectedSource.sourcePlatform} · {selectedSource.sourceType}</span><Button kind="secondary" onClick={applySelectedSource}>подставить во все 6 фрагментов</Button></div>}
      <div className="film-fragment-editor">{fragments.map((f,i)=><div className="film-config-row" key={i}><div className="section-title">{i===0?'01. первый фрагмент':'0'+(i+1)+'. reveal после вопроса '+i}</div><div className="inline"><Field label="источник"><select value={f.sourcePlatform||'youtube'} onChange={e=>patchFragment(i,{sourcePlatform:e.target.value,videoId:e.target.value==='youtube'?f.videoId:'',sourceUrl:e.target.value==='youtube'?'':f.sourceUrl})}><option value="youtube">youtube</option><option value="internet_archive">internet archive</option><option value="wikimedia_commons">wikimedia commons</option><option value="direct">direct video</option></select></Field>{(f.sourcePlatform||'youtube')==='youtube'?<Field label="youtube video id"><input value={f.videoId||''} onChange={e=>patchFragment(i,{videoId:e.target.value})}/></Field>:<Field label="прямой video url"><input value={f.sourceUrl||''} onChange={e=>patchFragment(i,{sourceUrl:e.target.value})}/></Field>}</div><div className="inline"><Field label="start sec"><input type="number" min="0" value={f.startSec||0} onChange={e=>patchFragment(i,{startSec:Number(e.target.value)})}/></Field><Field label="end sec"><input type="number" min="0" value={f.endSec??''} onChange={e=>patchFragment(i,{endSec:e.target.value})}/></Field></div></div>)}</div>
      <div className="film-question-editor">{questions.map((q,i)=><div className="film-config-row" key={i}><div className="section-title">вопрос {i+1}/5</div><Field label="что будет дальше?"><textarea value={q.prompt} onChange={e=>patchQuestion(i,{prompt:e.target.value})}/></Field><Field label="варианты через запятую"><input value={q.options} onChange={e=>patchQuestion(i,{options:e.target.value})}/></Field><Field label="правильный вариант"><input value={q.correctAnswer} onChange={e=>patchQuestion(i,{correctAnswer:e.target.value})}/></Field><Field label="что реально произошло"><textarea value={q.revealText} onChange={e=>patchQuestion(i,{revealText:e.target.value})}/></Field></div>)}</div>
      <Button disabled={busy} onClick={save}>{pack?'сохранить пакет':'создать пакет'}</Button>
    </details>}
  </Card>
}

function FilmMechanicAdmin({data,busy,run}:{data:DemoState;busy:boolean;run:(action:string,payload?:Record<string,unknown>)=>Promise<any>}){
  const round=data.show?.currentRound
  const liveMovie=round?.movie
  const catalog=data.movieCatalog||[]
  const [prepMovieId,setPrepMovieId]=useState('')
  useEffect(()=>{
    if(liveMovie?.id){setPrepMovieId(liveMovie.id);return}
    if(!prepMovieId&&catalog.length)setPrepMovieId(catalog[0].id)
  },[liveMovie?.id,catalog.length])
  const movie=catalog.find(x=>x.id===prepMovieId)||liveMovie
  const pack=movie?(data.filmPackages||[]).find(x=>x.movieCandidateId===movie.id):undefined
  const selectedSource=(movie?.sourceCandidates||[]).find(s=>s.selected)
  const liveReady=!!round&&!!liveMovie&&!!movie&&liveMovie.id===movie.id
  const makeFragments=()=>Array.from({length:6},(_,i)=>({label:i===0?'первый фрагмент':'продолжение '+i,sourcePlatform:'youtube',videoId:'',sourceUrl:'',startSec:0,endSec:'' as any}))
  const makeQuestions=()=>Array.from({length:5},(_,i)=>({prompt:'',options:'',correctAnswer:'',revealText:'',position:i+1}))
  const [fragments,setFragments]=useState<any[]>(makeFragments)
  const [questions,setQuestions]=useState<any[]>(makeQuestions)
  useEffect(()=>{
    if(pack){
      const fs=makeFragments();(pack.fragments||[]).slice(0,6).forEach((f:any,i:number)=>{fs[i]={...fs[i],...f,endSec:f?.endSec??''}});setFragments(fs)
      const qs=makeQuestions();(pack.questions||[]).forEach((q:any)=>{const i=Math.max(0,Number(q.position)-1);if(i<5)qs[i]={position:i+1,prompt:q.prompt||'',options:Array.isArray(q.options)?q.options.join(', '):'',correctAnswer:answerText(q.correctAnswer),revealText:q.revealText||''}});setQuestions(qs)
    }else{setFragments(makeFragments());setQuestions(makeQuestions())}
  },[pack?.id,movie?.id])
  if(!catalog.length)return <Card className="film-admin-card"><div className="section-title">киноблок нового формата</div><h2>сначала добавьте фильмы</h2><p className="muted">в production-каталоге пока нет ни одного movie candidate. добавьте фильм ниже в каталоге, затем здесь появится подготовка 6 фрагментов и 5 вопросов.</p></Card>
  if(!movie)return null
  const patchFragment=(i:number,p:any)=>setFragments(v=>v.map((x,n)=>n===i?{...x,...p}:x))
  const applySelectedSource=()=>{if(!selectedSource)return;setFragments(v=>v.map(x=>({...x,sourcePlatform:selectedSource.sourcePlatform,videoId:selectedSource.sourcePlatform==='youtube'?String(selectedSource.videoId||''):'',sourceUrl:String(selectedSource.sourceUrl||'')})))}
  const patchQuestion=(i:number,p:any)=>setQuestions(v=>v.map((x,n)=>n===i?{...x,...p}:x))
  const save=()=>run('admin-film-package-save',{
    movieCandidateId:movie.id,
    fragments:fragments.map((f,i)=>({label:f.label||('фрагмент '+(i+1)),sourcePlatform:String(f.sourcePlatform||((f.videoId)?'youtube':'')).trim(),videoId:String(f.videoId||'').trim(),sourceUrl:String(f.sourceUrl||'').trim(),startSec:Number(f.startSec)||0,endSec:f.endSec===''?null:Number(f.endSec)||null})),
    questions:questions.map((q,i)=>({prompt:q.prompt,options:String(q.options||'').split(',').map((x:string)=>x.trim()).filter(Boolean),correctAnswer:q.correctAnswer,revealText:q.revealText,revealFragment:{...fragments[i+1],index:i+1}}))
  })
  const project=(op:string,extra:Record<string,unknown>={})=>pack&&round&&liveReady&&run('admin-film-projector',{filmPackageId:pack.id,roundId:round.id,op,...extra})
  return <Card className="film-admin-card">
    <div className="row spread"><div><div className="section-title">подготовка киноблоков</div><h2>{movie.title}</h2></div><Pill>{pack?.status==='ready'?'готов к рандому':'не готов'}</Pill></div>
    <Field label="какой фильм готовим"><select value={movie.id} onChange={e=>setPrepMovieId(e.target.value)}>{catalog.map(m=><option value={m.id} key={m.id}>{m.title}{(data.filmPackages||[]).some(p=>p.movieCandidateId===m.id&&p.status==='ready')?' · ready':' · без пакета'}</option>)}</select></Field>
    <p className="muted">готовый пакет = первый фрагмент + 5 продолжений/reveal + ровно 5 проверенных вопросов. только такие фильмы попадают в live-рандом.</p>
    {selectedSource&&<div className="film-source-seed"><span>выбранный источник: {selectedSource.sourcePlatform} · {selectedSource.sourceType}</span><Button kind="secondary" onClick={applySelectedSource}>подставить во все 6 фрагментов</Button></div>}
    <details open={!pack} className="film-package-editor"><summary>{pack?'изменить 6 фрагментов и 5 вопросов':'подготовить 6 фрагментов и 5 вопросов'}</summary>
      <div className="film-fragment-editor">{fragments.map((f,i)=><div className="film-config-row" key={i}><div className="section-title">{i===0?'01. первый фрагмент':'0'+(i+1)+'. reveal после вопроса '+i}</div><div className="inline"><Field label="источник"><select value={f.sourcePlatform||'youtube'} onChange={e=>patchFragment(i,{sourcePlatform:e.target.value,videoId:e.target.value==='youtube'?f.videoId:'',sourceUrl:e.target.value==='youtube'?'':f.sourceUrl})}><option value="youtube">youtube</option><option value="internet_archive">internet archive</option><option value="wikimedia_commons">wikimedia commons</option><option value="direct">direct video</option></select></Field>{(f.sourcePlatform||'youtube')==='youtube'?<Field label="youtube video id"><input value={f.videoId||''} onChange={e=>patchFragment(i,{videoId:e.target.value})}/></Field>:<Field label="прямой video url"><input value={f.sourceUrl||''} onChange={e=>patchFragment(i,{sourceUrl:e.target.value})}/></Field>}</div><div className="inline"><Field label="start sec"><input type="number" min="0" value={f.startSec||0} onChange={e=>patchFragment(i,{startSec:Number(e.target.value)})}/></Field><Field label="end sec"><input type="number" min="0" value={f.endSec??''} onChange={e=>patchFragment(i,{endSec:e.target.value})}/></Field></div></div>)}</div>
      <div className="film-question-editor">{questions.map((q,i)=><div className="film-config-row" key={i}><div className="section-title">вопрос {i+1}/5</div><Field label="что будет дальше?"><textarea value={q.prompt} onChange={e=>patchQuestion(i,{prompt:e.target.value})}/></Field><Field label="варианты через запятую"><input value={q.options} onChange={e=>patchQuestion(i,{options:e.target.value})}/></Field><Field label="правильный вариант"><input value={q.correctAnswer} onChange={e=>patchQuestion(i,{correctAnswer:e.target.value})}/></Field><Field label="что реально произошло"><textarea value={q.revealText} onChange={e=>patchQuestion(i,{revealText:e.target.value})}/></Field></div>)}</div>
      <Button disabled={busy} onClick={save}>{pack?'сохранить киноблок':'создать киноблок'}</Button>
    </details>
    {pack&&liveReady&&<div className="film-live-console">
      <div className="row spread"><div className="section-title">режиссура projector · текущий раунд</div><Pill>{data.projector?.state||'не на экране'}</Pill></div>
      <div className="film-live-step"><b>0. первый фрагмент</b><Button kind="secondary" disabled={busy} onClick={()=>project('film_intro')}>показать первый фрагмент</Button></div>
      <div className="film-live-step"><b>слово зала</b><div className="inline"><Button disabled={busy} onClick={()=>project('one_word_open')}>собирать одно слово</Button><Button kind="secondary" disabled={busy} onClick={()=>project('one_word_results')}>зафиксировать стену слов</Button></div></div>
      {(pack.questions||[]).map(q=><div className="film-live-step" key={q.id}><b>{q.position}/5. {q.prompt}</b><div className="film-control-three"><Button disabled={busy} onClick={()=>project('question_open',{position:q.position})}>открыть вопрос</Button><Button kind="secondary" disabled={busy} onClick={()=>project('question_results',{position:q.position})}>результаты</Button><Button kind="secondary" disabled={busy} onClick={()=>project('question_reveal',{position:q.position})}>правильное + фрагмент</Button></div></div>)}
      <div className="film-live-step assignment-step"><b>после 5/5</b><div className="inline"><Button kind="secondary" disabled={busy} onClick={()=>project('assignment_randomizing')}>запустить рандом на экране</Button><Button disabled={busy} onClick={()=>run('admin-film-assign',{filmPackageId:pack.id,roundId:round.id})}>выбрать животинку</Button></div><p className="muted">выбор делается на сервере один раз. повторное нажатие вернёт того же победителя.</p></div>
    </div>}
    {pack&&!liveReady&&<div className="success">киноблок готов. он появится в live-пульте автоматически, когда этот фильм выпадет в текущем раунде.</div>}
  </Card>
}

function ReviewQueueAdmin({data,busy,run}:{data:DemoState;busy:boolean;run:(action:string,payload?:Record<string,unknown>)=>Promise<any>}){
  const [filter,setFilter]=useState('new')
  const rows=data.reviewQueue||[]
  const filtered=rows.filter(row=>{
    if(filter==='all')return true
    if(filter==='new')return row.reviewStatus==='submitted'
    if(filter==='overdue')return row.assignmentStatus==='overdue'
    return row.reviewStatus===filter
  })
  const action=async(row:any,op:string)=>{
    if(!row.reviewId)return
    if(op==='changes_requested'){
      const comment=window.prompt('что нужно уточнить в рецензии?','')
      if(!comment?.trim())return
      await run('admin-review-action',{reviewId:row.reviewId,op,comment:comment.trim()})
      return
    }
    await run('admin-review-action',{reviewId:row.reviewId,op})
  }
  const copy=async(row:any)=>{const text=String(row.snapshot?.publishText||row.snapshot?.userReview||'');if(!text)return;try{await navigator.clipboard.writeText(text)}catch{window.prompt('скопируйте текст',text)}}
  return <Card className="review-queue-card"><div className="row spread"><div><div className="section-title">рецензии</div><h2>очередь животинок</h2></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="new">новые</option><option value="changes_requested">на доработке</option><option value="approved">одобрено</option><option value="published">опубликовано</option><option value="overdue">просроченные назначения</option><option value="all">все</option></select></div>
    {!filtered.length?<p className="muted">в этом фильтре пока пусто</p>:<div className="review-admin-list">{filtered.map(row=><div className="review-admin-item" key={row.assignmentId}><div className="row spread"><div className="review-admin-title"><img src={import.meta.env.BASE_URL+'assets/rabbit-baby.png'} alt="" draggable={false}/><div><b>{row.animalName} × {row.filmTitle}</b><small>{missionStatusLabel(row.assignmentStatus)}{row.reviewStatus?' · '+row.reviewStatus:''}</small></div></div><Pill>{row.correctCount}/{row.totalQuestions}</Pill></div><div className="review-admin-dates"><span>назначено {eventDate(row.assignedAt)}</span><span>дедлайн {eventDate(row.dueAt)}</span>{row.submittedAt&&<span>отправлено {eventDate(row.submittedAt)}</span>}</div><p className="review-service-line">служебно: {row.user.displayName||'без имени'}{row.user.telegramUsername?' @'+row.user.telegramUsername:''}</p><div className="review-before-after compact"><span><small>до</small>«{row.beforeWord}»</span><span><small>после</small>«{row.afterWord||'—'}»</span></div>{Array.isArray(row.oldPredictions)&&row.oldPredictions.length>0&&<details className="review-predictions"><summary>старые прогнозы · {row.correctCount}/{row.totalQuestions}</summary>{row.oldPredictions.map((p:any)=><div key={p.position}><b>{p.position}. {p.prompt}</b><span>ответ: {answerText(p.answer)} · {p.isCorrect?'угадано':'не угадано'}</span><small>что произошло: {p.revealText||answerText(p.correctAnswer)}</small></div>)}</details>}{row.snapshot&&<><p><b>{row.snapshot.crumbs}/5 крошек</b></p>{Array.isArray(row.snapshot.collectiveWords)&&row.snapshot.collectiveWords.length>0&&<p className="muted">слова зала: {row.snapshot.collectiveWords.map((x:any)=>x.word+' ×'+x.count).join(' · ')}</p>}<p><b>рецензия:</b> {row.snapshot.userReview}</p><p className="muted"><b>животинка:</b> {row.snapshot.animalTake}</p>{row.snapshot.publishText&&<div className="review-publish-copy"><small>готовый текст для публикации</small><p>{row.snapshot.publishText}</p></div>}</>}{row.adminComment&&<div className="review-admin-comment">{row.adminComment}</div>}<div className="review-admin-actions">{row.reviewId&&<Button kind="secondary" disabled={busy} onClick={()=>copy(row)}>скопировать текст</Button>}{row.reviewStatus==='submitted'&&<><Button disabled={busy} onClick={()=>action(row,'approve')}>одобрить</Button><Button kind="danger" disabled={busy} onClick={()=>action(row,'changes_requested')}>вернуть на доработку</Button></>}{['approved','published'].includes(String(row.reviewStatus||''))&&row.reviewId&&<Button kind="secondary" disabled={busy} onClick={()=>run('admin-project-review',{reviewId:row.reviewId})}>показать на projector</Button>}{row.reviewStatus==='approved'&&<Button disabled={busy} onClick={()=>action(row,'publish')}>отметить опубликованной</Button>}</div></div>)}</div>}
  </Card>
}

function Admin(){
  const {slug}=useParams()
  const privileged=usePrivilegedState('admin',slug)
  const data=privileged.data,error=privileged.error,reload=privileged.reload
  const [busy,setBusy]=useState(false),[actionError,setActionError]=useState('')
  const [cap,setCap]=useState(50),[startsAt,setStartsAt]=useState(''),[ticketPrice,setTicketPrice]=useState(0),[runtimeCap,setRuntimeCap]=useState(150),[venueName,setVenueName]=useState(''),[venueAddress,setVenueAddress]=useState(''),[message,setMessage]=useState(''),[checkinLink,setCheckinLink]=useState(''),[projectorLink,setProjectorLink]=useState('')
  useEffect(()=>{if(data){setCap(data.event.capacity);setStartsAt(moscowInputValue(data.event.startsAt));setTicketPrice(Number(data.event.ticketPriceRub||0));setRuntimeCap(Number(data.event.maxMovieRuntimeMin||150));setVenueName(data.event.venueName||'');setVenueAddress(data.event.venueAddress||'')}},[data?.event.capacity,data?.event.startsAt,data?.event.ticketPriceRub,data?.event.maxMovieRuntimeMin,data?.event.venueName,data?.event.venueAddress])
  if(!data)return <Loading error={error}/>
  const run=async(action:string,payload:Record<string,unknown>={})=>{try{setBusy(true);setActionError('');const result=await callAdminApi<any>(action,{slug:data.event.slug,...payload},privileged.token);await reload();return result}catch(e:any){setActionError(e.message||'не получилось выполнить действие');return null}finally{setBusy(false)}}
  return <div className="admin-page">
    <div className="row spread admin-title-row"><div><div className="eyebrow">админка. экран ведущего</div><h2>{data.event.title}</h2></div><Pill>{data.show?showRunStatusLabel(data.show.runtime.runStatus):statusLabel(data.event.status)}</Pill></div>
    {actionError&&<div className="form-error">{actionError}</div>}
    <Card className="projector-access-card"><div className="section-title">общий экран / проектор</div><p className="muted">откройте эту ссылку на ноутбуке, подключённом к проектору, и разверните браузер на весь экран. экран обновляется сам.</p><div className="inline"><Button kind="secondary" disabled={busy} onClick={async()=>{const x:any=await run('admin-screen-link');if(x?.screenUrl)setProjectorLink(String(x.screenUrl))}}>получить ссылку экрана</Button>{projectorLink&&<><Button onClick={()=>window.open(projectorLink,'_blank','noopener,noreferrer')}>открыть экран ↗</Button><Button kind="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(projectorLink)}catch{window.prompt('скопируйте ссылку',projectorLink)}}}>скопировать</Button></>}</div>{projectorLink&&<input className="share-link" readOnly value={projectorLink}/>}</Card>
    <ShowControl data={data} busy={busy} run={run}/>
    <ShowRoundControl data={data} busy={busy} run={run}/>
    <FilmPackagePrepAdmin data={data} busy={busy} run={run}/>
    <FilmMechanicAdmin data={data} busy={busy} run={run}/>
    <AdminParticipants data={data} reload={reload} adminToken={privileged.token}/>
    <ReviewQueueAdmin data={data} busy={busy} run={run}/>
    <ProgramEditor data={data} busy={busy} run={run}/>
    <MovieCatalogAdmin data={data} busy={busy} run={run}/>
    <details className="admin-technical"><summary>технические настройки события</summary><div className="admin-tech-grid">
      <Card><div className="section-title">событие</div><Field label="дата и время. москва"><input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></Field><Field label="цена билета. ₽"><input type="number" min="0" max="100000" value={ticketPrice} onChange={e=>setTicketPrice(Number(e.target.value))}/></Field><Field label="максимальный хронометраж"><input type="number" min="45" max="360" value={runtimeCap} onChange={e=>setRuntimeCap(Number(e.target.value))}/></Field><Field label="площадка"><input value={venueName} onChange={e=>setVenueName(e.target.value)}/></Field><Field label="адрес"><input value={venueAddress} onChange={e=>setVenueAddress(e.target.value)}/></Field><Button disabled={busy||!moscowIso(startsAt)} onClick={()=>run('admin-event-config',{startsAt:moscowIso(startsAt),ticketPriceRub:ticketPrice,maxMovieRuntimeMin:runtimeCap,venueName,venueAddress})}>сохранить событие</Button></Card>
      <Card><div className="section-title">вместимость</div><div className="inline"><input type="number" min="1" max="500" value={cap} onChange={e=>setCap(Number(e.target.value))}/><Button disabled={busy} onClick={()=>run('admin-capacity',{capacity:cap})}>применить</Button></div><p className="muted">сейчас {data.event.capacity} мест</p></Card>
      <Card><div className="section-title">сообщение на проектор</div><textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="например: 10 минут до начала"/><Button disabled={busy} onClick={()=>run('admin-screen-message',{message})}>показать</Button></Card>
      <Card><div className="section-title">чек-ин</div><Button kind="secondary" disabled={busy} onClick={async()=>{const x:any=await run('admin-create-checkin-token');if(x)setCheckinLink(String(x.deepLink||x.token||''))}}>получить ссылку чек-ина</Button>{checkinLink&&<><input className="share-link" readOnly value={checkinLink}/><Button kind="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(checkinLink)}catch{window.prompt('скопируйте ссылку',checkinLink)}}}>скопировать</Button></>}</Card>
      {!demoMode&&<Card><div className="section-title">telegram</div><Button kind="secondary" disabled={busy} onClick={()=>run('admin-configure-telegram')}>обновить webhook + кнопку бота</Button></Card>}
      <Card><div className="section-title">выгрузка</div><div className="inline"><Button kind="secondary" disabled={busy} onClick={async()=>{const x=await run('admin-export-event');if(x)downloadEventExport(x,'csv')}}>csv</Button><Button kind="secondary" disabled={busy} onClick={async()=>{const x=await run('admin-export-event');if(x)downloadEventExport(x,'json')}}>json</Button></div></Card>
    </div></details>
    <details className="admin-legacy"><summary>старый экспериментальный пайплайн</summary><SmartAdmin data={data} reload={reload} adminToken={privileged.token}/></details>
  </div>
}

function AdminParticipants({data,reload,adminToken=''}:{data:DemoState;reload:()=>void;adminToken?:string}){
  const rows=data.adminParticipants||[]
  const [busy,setBusy]=useState('')
  const [message,setMessage]=useState('')
  const confirmed=rows.filter(row=>['paid','attended'].includes(row.status)).length
  const attended=rows.filter(row=>row.status==='attended').length
  const waiting=rows.filter(row=>row.status==='waitlist').length
  const fix=async(row:AdminParticipant,action:'mark_attended'|'undo_attended'|'release_hold'|'cancel_registration')=>{
    const confirmation=action==='cancel_registration'
      ?'сбросить билет у этого участника? место освободится. профиль и животина останутся, а человек сможет получить бесплатный билет заново'
      :action==='release_hold'
        ?'снять резерв у этого участника? место освободится, а следующий человек из листа ожидания может получить резерв автоматически'
        :action==='undo_attended'
          ?'отменить отметку о посещении? подтверждённый билет сохранится'
          :'отметить участника пришедшим?'
    if(!window.confirm(confirmation))return
    try{
      setBusy(row.registrationId+':'+action);setMessage('')
      await callAdminApi('admin-fix-registration',{slug:data.event.slug,registrationId:row.registrationId,fix:action},adminToken)
      await reload()
    }catch(e:any){setMessage(e.message||'не получилось изменить регистрацию')}
    finally{setBusy('')}
  }
  return <Card className="admin-participants-card"><div className="section-title">список участников. {rows.length}</div><div className="admin-participant-summary"><span><b>{confirmed}</b>в списке</span><span><b>{attended}</b>пришли</span><span><b>{waiting}</b>ожидание</span></div><p className="muted">здесь администратор видит регистрации, статусы входа, профиль и согласие на фото/видео</p>{message&&<div className="form-error">{message}</div>}{rows.length?<div className="stack">{rows.map(row=>{const working=busy.startsWith(row.registrationId+':');const expires=row.reservationExpiresAt?new Date(row.reservationExpiresAt):null;const expired=!!expires&&expires.getTime()<=Date.now();return <div className="prediction" key={row.registrationId}><div className="row spread"><div><b>{row.displayName}</b>{row.telegramUsername&&<div className="muted">{row.telegramUsername}</div>}<div className="muted">{row.profileComplete?'профиль заполнен':row.deleted?'профиль удалён':`профиль не закончен. шаг ${row.onboardingStep}/7`}. фото/видео: {row.photoVideoConsent?'да':'нет'}</div></div><Pill>{registrationStatusLabel(row.status)}{row.status==='waitlist'&&row.queuePosition?`. №${row.queuePosition}`:''}</Pill></div>{row.status==='reserved'&&<p className="muted">{expires?(expired?'резерв уже истёк':`резерв до ${expires.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`):'у резерва нет срока истечения'}</p>}<div className="inline">{['paid','no_show'].includes(row.status)&&<Button kind="secondary" disabled={working} onClick={()=>void fix(row,'mark_attended')}>{working?'сохраняем…':'отметить пришёл'}</Button>}{row.status==='attended'&&<Button kind="secondary" disabled={working} onClick={()=>void fix(row,'undo_attended')}>{working?'сохраняем…':'отменить чек-ин'}</Button>}{row.status==='reserved'&&<Button kind="danger" disabled={working} onClick={()=>void fix(row,'release_hold')}>{working?'снимаем…':'сбросить резерв'}</Button>}{!['cancelled','refunded','reserved'].includes(row.status)&&<Button kind="danger" disabled={working} onClick={()=>void fix(row,'cancel_registration')}>{working?'сбрасываем…':'сбросить билет'}</Button>}</div></div>})}</div>:<p className="muted">регистраций пока нет</p>}</Card>
}

function manualNext(s:EventStatus){const m:Partial<Record<EventStatus,{status:EventStatus;label:string;cta:string}>>={DRAFT:{status:'SALES_OPEN',label:'открыть продажи',cta:'открыть продажи'},SALES_OPEN:{status:'CHECKIN',label:'начать сбор гостей',cta:'перейти к сбору'},CHECKIN:{status:'IDEAS_OPEN',label:'открыть приём идей',cta:'открыть идеи'},IDEAS_OPEN:{status:'IDEAS_LOCKED',label:'закрыть приём идей',cta:'закрыть идеи'},PREDICTIONS_OPEN:{status:'PREDICTIONS_LOCKED',label:'закрыть прогнозы',cta:'закрыть прогнозы'},PREDICTIONS_LOCKED:{status:'WATCHING',label:'начать просмотр',cta:'смотрим'},PREDICTIONS_SCORED:{status:'DISCUSSION',label:'открыть реакции',cta:'открыть реакции'},DISCUSSION:{status:'FINAL_REVIEW',label:'перейти к финальной фразе',cta:'финальная рецензия'},FINAL_REVIEW:{status:'FEEDBACK',label:'открыть исследование',cta:'обратная связь'},FEEDBACK:{status:'CLOSED',label:'закрыть вечер',cta:'закрыть событие'}};return m[s]}

function SmartAdmin({data,reload,adminToken=''}:{data:DemoState;reload:()=>void;adminToken?:string}){const [busy,setBusy]=useState('');const [actuals,setActuals]=useState<Record<string,boolean|'void'>>({});const [message,setMessage]=useState('');const run=async(action:string,payload:Record<string,unknown>={})=>{try{setBusy(action);setMessage('');await callAdminApi(action,{slug:data.event.slug,actuals,...payload},adminToken);await reload()}catch(e:any){setMessage(e.message)}finally{setBusy('')}};const s=data.event.status;let action:string|undefined,label:string|undefined;if(s==='IDEAS_LOCKED'){action='ai-select-ideas';label='животина: выбрать топ-3'}else if(s==='TOP3_READY'){action='draw-idea';label='запустить рандом идеи'}else if(['IDEA_RANDOMIZED','MOVIE_SEARCH'].includes(s)){action='ai-find-movies';label='найти и проверить фильмы'}else if(s==='MOVIE_FINALISTS'){action='draw-movie';label='запустить рандом фильма'}if(s==='MOVIE_SELECTED'){const confirmed=data.event.movieAvailabilityStatus==='confirmed';return <Card><div className="section-title">проверка фильма перед фиксацией</div><h3>{data.selectedMovie?.title||'выбранный фильм'}</h3><p className="muted">подтвердите вручную, что у команды реально есть технический способ показать именно этот фильм. права на публичный показ — отдельная проверка</p>{confirmed?<><div className="success">техническая доступность подтверждена</div><Button disabled={!!busy} onClick={()=>run('ai-generate-predictions')}>сгенерировать 10 прогнозов</Button><Button kind="secondary" disabled={!!busy} onClick={()=>run('admin-redraw-movie')}>всё-таки недоступен — выбрать другого</Button></>:<><Button disabled={!!busy} onClick={()=>run('admin-confirm-movie-availability')}>фильм доступен — зафиксировать</Button><Button kind="secondary" disabled={!!busy} onClick={()=>run('admin-redraw-movie')}>не можем показать — выбрать другого</Button></>}{message&&<div className="form-error">{message}</div>}</Card>}if(['WATCHING','PREDICTIONS_LOCKED'].includes(s)&&data.predictions.length){return <Card><div className="section-title">факт-чек прогнозов</div>{data.predictions.map(p=><div className="prediction" key={p.id}><b>{p.position}. {p.text}</b><div className="binary binary-three"><button className={actuals[p.id]===true?'active':''} onClick={()=>setActuals({...actuals,[p.id]:true})}>было</button><button className={actuals[p.id]===false?'active':''} onClick={()=>setActuals({...actuals,[p.id]:false})}>не было</button><button className={actuals[p.id]==='void'?'active':''} onClick={()=>setActuals({...actuals,[p.id]:'void'})}>не считаем</button></div></div>)}<Button disabled={Object.keys(actuals).length!==data.predictions.length||!!busy} onClick={()=>run('admin-score-predictions')}>посчитать победителя</Button></Card>}if(s==='PREDICTIONS_SCORED'){const score:any=data.outputs?.score_summary;const t:any=data.outputs?.tiebreaker;if(!score)return <Card><div className="section-title">результаты</div><p className="muted">нет сохранённого подсчёта</p></Card>;return <Card><div className="section-title">победитель прогнозов</div>{score.winner&&!score.tie?<div className="success">победитель: {score.winner.name}</div>:<><p>ничья между: {(score.winners||[]).map((x:any)=>x.name).join(', ')}</p><Button disabled={!!busy} onClick={()=>run('ai-tiebreaker')}>{t?'сгенерировать ещё убогий пересказ':'животина: сделать тай-брейкер'}</Button>{t?.clue&&<div className="output-json">{t.clue}</div>}{t?.clue&&<div className="stack"><p className="muted">кто первым угадал?</p>{(score.winners||[]).map((w:any)=><Button key={w.userId} kind="secondary" disabled={!!busy} onClick={()=>run('admin-set-winner',{userId:w.userId})}>{w.name}</Button>)}</div>}</>}</Card>}if(s==='CLOSED'){const research:any=data.outputs?.research_summary;return <><Card><div className="section-title">после вечера</div><Button disabled={!!busy} onClick={()=>run('admin-research-summary')}>посчитать исследование</Button><Button kind="secondary" disabled={!!busy} onClick={()=>run('ai-finalize-memory')}>сохранить память животины</Button></Card>{research&&<Card><div className="section-title">результат теста</div><div className="big-copy">{research.returnIntentPositivePct}% хотят вернуться</div><p>NPS: {research.nps??'—'}. средняя готовность платить: {research.averageWillingnessRub??'—'} ₽. ответов: {research.responses}</p></Card>}</>}if(s==='DISCUSSION'){action='ai-post-film-synthesis';label='животина: собрать разбор группы'}else if(s==='FINAL_REVIEW'){action='ai-collective-review';label='собрать черновик общей рецензии'}if(!action)return <Card><div className="section-title">автоматизация</div><p className="muted">на этом этапе отдельное действие животины не требуется</p></Card>;const approvalKey=s==='DISCUSSION'?'post_film_synthesis':s==='FINAL_REVIEW'?'collective_review':'';const generated=approvalKey?data.outputs?.[approvalKey]:undefined;const approved=approvalKey?data.outputApprovals?.[approvalKey]===true:false;return <>{message&&<div className="form-error">{message}</div>}<Card><div className="section-title">автоматизация</div><Button disabled={!!busy||!data.event.nonexistentFilmEnabled} onClick={()=>run(action!)}>{busy?'животина работает…':label}</Button>{!!generated&&<Button kind="secondary" disabled={!!busy||approved} onClick={()=>run('admin-approve-output',{outputKey:approvalKey})}>{approved?'одобрено':'одобрить для экрана / архива'}</Button>}</Card>{data.outputs&&Object.keys(data.outputs).length>0&&<Card><div className="section-title">AI-результаты. только админ</div><pre className="output-json">{JSON.stringify(data.outputs,null,2)}</pre></Card>}</>}

function ShowVoteResults({data}:{data:DemoState}){
  const results=data.show?.voteResults||[]
  const total=results.reduce((sum,x)=>sum+Number(x.count||0),0)||1
  return <div className="screen-results">{results.map((x,i)=><div key={i}><div className="screen-result-label"><span>{answerText(x.answer)}</span><b>{x.count}</b></div><div className="screen-result-bar"><i style={{width:`${Math.round(Number(x.count||0)/total*100)}%`}}/></div></div>)}</div>
}

function DirectVideoPlayer({src,title,startSec=0,endSec}:{src:string;title:string;startSec?:number;endSec?:number}){
  const ref=useRef<HTMLVideoElement|null>(null)
  const initialized=useRef(false)
  const start=Math.max(0,Number(startSec||0))
  const end=endSec&&Number(endSec)>start?Number(endSec):undefined
  useEffect(()=>{initialized.current=false},[src,start])
  const seekAndPlay=()=>{const el=ref.current;if(!el)return;if(!initialized.current){try{el.currentTime=start}catch{}initialized.current=true}void el.play().catch(()=>{})}
  const stopAtEnd=()=>{const el=ref.current;if(!el||!end)return;if(el.currentTime>=end){el.pause();try{el.currentTime=end}catch{}}}
  return <div className="screen-video-wrap"><video ref={ref} title={title} src={src} autoPlay playsInline preload="auto" onLoadedMetadata={seekAndPlay} onCanPlay={seekAndPlay} onTimeUpdate={stopAtEnd}/></div>
}

function ProjectorMedia({media,title}:{media:any;title:string}){
  const start=Math.max(0,Number(media?.startSec||0))
  const end=media?.endSec&&Number(media.endSec)>start?Number(media.endSec):undefined
  const platform=String(media?.sourcePlatform||((media?.videoId)?'youtube':''))
  if(media?.videoId&&(platform==='youtube'||!platform)){
    const qs=new URLSearchParams({autoplay:'1',controls:'0',rel:'0',modestbranding:'1',start:String(start)})
    if(end)qs.set('end',String(end))
    return <div className="screen-video-wrap"><iframe title={title} src={`https://www.youtube.com/embed/${encodeURIComponent(String(media.videoId))}?${qs.toString()}`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/></div>
  }
  if(media?.sourceUrl&&['internet_archive','wikimedia_commons','direct'].includes(platform)){
    return <DirectVideoPlayer src={String(media.sourceUrl)} title={title} startSec={start} endSec={end}/>
  }
  return null
}

function ScreenVideo({data}:{data:DemoState}){
  const movie=data.show?.runtime.currentMovie
  const video:any=data.show?.runtime.videoState||{}
  if(!movie||video.status!=='playing')return null
  return <ProjectorMedia media={movie} title={movie.title}/>
}

function ScreenCreatureWall({data}:{data:DemoState}){
  const creatures=data.screenCreatures||[]
  return <div className="screen-creature-wall">
    <div className="screen-creature-count"><b>{creatures.length}</b><span>{creatures.length===1?'животина уже в зале':'животин уже в зале'}</span></div>
    {creatures.length?<div className="screen-creature-grid">{creatures.map(c=><div className={`screen-creature-card ${c.stage}`} key={c.id}><div className="screen-creature-art"><img src={`${import.meta.env.BASE_URL}assets/rabbit-baby.png`} alt="" draggable={false}/></div><span>{c.name}</span></div>)}</div>:<p className="screen-creature-empty">первая животина появится здесь после чек-ина</p>}
  </div>
}


function ProjectorFragment({fragment,title}:{fragment:any;title:string}){
  if(!fragment?.videoId&&!fragment?.sourceUrl)return <><div className="eyebrow">фрагмент</div><h1>{title}</h1><p>для этого фрагмента пока не указан источник видео</p></>
  const platform=String(fragment?.sourcePlatform||((fragment?.videoId)?'youtube':''))
  const playable=(!!fragment?.videoId&&(platform==='youtube'||!platform))||(!!fragment?.sourceUrl&&['internet_archive','wikimedia_commons','direct'].includes(platform))
  if(!playable)return <><div className="eyebrow">фрагмент</div><h1>{title}</h1><p>этот формат источника пока нельзя показать на проекторе</p></>
  return <ProjectorMedia media={fragment} title={title}/>
}

function ScreenWordWall({groups,collecting=false}:{groups:any[];collecting?:boolean}){
  const max=Math.max(1,...groups.map(x=>Number(x.count||0)))
  return <div className="screen-word-wall">{groups.map((g:any,i:number)=>{
    const scale=.82+(Number(g.count||1)/max)*1.05
    return <div className="screen-word" key={String(g.word)+'-'+i} style={{fontSize:'calc(clamp(28px,4.7vw,76px) * '+scale+')'}}><b>{String(g.word)}</b>{Number(g.count||0)>1&&<span>×{g.count}</span>}{Array.isArray(g.animals)&&g.animals.length>0&&<small>{g.animals.slice(0,6).join(' · ')}</small>}</div>
  })}{!groups.length&&<div className="screen-word-empty">{collecting?'слова появятся здесь вживую':'зал пока молчит'}</div>}</div>
}

function ProjectorAnswerBars({results}:{results:any[]}){
  const total=results.reduce((sum,x)=>sum+Number(x.count||0),0)||1
  return <div className="screen-results">{results.map((x:any,i:number)=><div key={i}><div className="screen-result-label"><span>{answerText(x.answer)}</span><b>{x.count}</b></div><div className="screen-result-bar"><i style={{width:Math.round(Number(x.count||0)/total*100)+'%'}}/></div></div>)}</div>
}

function projectorContent(d:DemoState){
  const p=d.projector
  if(!p||['idle','arrival'].includes(p.state))return null
  const payload:any=p.payload||{}
  if(p.state==='film_intro')return <ProjectorFragment fragment={payload.fragment} title={String(payload.filmTitle||'фильм')}/>
  if(p.state==='one_word_collecting')return <><div className="eyebrow">первое впечатление</div><h1>одно слово.<br/>что это за фильм?</h1><ScreenWordWall groups={Array.isArray(payload.wordGroups)?payload.wordGroups:[]} collecting/></>
  if(p.state==='one_word_results')return <><div className="eyebrow">зал до полного просмотра</div><h1>вот что вы увидели</h1><ScreenWordWall groups={Array.isArray(payload.wordGroups)?payload.wordGroups:[]}/></>
  if(p.state==='question_open')return <><div className="eyebrow">что будет дальше · {Number(payload.position||0)}/5</div><h1>{String(payload.prompt||'что будет дальше?')}</h1><div className="screen-question-options">{(Array.isArray(payload.options)?payload.options:[]).map((x:any,i:number)=><span key={i}>{answerText(x)}</span>)}</div><p>ответьте в телефоне</p></>
  if(p.state==='question_results')return <><div className="eyebrow">как решил зал · {Number(payload.position||0)}/5</div><h1>{String(payload.prompt||'результаты')}</h1><ProjectorAnswerBars results={Array.isArray(payload.results)?payload.results:[]}/></>
  if(p.state==='question_reveal'){
    const fragment=payload.revealFragment
    if(fragment?.videoId||fragment?.sourceUrl)return <><ProjectorFragment fragment={fragment} title={String(payload.filmTitle||'продолжение')}/><div className="screen-reveal-overlay"><small>правильный ответ</small><b>{answerText(payload.correctAnswer)}</b>{payload.revealText&&<span>{String(payload.revealText)}</span>}</div></>
    return <><div className="eyebrow">правильный ответ · {Number(payload.position||0)}/5</div><h1>{answerText(payload.correctAnswer)}</h1>{payload.revealText&&<p>{String(payload.revealText)}</p>}</>
  }
  if(p.state==='assignment_randomizing')return <div className="screen-assignment-random"><div className="eyebrow">этот фильм кто-то унесёт с собой</div><h1>кому он достанется?</h1><div className="random-rabbits">{[0,1,2,3,4,5,6].map(i=><img key={i} src={import.meta.env.BASE_URL+'assets/rabbit-baby.png'} alt="" draggable={false}/>)}</div></div>
  if(p.state==='assignment_winner')return <div className="screen-assignment-winner"><div className="winner-rabbit"><img src={import.meta.env.BASE_URL+'assets/rabbit-baby.png'} alt="" draggable={false}/></div><div className="eyebrow">этот фильм твой</div><h1>{String(payload.animalName||'животина')}.</h1><h2>{String(payload.filmTitle||'фильм')}</h2><p>досмотри его за 7 дней. потом я спрошу.</p>{payload.dueAt&&<div className="winner-deadline">до {eventDate(String(payload.dueAt))}</div>}</div>
  if(p.state==='past_review_card')return <div className="screen-past-review"><div className="eyebrow">в прошлый раз</div><h1>{String(payload.animalName||'животина')} × {String(payload.filmTitle||'фильм')}</h1><div className="review-before-after"><span><small>до</small>«{String(payload.beforeWord||'')}»</span><span><small>после</small>«{String(payload.afterWord||'')}»</span></div><p>{String(payload.crumbs||'—')}/5 крошек</p>{payload.animalTake&&<h3>{String(payload.animalTake)}</h3>}</div>
  return null
}

function screenContent(d:DemoState){
  const projected=projectorContent(d)
  if(projected)return projected
  const show=d.show
  if(show&&show.runtime.currentBlock?.type==='arrival'&&!['paused','finished'].includes(show.runtime.runStatus))return <><div className="eyebrow">сбор гостей</div><h1>животины заходят в зал</h1><ScreenCreatureWall data={d}/></>
  if(show&&show.runtime.runStatus!=='idle'){
    const block=show.runtime.currentBlock
    const round=show.currentRound
    if(show.runtime.runStatus==='paused')return <><div className="eyebrow">пауза</div><h1>никуда не уходим</h1><p>ведущий сейчас продолжит</p></>
    if(block?.type==='music_live')return <><div className="eyebrow">живой блок</div><h1>{block.title}</h1><p>живой звук. животина временно молчит</p></>
    if(show.runtime.videoState?.status==='playing'&&(show.runtime.currentMovie?.videoId||show.runtime.currentMovie?.sourceUrl))return <><ScreenVideo data={d}/></>
    if(round?.resultsVisible&&show.voteResults.length)return <><div className="eyebrow">как проголосовал зал</div><h1>{round.question?.prompt||'результаты'}</h1><ShowVoteResults data={d}/></>
    if(round?.question&&round.voteState==='open')return <><div className="eyebrow">раунд {round.roundNo}</div><h1>{round.question.prompt}</h1><p>голосование открыто. отвечайте в телефоне</p></>
    if(round?.movie){
      const noVideo=round.movie.usageStatus==='no_video'||(!round.movie.videoId&&!round.movie.sourceUrl)
      return <><div className="eyebrow">раунд {round.roundNo}</div><h1>{round.movie.title}</h1>{round.movie.year&&<p>{round.movie.year}{round.movie.genre?`. ${round.movie.genre}`:''}</p>}{noVideo&&<p>{round.movie.animalComment||'видео нет. животина всё равно нашла, что с этим делать'}</p>}</>
    }
    if(block?.type==='arrival')return <><div className="eyebrow">сбор гостей</div><h1>заходите</h1><p>{d.event.sold}/{d.event.capacity} в списке. {show.onlineCount} сейчас в приложении</p></>
    if(block?.type==='onboarding')return <><div className="eyebrow">животина</div><h1>сначала познакомимся</h1><p>телефоны можно достать</p></>
    if(block?.type==='warm_up')return <><div className="eyebrow">разогрев</div><h1>{block.title}</h1><p>первый общий интерактив появится на телефонах</p></>
    if(block?.type==='cinema_rounds')return <><div className="eyebrow">кино</div><h1>{block.title}</h1><p>следующий раунд готовится</p></>
    if(block?.type==='final_vote')return <><div className="eyebrow">финал</div><h1>выбираем фильм вечера</h1><p>последний голос сегодня</p></>
    if(block?.type==='finale')return <><div className="eyebrow">итог</div><h1>ну всё</h1><p>сейчас животина соберёт вечер в одну историю</p></>
    if(block?.type==='post_event'||show.runtime.runStatus==='finished')return <><h1>вечер закончился</h1><p>животина уходит домой вместе с вами</p></>
    return <><h1>{block?.title||'шоу идёт'}</h1></>
  }
  const state=d.event.status
  if(['DRAFT','SALES_OPEN','CHECKIN'].includes(state))return <><h1>скоро начнём</h1><p>{d.event.sold}/{d.event.capacity} в списке</p></>
  return <><h1>{statusLabel(state)}</h1><p>следите за телефоном</p></>
}

function showTimerText(data:DemoState,now:number){
  const block=data.show?.runtime.currentBlock
  const runtime=data.show?.runtime
  if(!block||!runtime?.blockStartedAt||!block.durationMin)return ''
  const endBase=runtime.runStatus==='paused'&&runtime.pausedAt?new Date(runtime.pausedAt).getTime():now
  const elapsed=Math.max(0,Math.floor((endBase-new Date(runtime.blockStartedAt).getTime())/1000))
  const left=Math.max(0,block.durationMin*60-elapsed)
  return `${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`
}

function projectorStateLabel(state:string){const m:Record<string,string>={film_intro:'фрагмент',one_word_collecting:'одно слово',one_word_results:'слова зала',question_open:'вопрос открыт',question_results:'результаты',question_reveal:'продолжение',assignment_randomizing:'рандом',assignment_winner:'фильм назначен',past_review_card:'из архива'};return m[state]||state}
function Screen(){const {slug}=useParams();const {data,error}=usePrivilegedState('screen',slug);const [now,setNow]=useState(()=>Date.now());useEffect(()=>{const t=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(t)},[]);if(!data)return <Loading error={error}/>;const content=screenContent(data);const timer=showTimerText(data,now);const status=data.projector&&!['idle','arrival'].includes(data.projector.state)?projectorStateLabel(data.projector.state):data.show?.runtime.currentBlock?.type==='arrival'?'сбор гостей':data.show?.runtime.runStatus!=='idle'?data.show?.runtime.currentBlock?.title:statusLabel(data.event.status);return <div className="screen-page"><div className="screen-brand">насыпатели в кино</div><div className="screen-status">{status}{timer&&<b>{timer}</b>}</div>{data.screenMessage&&<div className="screen-message">{data.screenMessage}</div>}<div className="screen-content">{content}</div><div className="screen-footer">{eventDate(data.event.startsAt)}. насыпатели в кино</div></div>}

function statusLabel(s:EventStatus){const m:Record<EventStatus,string>={DRAFT:'черновик',SALES_OPEN:'регистрация открыта',CHECKIN:'сбор гостей',IDEAS_OPEN:'идеи открыты',IDEAS_LOCKED:'идеи закрыты',TOP3_READY:'три идеи',IDEA_RANDOMIZED:'идея выбрана',MOVIE_SEARCH:'поиск фильма',MOVIE_FINALISTS:'три фильма',MOVIE_SELECTED:'фильм выбран',PREDICTIONS_OPEN:'прогнозы',PREDICTIONS_LOCKED:'прогнозы закрыты',WATCHING:'просмотр',PREDICTIONS_SCORED:'результаты',DISCUSSION:'реакции',FINAL_REVIEW:'финальная фраза',FEEDBACK:'исследование',CLOSED:'закрыто'};return m[s]}

export default function App(){return <HashRouter><Routes><Route path="/onboarding" element={<Onboarding/>}/><Route path="/birth" element={<BirthPage/>}/><Route path="/rules" element={<RulesPage/>}/><Route element={<Layout/>}><Route path="/" element={<RequireProfile><Home/></RequireProfile>}/><Route path="/profile" element={<RequireProfile><CreatureProfilePage/></RequireProfile>}/><Route path="/mission/:assignmentId" element={<RequireProfile><FilmMissionPage/></RequireProfile>}/><Route path="/dating" element={<RequireProfile><DatingPage/></RequireProfile>}/><Route path="/notifications" element={<RequireProfile><NotificationPage/></RequireProfile>}/><Route path="/event/:slug" element={<RequireProfile><EventPage/></RequireProfile>}/><Route path="/archive" element={<RequireProfile><ArchivePage/></RequireProfile>}/><Route path="/club" element={<Navigate to="/archive" replace/>}/><Route path="/zhivotina" element={<RequireProfile><ZhivotinaPage/></RequireProfile>}/><Route path="/jipitina" element={<Navigate to="/zhivotina" replace/>}/></Route><Route path="/admin/:slug" element={<Admin/>}/><Route path="/admin/event/:slug" element={<Admin/>}/><Route path="/screen/:slug" element={<Screen/>}/><Route path="/screen/event/:slug" element={<Screen/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></HashRouter>}
