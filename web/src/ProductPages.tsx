import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Empty, Field, Pill } from './components/UI'
import { Rabbit } from './components/Rabbit'
import { callApi } from './lib/api'
import { haptic, hapticSuccess, requestTelegramWriteAccess } from './lib/telegram'
import type { DatingIntent, DemoState, NotificationPrefs } from './types'

function useBootstrap(){
  const [data,setData]=useState<DemoState|null>(null);const [error,setError]=useState('')
  const reload=()=>callApi<DemoState>('bootstrap').then(x=>{setData(x);setError('')}).catch(e=>setError(e.message))
  useEffect(()=>{reload()},[])
  return {data,error,reload}
}
function Load({error}:{error?:string}){return <div className="page"><Card>{error?`ошибка: ${error}`:'загрузка…'}</Card></div>}
function cleanDate(iso:string){try{return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/Moscow'}).format(new Date(iso))}catch{return iso}}
async function copyText(value:string){try{await navigator.clipboard.writeText(value);return true}catch{window.prompt('скопируйте ссылку',value);return false}}
export function BirthPage(){
  const {data,error}=useBootstrap()
  const nav=useNavigate()
  const [name,setName]=useState(()=>{try{return localStorage.getItem('nasypateli-pending-creature-name')||''}catch{return ''}})
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')

  useEffect(()=>{if(data?.creature?.born)nav('/',{replace:true})},[data?.creature?.born,nav])
  if(!data)return <Load error={error}/>

  const finish=async()=>{
    const clean=name.trim().replace(/\s+/g,' ').slice(0,32)
    if(clean.length<2){setMessage('дайте Животине имя хотя бы из двух символов');return}
    try{
      setBusy(true);setMessage('')
      await callApi('birth-creature',{name:clean})
      try{localStorage.removeItem('nasypateli-pending-creature-name')}catch{}
      hapticSuccess()
      nav('/',{replace:true})
    }catch(e:any){setMessage(e.message||'не получилось сохранить имя. попробуйте ещё раз')}
    finally{setBusy(false)}
  }

  return <div className="birth-simple-page">
    <div className="birth-simple-art">
      <img src={`${import.meta.env.BASE_URL}assets/rabbit-idle.webp`} alt="Животина" draggable={false}/>
    </div>
    <div className="birth-simple-copy">
      <div className="eyebrow">ваша Животина</div>
      <h1>как её<br/>назовём?</h1>
      <p>имя останется с ней в приложении и будет стоять над вашим личным чатом с Животиной.</p>
      <Field label="имя Животины">
        <input
          autoFocus
          maxLength={32}
          value={name}
          placeholder="например, Кишка"
          onChange={e=>{setName(e.target.value);setMessage('');try{localStorage.setItem('nasypateli-pending-creature-name',e.target.value)}catch{}}}
          onKeyDown={e=>{if(e.key==='Enter')void finish()}}
        />
      </Field>
      <Button disabled={busy||name.trim().length<2} onClick={()=>void finish()}>{busy?'сохраняем…':'это её имя'}</Button>
      {message&&<div className="form-error">{message}</div>}
      <p className="muted birth-simple-note">рост, новые образы и кастомизация появятся позже. сейчас Животина уже умеет разговаривать с вами и помнить ваш кинопрофиль.</p>
    </div>
  </div>
}

export function CreatureProfilePage(){
  const {data,error}=useBootstrap()
  const nav=useNavigate()
  const [busy,setBusy]=useState('')
  const [msg,setMsg]=useState('')
  if(!data)return <Load error={error}/>
  const creatureName=(data.creature.name||'Животина').trim()||'Животина'

  const remove=async()=>{
    if(!window.confirm('Удалить кинопрофиль, Животину, знакомства и персональную историю? Это действие нельзя отменить.'))return
    if(!window.confirm('Точно удалить профиль? Билеты и платёжные записи останутся у организаторов, персонализация будет удалена.'))return
    try{setBusy('delete');await callApi('delete-profile',{confirm:'DELETE_PROFILE'});location.hash='#/onboarding'}
    catch(e:any){setMsg(e.message)}
    finally{setBusy('')}
  }

  return <div className="page creature-page creature-static-page">
    <section className="creature-static-hero">
      <div className="eyebrow">ваша Животина</div>
      <div className="creature-static-art"><img src={`${import.meta.env.BASE_URL}assets/rabbit-idle.webp`} alt={creatureName} draggable={false}/></div>
      <h1>{creatureName}</h1>
      <p>ваш личный персонаж внутри НАСЫПАТЕЛЕЙ В КИНО. {creatureName} знает ваш кинопрофиль и может обсуждать с вами фильмы, вкус и происходящее в клубе.</p>
      <Button onClick={()=>nav('/zhivotina')}>поговорить с {creatureName}</Button>
    </section>

    <Card className="creature-coming-soon">
      <div className="eyebrow">скоро</div>
      <h2>кастомизация скоро</h2>
      <p>кастомизация Животины появится в следующих версиях. сможете менять образ, добавлять детали и открывать новые вещи после событий.</p>
      <div className="soon-grid">
        <span>новые образы</span>
        <span>аксессуары</span>
        <span>детали внешности</span>
      </div>
    </Card>

    {data.creature.timeline?.length>0&&<Card>
      <div className="section-title">история · {creatureName}</div>
      <div className="timeline">{data.creature.timeline.slice(0,6).map(x=><div key={x.id}><time>{cleanDate(x.happenedAt)}</time><b>{x.secret?'???':x.title}</b><p>{x.secret?'секретная история уже произошла. смысл откроется позже':x.description}</p></div>)}</div>
    </Card>}

    <Card>
      <div className="section-title">настройки</div>
      <Button kind="secondary" onClick={()=>nav('/onboarding?edit=1')}>изменить кинопрофиль</Button>
      <Button kind="secondary" onClick={()=>nav('/notifications')}>уведомления</Button>
      <Button kind="secondary" onClick={()=>nav('/rules')}>правила НАСЫПАТЕЛЕЙ В КИНО</Button>
    </Card>

    <Card className="danger-zone">
      <div className="section-title">удаление</div>
      <p className="muted">удалит кинопрофиль, Животину, знакомства и персональную историю. платёжные записи и минимальные данные о купленных билетах не удаляются автоматически</p>
      <Button kind="danger" disabled={busy==='delete'} onClick={remove}>удалить профиль</Button>
      {msg&&<div className="form-error">{msg}</div>}
    </Card>
  </div>
}

const intentOptions:[DatingIntent,string][]=[['friends','дружба'],['cinema_company','компания в кино'],['chat','общение'],['dates','свидания'],['anything','всё']]
const matchKindLabels:Record<string,string>={friend:'дружба',cinema:'компания в кино',romantic:'свидание'}
export function DatingPage(){
  const {data,error,reload}=useBootstrap();const [busy,setBusy]=useState('');const [msg,setMsg]=useState('');const [setup,setSetup]=useState(false);const [match,setMatch]=useState<{name:string;creature:string;kind:string}|null>(null);const [swipeMotion,setSwipeMotion]=useState<'pass'|'like'|''>('');if(!data)return <Load error={error}/>;const d=data.dating
  const save=async(patch:Record<string,unknown>)=>{try{setBusy('save');setMsg('');await callApi('save-dating-profile',{dating:{...d,...patch}});await reload()}catch(e:any){setMsg(e.message)}finally{setBusy('')}}
  const swipe=async(userId:string,direction:'like'|'pass')=>{try{setBusy(userId);setSwipeMotion(direction);haptic(direction==='like'?'medium':'light');await new Promise(resolve=>window.setTimeout(resolve,220));const r:any=await callApi('dating-swipe',{targetUserId:userId,direction});if(r?.matched){hapticSuccess();setMatch({name:card?.displayName||'человек',creature:card?.creatureName||'Животина',kind:r.kind||'friend'});window.setTimeout(()=>setMatch(null),3200)}await reload()}catch(e:any){setMsg(e.message)}finally{setSwipeMotion('');setBusy('')}}
  const hideConnection=async(connectionId:string)=>{try{setBusy(`hide:${connectionId}`);setMsg('');await callApi('dating-hide-connection',{connectionId});await reload()}catch(e:any){setMsg(e.message||'не получилось скрыть связь')}finally{setBusy('')}}
  if(!d.enabled||setup)return <div className="page dating-page"><div className="eyebrow">знакомства · 18+</div><h1>сначала<br/>решите, кого<br/>сюда пускать</h1><p className="muted">знакомства полностью добровольные. ваш возраст не показывается. до мэтча люди видят Животину, имя и кино-профиль</p><Card><div className="section-title">я</div><div className="chips"><button className={d.selfGender==='woman'?'active':''} onClick={()=>save({selfGender:'woman'})}>женщина</button><button className={d.selfGender==='man'?'active':''} onClick={()=>save({selfGender:'man'})}>мужчина</button></div><div className="section-title">хочу видеть</div><div className="chips"><button className={d.showGender==='women'?'active':''} onClick={()=>save({showGender:'women'})}>женщин</button><button className={d.showGender==='men'?'active':''} onClick={()=>save({showGender:'men'})}>мужчин</button><button className={d.showGender==='all'?'active':''} onClick={()=>save({showGender:'all'})}>всех</button></div><div className="section-title">что ищу</div><div className="chips">{intentOptions.map(([id,label])=><button key={id} className={d.intents.includes(id)?'active':''} onClick={()=>save({intents:d.intents.includes(id)?d.intents.filter(x=>x!==id):[...d.intents,id]})}>{label}</button>)}</div><Button disabled={busy==='save'||!d.selfGender||!d.showGender||!d.intents.length} onClick={()=>save({enabled:true,paused:false})}>включить знакомства</Button>{d.enabled&&<Button kind="secondary" onClick={()=>setSetup(false)}>назад</Button>}{msg&&<div className="form-error">{msg}</div>}</Card></div>
  const card=data.datingCards?.[0]
  return <div className="page dating-page">{match&&<div className="match-overlay"><div className="match-rabbits"><Rabbit creature={data.creature}/><Rabbit creature={{...data.creature,name:match.creature,cosmetics:[]}}/></div><div className="eyebrow">{match.kind==='romantic'?'мэтч':'зайцы нашли друг друга'}</div><h2>{data.creature.name} + {match.creature}</h2><p>{match.name} тоже выбрал(а) вас</p></div>}<div className="row spread"><div><div className="eyebrow">знакомства</div><h2>зайцы рядом</h2></div><button className="tiny-link" onClick={()=>setSetup(true)}>настроить</button></div>{d.paused?<Card><h3>знакомства на паузе</h3><Button onClick={()=>save({paused:false})}>вернуться</Button></Card>:card?<div className={`dating-card ${swipeMotion?`swipe-${swipeMotion}`:''}`}><div className="dating-rabbit"><Rabbit creature={{...data.creature,name:card.creatureName,stage:card.creatureStage,cosmetics:[],timeline:[],storyCount:0,crumbs:0,growthProgress:0,born:true,traits:data.creature.traits}}/></div><div className="dating-info"><div className="eyebrow">{card.creatureName}</div><h1>{card.displayName}</h1><p className="match-note">{card.matchNote}</p><div className="film-tags">{card.favoriteFilms.slice(0,4).map(x=><span key={x}>{x}</span>)}</div></div><div className="swipe-actions"><button disabled={busy===card.userId} onClick={()=>swipe(card.userId,'pass')}>×</button><button className="like" disabled={busy===card.userId} onClick={()=>swipe(card.userId,'like')}>♥</button></div></div>:<Card><div className="big-copy">пока всё</div><p className="muted">Животина не будет показывать людей просто ради бесконечной ленты. новые карточки появятся, когда найдутся подходящие участники</p></Card>}
    <Card><div className="section-title">животина-сваха</div><p>можно написать Животине «найди мне кого-нибудь на хоррор» или «с кем из клуба мне сходить в кино». только по такой просьбе она увидит до 6 уже доступных вам карточек и поможет выбрать, кого посмотреть здесь. мэтч всё равно происходит только после взаимного свайпа</p></Card>
    <Card><div className="section-title">ваши связи</div>{data.datingMatches?.length?data.datingMatches.map(m=><div className="match-row" key={m.id}><div><b>{m.creatureName}</b><span>{m.displayName} · {matchKindLabels[m.kind]||m.kind}</span></div><button disabled={busy===`hide:${m.id}`} onClick={()=>void hideConnection(m.id)}>{busy===`hide:${m.id}`?'скрываем…':'скрыть'}</button></div>):<Empty>ваши зайцы ещё ни с кем не подружились</Empty>}</Card>
    <Button kind="secondary" onClick={()=>save({paused:true})}>поставить знакомства на паузу</Button>{msg&&<div className="form-error">{msg}</div>}
  </div>
}

export function ArchivePage(){const {data,error}=useBootstrap();if(!data)return <Load error={error}/>;const creatureName=data.creature.name||'Животина';return <div className="page"><div className="eyebrow">архив</div><h1 className="page-title">что с вами<br/>уже случилось</h1><Card><div className="section-title">вечера</div>{data.pastEvents.length?data.pastEvents.map(ev=><div className="archive-event-block" key={ev.id}><div className="archive-event"><small>{cleanDate(ev.startsAt)}</small><b>{ev.movie?.title||ev.title}</b>{ev.review&&<span>есть рецензия</span>}</div>{ev.review&&<details className="archive-review"><summary>открыть коллективную рецензию</summary>{typeof ev.review.averageRating==='number'&&<strong>{ev.review.averageRating.toFixed(1)} / 10</strong>}{ev.review.intro&&<p>{ev.review.intro}</p>}{Array.isArray(ev.review.sentences)&&ev.review.sentences.length>0&&<div className="archive-review-sentences">{ev.review.sentences.map((sentence,i)=><blockquote key={i}>{sentence}</blockquote>)}</div>}{ev.review.caption&&<p className="muted">{ev.review.caption}</p>}</details>}</div>):<Empty>первый вечер ещё впереди</Empty>}</Card><Card><div className="section-title">история · {creatureName}</div>{data.creature.timeline?.length?<div className="timeline">{data.creature.timeline.map(x=><div key={x.id}><time>{cleanDate(x.happenedAt)}</time><b>{x.secret?'???':x.title}</b><p>{x.secret?'секретная история':x.description}</p></div>)}</div>:<Empty>пока пусто</Empty>}</Card></div>}

export function NotificationPage(){const {data,error,reload}=useBootstrap();const [busy,setBusy]=useState(false);const [msg,setMsg]=useState('');if(!data)return <Load error={error}/>;const p=data.notificationPrefs;const creatureName=data.creature.name||'Животина';const save=async(next:NotificationPrefs)=>{try{setBusy(true);setMsg('');await callApi('save-notification-prefs',{prefs:next});await reload();return true}catch(e:any){setMsg(e.message||'не получилось сохранить настройки');return false}finally{setBusy(false)}};const toggle=(k:keyof NotificationPrefs)=>{if(k==='writeAccess')return;void save({...p,[k]:!p[k]})};const request=async()=>{try{const ok=await requestTelegramWriteAccess();const saved=await save({...p,writeAccess:ok});if(saved)setMsg(ok?'готово. бот может писать вам':'Telegram не дал разрешение. его можно запросить ещё раз позже')}catch(e:any){setMsg(e.message||'не получилось запросить разрешение Telegram')}};return <div className="page"><div className="eyebrow">настройки</div><h1 className="page-title">уведомления</h1><Card>{!p.writeAccess&&<><p>сначала Telegram должен разрешить боту писать вам первым</p><Button onClick={request}>разрешить сообщения от бота</Button></>}{(['events','creature','stories','matches','tickets','reminders','quietHours'] as const).map(k=><button key={k} className="setting-row" disabled={busy} onClick={()=>toggle(k)}><span>{({events:'новые события',creature:`сообщения · ${creatureName}`,stories:'новые истории',matches:'мэтчи и знакомства',tickets:'билеты и оплата',reminders:'напоминания перед событиями',quietHours:'не беспокоить ночью'} as any)[k]}</span><i className={p[k]?'on':''}/></button>)}{msg&&<div className="form-error">{msg}</div>}</Card><p className="muted">{creatureName}: только события клуба, новые истории, кино и знакомства. никаких «я голодная, вернись».</p></div>}

export function RulesPage(){const nav=useNavigate();return <div className="page legal-page"><button type="button" className="text-link legal-back" onClick={()=>history.length>1?nav(-1):nav('/')}>← назад</button><div className="eyebrow">НАСЫПАТЕЛИ В КИНО</div><h1 className="page-title">правила</h1><Card><p>клуб и все социальные механики — 18+</p><p>не будьте мудаками друг с другом</p><p>чужие границы важнее игровой механики. если человек не хочет знакомиться, сниматься, отвечать на вопрос или участвовать в какой-то части вечера — этого достаточно</p><p>не публикуйте чужие личные ответы, переписки и фотографии без разрешения</p><p>не мешайте другим смотреть фильм и участвовать в вечере</p><p>игровые механики могут открываться и закрываться организаторами прямо во время события — это часть формата</p><p>анонимные ответы и идеи остаются анонимными до момента, когда формат прямо предусматривает раскрытие</p><p>если поведение участника мешает другим или делает происходящее небезопасным, организаторы могут остановить его участие</p></Card></div>}
