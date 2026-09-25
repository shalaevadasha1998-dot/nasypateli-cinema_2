import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, Empty, Field, Pill } from './components/UI'
import { CreatureCard, Rabbit, type CreatureAnimationState } from './components/Rabbit'
import { callApi } from './lib/api'
import { CREATURE_VISUAL_LEVELS, creatureVisualLabel, creatureVisualLevel, growthProgressForVisualLevel } from './lib/creature'
import { haptic, hapticSuccess, requestTelegramWriteAccess, telegramWebApp } from './lib/telegram'
import type { CreatureState, DatingIntent, DemoState, NotificationPrefs } from './types'

function useBootstrap(){
  const [data,setData]=useState<DemoState|null>(null);const [error,setError]=useState('')
  const reload=()=>callApi<DemoState>('bootstrap').then(x=>{setData(x);setError('')}).catch(e=>setError(e.message))
  useEffect(()=>{reload()},[])
  return {data,error,reload}
}
function Load({error}:{error?:string}){return <div className="page"><Card>{error?`ошибка: ${error}`:'загрузка…'}</Card></div>}
function cleanDate(iso:string){try{return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(iso))}catch{return iso}}
async function copyText(value:string){try{await navigator.clipboard.writeText(value);return true}catch{window.prompt('скопируйте ссылку',value);return false}}
function creatureGrowthView(creature:CreatureState){
  const level=creatureVisualLevel(creature)
  const maxed=level>=CREATURE_VISUAL_LEVELS
  const bandEnd=Math.min(CREATURE_VISUAL_LEVELS,Math.ceil(level/10)*10)
  const nextBandEnd=level%10===0&&!maxed?Math.min(CREATURE_VISUAL_LEVELS,bandEnd+10):bandEnd
  const milestone=maxed?CREATURE_VISUAL_LEVELS:nextBandEnd
  const percent=Math.round((level/CREATURE_VISUAL_LEVELS)*100)
  return {
    level,
    label:creatureVisualLabel(creature),
    remaining:maxed?0:Math.max(0,milestone-level),
    milestone,
    percent,
    maxed
  }
}

export function BirthPage(){
  const {data,error}=useBootstrap()
  const nav=useNavigate()
  const [search]=useSearchParams()
  const preview=search.get('preview')==='1'
  const storedProgress=()=>{if(preview)return 0;try{return Math.max(0,Math.min(100,Number(localStorage.getItem('nasypateli-birth-progress')||0)))}catch{return 0}}
  const [birthProgress,setBirthProgress]=useState(storedProgress)
  const [phase,setPhase]=useState<'sealed'|'hatch'|'focus'|'name'|'named'>(()=>storedProgress()>=100?'hatch':'sealed')
  const [name,setName]=useState(()=>{if(preview)return '';try{return localStorage.getItem('nasypateli-pending-creature-name')||''}catch{return ''}})
  const [shakeReady,setShakeReady]=useState(false)
  const [reducedMotion]=useState(()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true)
  const [birthBusy,setBirthBusy]=useState(false)
  const [birthError,setBirthError]=useState('')

  const advanceBirth=(amount:number)=>{
    if(phase!=='sealed')return
    setBirthProgress(current=>{
      const next=Math.min(100,current+amount)
      if(!preview){try{localStorage.setItem('nasypateli-birth-progress',String(next))}catch{}}
      if(next>=100){haptic('heavy');window.setTimeout(()=>setPhase('hatch'),0)}
      else haptic(next>=70?'medium':'light')
      return next
    })
  }

  useEffect(()=>{if(!preview&&data?.creature?.born)nav('/',{replace:true})},[data?.creature?.born,nav,preview])

  useEffect(()=>{
    if(reducedMotion||birthProgress<=0||birthProgress>=100)return
    const im=new Image()
    im.src=`${import.meta.env.BASE_URL}assets/birth-sealed.webp`
  },[birthProgress,reducedMotion])

  useEffect(()=>{
    if(birthProgress<25||reducedMotion)return
    const im=new Image()
    im.src=`${import.meta.env.BASE_URL}assets/birth-hatch.webp`
  },[birthProgress,reducedMotion])

  useEffect(()=>{
    if(birthProgress<70)return
    const head=new Image()
    head.src=`${import.meta.env.BASE_URL}assets/rabbit-head.png`
  },[birthProgress])

  useEffect(()=>{
    if(phase!=='hatch')return

    const idle=new Image()
    idle.src=`${import.meta.env.BASE_URL}assets/rabbit-idle.webp`

    const timer=window.setTimeout(
      ()=>setPhase('focus'),
      reducedMotion?600:2780
    )

    return()=>window.clearTimeout(timer)
  },[phase,reducedMotion])

  useEffect(()=>{
    if(phase!=='focus')return

    const timer=window.setTimeout(
      ()=>setPhase('name'),
      reducedMotion?450:1500
    )

    return()=>window.clearTimeout(timer)
  },[phase,reducedMotion])

  useEffect(()=>{
    if(phase!=='name')return

    const react=new Image()
    react.src=`${import.meta.env.BASE_URL}assets/rabbit-name-react.webp`
  },[phase])

  useEffect(()=>{
    const app=telegramWebApp()
    const accel=app?.Accelerometer

    if(!accel?.start||!app?.onEvent)return

    let last=0

    const onChange=()=>{
      const x=accel.x||0
      const y=accel.y||0
      const z=accel.z||0

      const force=Math.sqrt(x*x+y*y+z*z)

      if(force>17&&Date.now()-last>700){
        last=Date.now()
        advanceBirth(34)
      }
    }

    accel.start(
      {refresh_rate:80},
      ok=>setShakeReady(!!ok)
    )

    app.onEvent('accelerometerChanged',onChange)

    return()=>{
      app.offEvent?.('accelerometerChanged',onChange)
      accel.stop?.()
    }
  },[phase])

  if(!data)return <Load error={error}/>

  if(!data.onboardingComplete){
    return <Navigate to="/onboarding" replace/>
  }

  const finish=async()=>{
    if(birthBusy)return

    const clean=name.trim().slice(0,32)||'Животина'

    try{
      setBirthBusy(true)
      setBirthError('')

      if(!preview){
        await callApi('birth-creature',{name:clean})
        try{
          localStorage.removeItem('nasypateli-pending-creature-name')
          localStorage.removeItem('nasypateli-birth-progress')
          localStorage.removeItem('nasypateli-birth-shadow-v1')
        }catch{}
      }

      hapticSuccess()
      setName(clean)
      setPhase('named')

      if(!preview){
        window.setTimeout(
          ()=>nav('/',{replace:true}),
          reducedMotion?500:1460
        )
      }
    }catch(e:any){
      setBirthError(
        e?.message||'не удалось завершить рождение'
      )
    }finally{
      setBirthBusy(false)
    }
  }

  const sceneSrc=
    phase==='sealed'
      ?(
        reducedMotion||birthProgress===0
          ?'birth-sealed-poster.webp'
          :'birth-sealed.webp'
      )
      :phase==='hatch'
        ?(
          reducedMotion
            ?'rabbit-idle.webp'
            :'birth-hatch.webp'
        )
        :phase==='focus'
          ?'rabbit-head.png'
          :phase==='name'
            ?'rabbit-idle.webp'
            :'rabbit-name-react.webp'

  const bucket=Math.min(
    4,
    Math.floor(birthProgress/25)
  )

  return <div className={`birth-page birth-${phase} birth-v090 birth-progress-${bucket}`}>
    <div className="birth-atmosphere" aria-hidden>
      <i/><i/><i/>
    </div>

    <div className="birth-top">
      <div className="birth-brand">
        НАСЫПАТЕЛИ <span>В КИНО</span>
      </div>
      <div className="birth-index">
        07/07
      </div>
    </div>

    <div className={`birth-scene phase-${phase}`}>
      <div className="projector-cone" aria-hidden/>

      <button
        type="button"
        aria-label="потревожить пачку попкорна"
        className="birth-cartoon-button"
        onClick={()=>advanceBirth(22)}
        disabled={phase!=='sealed'}
      >
        <img
          key={sceneSrc}
          className={`birth-cartoon birth-cartoon-${phase}`}
          src={`${import.meta.env.BASE_URL}assets/${sceneSrc}`}
          alt=""
          draggable={false}
        />
      </button>

      {phase==='sealed'&&<span className={`birth-kernel-fx birth-kernel-level-${bucket}`} aria-hidden>{[0,1,2,3,4,5,6].map(i=><i key={i}/>)}</span>}
      {phase==='hatch'&&<>
        <span className="birth-burst-fx" aria-hidden>{[0,1,2,3,4,5,6,7,8,9].map(i=><i key={i}/>)}</span>
        <span className="birth-bunny-jump" aria-hidden><img src={`${import.meta.env.BASE_URL}assets/rabbit-baby.png`} alt="" draggable={false}/></span>
      </>}

      <div className="birth-film-scratch" aria-hidden/>
    </div>

    <div
      key={phase}
      className="birth-copy birth-copy-v090"
    >
      {phase==='sealed'&&<>
        <div className="eyebrow">
          последняя штука перед клубом
        </div>

        <h1>
          там кто-то<br/>
          шуршит
        </h1>

        <p>
          {shakeReady
            ?'тряси телефон или тормоши пачку. одного раза не хватит'
            :'потревожь пачку несколько раз'}
        </p>

        <div
          className="birth-progress-meter"
          aria-label={`рождение ${birthProgress}%`}
        >
          <i style={{width:`${birthProgress}%`}}/>
        </div>

        <Button onClick={()=>advanceBirth(22)}>
          {birthProgress<35
            ?'проверить'
            :birthProgress<75
              ?'ещё шуршит'
              :'почти вылезла'}
        </Button>
      </>}

      {phase==='hatch'&&<>
        <div className="eyebrow">
          не трогай экран
        </div>

        <h1>
          сейчас<br/>
          вылезет
        </h1>

        <p>
          у Животины свои планы на твой попкорн
        </p>
      </>}

      {phase==='name'&&<>
        <div className="eyebrow">
          теперь твоя
        </div>

        <h1>
          как её<br/>
          зовут?
        </h1>

        <p className="birth-name-note">
          можно оставить «Животина»
        </p>

        <Field label="имя">
          <input
            autoFocus
            maxLength={32}
            value={name}
            onChange={e=>{
              setName(e.target.value)
              setBirthError('')

              if(!preview){try{
                localStorage.setItem(
                  'nasypateli-pending-creature-name',
                  e.target.value
                )
              }catch{}}
            }}
            placeholder="Животина"
            onKeyDown={e=>{
              if(e.key==='Enter')void finish()
            }}
          />
        </Field>

        <Button
          disabled={birthBusy}
          onClick={()=>void finish()}
        >
          {birthBusy
            ?'забираем…'
            :'забрать её'}
        </Button>

        {birthError&&
          <div className="form-error">
            {birthError}
          </div>
        }
      </>}

      {phase==='named'&&<>
        <div className="eyebrow">
          принято
        </div>

        <h1>
          {name || 'Животина'}.
        </h1>

        <p>
          маленькая. пока.
        </p>

        {preview
          ?<><Button onClick={()=>{setBirthProgress(0);setPhase('sealed');setName('');setBirthError('')}}>повторить рождение</Button><Button kind="secondary" onClick={()=>nav('/motion-lab')}>в лабораторию движения</Button></>
          :<div className="birth-loading-line"><i/></div>}
      </>}
    </div>
  </div>
}

export function MotionLabPage(){
  const {data,error}=useBootstrap()
  const nav=useNavigate()
  const [level,setLevel]=useState(1)
  const [animation,setAnimation]=useState<CreatureAnimationState>('idle')
  if(!data)return <Load error={error}/>
  const creature={...data.creature,growthProgress:growthProgressForVisualLevel(level,data.creature)}
  const states:CreatureAnimationState[]=['idle','happy','feeding','growing','thinking','sleeping','waking']
  return <div className="page motion-lab-page">
    <div className="eyebrow">скрытая лаборатория</div>
    <h1 className="page-title">движение<br/>Животины</h1>
    <Card className="motion-lab-stage"><Rabbit creature={creature} state={animation}/><div><b>{creatureVisualLabel(creature)}</b><span>рост {level}/50</span></div></Card>
    <Card><div className="section-title">50 уровней роста</div><input className="motion-level-range" type="range" min="1" max="50" value={level} onChange={e=>setLevel(Number(e.target.value))}/><div className="row spread"><span>1</span><b>{level}/50</b><span>50</span></div></Card>
    <Card><div className="section-title">реакции</div><div className="motion-state-grid">{states.map(state=><button type="button" className={animation===state?'active':''} key={state} onClick={()=>setAnimation(state)}>{state}</button>)}</div></Card>
    <Button onClick={()=>nav('/birth?preview=1')}>проиграть рождение</Button>
    <Button kind="secondary" onClick={()=>nav('/profile')}>назад к профилю</Button>
  </div>
}

export function CreatureProfilePage(){
  const {data,error,reload}=useBootstrap();const nav=useNavigate();const [busy,setBusy]=useState('');const [msg,setMsg]=useState('');const [notice,setNotice]=useState('');const [encounterLink,setEncounterLink]=useState('');const [tasks,setTasks]=useState<any[]>([]);const [creatureAnim,setCreatureAnim]=useState<CreatureAnimationState>('idle');useEffect(()=>{if(data?.creature?.born)callApi<any>('creature-tasks').then(r=>setTasks(r.tasks||[])).catch(()=>{})},[data?.creature?.born,data?.creature?.crumbs]);if(!data)return <Load error={error}/>
  const growth=creatureGrowthView(data.creature)
  const flashNotice=(text:string)=>{setNotice(text);window.setTimeout(()=>setNotice(current=>current===text?'':current),1800)}
  const equip=async(code:string,equipped:boolean)=>{try{setBusy(code);await callApi('equip-cosmetic',{code,equipped});await reload()}catch(e:any){setMsg(e.message)}finally{setBusy('')}}
  const tapCreature=()=>{if(creatureAnim!=='idle')return;haptic('light');setCreatureAnim('happy');window.setTimeout(()=>setCreatureAnim('idle'),700)}
  const feed=async()=>{if(!data.creature.canFeedToday||data.creature.crumbs<data.creature.feedingCost)return;try{setBusy('feed');setMsg('');const previousStage=data.creature.stage;const previousLevel=creatureVisualLevel(data.creature);const previousLabel=creatureVisualLabel(data.creature);const result:any=await callApi('feed-creature');if(result?.alreadyFed){await reload();setCreatureAnim('idle');flashNotice('сегодня уже ела');return}const nextCreature={...data.creature,stage:(result?.stage||data.creature.stage) as CreatureState['stage'],growthProgress:Number(result?.growthProgress??data.creature.growthProgress)};const nextLevel=creatureVisualLevel(nextCreature);const nextLabel=creatureVisualLabel(nextCreature);const stageChanged=nextCreature.stage!==previousStage;const levelChanged=nextLevel>previousLevel;hapticSuccess();setCreatureAnim('feeding');await reload();if(stageChanged||nextLabel!==previousLabel){flashNotice(`новая форма: ${nextLabel} · рост ${nextLevel}/50`);window.setTimeout(()=>setCreatureAnim('growing'),260);window.setTimeout(()=>setCreatureAnim('idle'),1450)}else if(levelChanged){flashNotice(`подросла: ${previousLevel} → ${nextLevel} / 50`);window.setTimeout(()=>setCreatureAnim('growing'),260);window.setTimeout(()=>setCreatureAnim('idle'),1250)}else{flashNotice('покормлена');window.setTimeout(()=>setCreatureAnim('happy'),260);window.setTimeout(()=>setCreatureAnim('idle'),900)}}catch(e:any){setMsg(e.message);setCreatureAnim('idle')}finally{setBusy('')}}
  const remove=async()=>{if(!window.confirm('Удалить кинопрофиль, Животину, знакомства и персональную историю? Это действие нельзя отменить.'))return;if(!window.confirm('Точно удалить профиль? Билеты и платёжные записи останутся у организаторов, персонализация будет удалена.'))return;try{setBusy('delete');await callApi('delete-profile',{confirm:'DELETE_PROFILE'});location.hash='#/onboarding'}catch(e:any){setMsg(e.message)}finally{setBusy('')}}
  const makeEncounterLink=async()=>{try{setBusy('encounter');setMsg('');const r:any=await callApi('my-encounter-token');setEncounterLink(String(r.deepLink||r.token||''))}catch(e:any){setMsg(e.message)}finally{setBusy('')}}
  return <div className="page creature-page"><CreatureCard creature={data.creature} animationState={creatureAnim} onOpen={tapCreature}/><div className="creature-meta"><Pill>{growth.label}</Pill><span>рост {growth.level}/50</span><span>{data.creature.crumbs} 🍿</span><span>{data.creature.storyCount} историй</span></div>
    <Card className="creature-loop"><div className="section-title">крошки и рост</div><div className="creature-economy"><b>{data.creature.crumbs} кинокрошек</b><span>{growth.maxed?'полноценная взрослая Животина':`до следующего образа · ${growth.remaining} ур.`}</span></div><div className="creature-growth-track" aria-label={growth.maxed?'максимальная взрослая форма':`уровень роста ${growth.level} из 50`}><i style={{width:`${growth.percent}%`}}/></div><div className="creature-growth-caption"><span>{growth.label}</span><b>{growth.level} / 50</b>{!growth.maxed&&<span>следующий образ · {growth.milestone}</span>}</div><p className="muted">каждое кормление немного меняет размер. крупные изменения формы происходят примерно раз в 10 уровней</p><p className="muted">одно кормление стоит {data.creature.feedingCost} крошк{data.creature.feedingCost===1?'у':'и'}</p><Button disabled={busy==='feed'||!data.creature.canFeedToday||data.creature.crumbs<data.creature.feedingCost} onClick={feed}>{busy==='feed'?'секунду…':!data.creature.canFeedToday?'сегодня уже ела':data.creature.crumbs<data.creature.feedingCost?`нужно ${data.creature.feedingCost} крошек`:'покормить'}</Button>{notice&&<div className="creature-notice" role="status">{notice}</div>}{!data.creature.canFeedToday&&<p className="muted">следующее кормление откроется в новый день. прогресс не сбрасывается</p>}</Card>
    <Card><div className="section-title">задания</div>{tasks.length?tasks.map((t:any)=><div className="creature-task" key={t.id}><div><b>{t.title}</b><p>{t.description}</p><small>+{t.rewardCrumbs} крошки</small></div><Button kind="secondary" disabled={busy===t.id||t.status==='completed'} onClick={async()=>{try{setBusy(t.id);setMsg('');const r:any=await callApi('complete-creature-task',{taskId:t.id});hapticSuccess();flashNotice(r?.alreadyCompleted?'уже засчитано':`+${Number(r?.rewardCrumbs||t.rewardCrumbs||0)} крошки`);await reload()}catch(e:any){setMsg(e.message)}finally{setBusy('')}}}>{t.status==='completed'?'готово':'выполнить'}</Button></div>):<Empty>новых заданий пока нет</Empty>}{msg&&<div className="form-error">{msg}</div>}</Card>
    <Card><div className="section-title">характер</div><div className="trait-grid">{Object.entries(data.creature.traits||{}).map(([k,v])=><div key={k}><span>{({curiosity:'любопытство',argumentative:'спорщик',social:'общительность',romantic:'романтика',chaotic:'хаос',cinephile:'кино'} as any)[k]||k}</span><i><b style={{width:`${Math.min(100,Number(v))}%`}}/></i></div>)}</div><p className="muted">характер не выбирается в анкете. Животина постепенно набирается ваших привычек и из-за этого по-разному разговаривает с вами</p></Card>
    <Card><div className="section-title">вещи и следы</div>{data.creature.cosmetics?.length?<div className="wardrobe">{data.creature.cosmetics.map(x=><button key={x.code} className={x.equipped?'equipped':''} disabled={busy===x.code} onClick={()=>equip(x.code,!x.equipped)}><b>{x.name}</b><span>{x.rarity}</span><small>{x.equipped?'снять':'надеть'}</small></button>)}</div>:<Empty>пока ничего. первая вещь появляется из реальной истории</Empty>}</Card>
    <Card><div className="section-title">история животины</div>{data.creature.timeline?.length?<div className="timeline">{data.creature.timeline.slice(0,12).map(x=><div key={x.id}><time>{cleanDate(x.happenedAt)}</time><b>{x.secret?'???':x.title}</b><p>{x.secret?'секретная история уже произошла. смысл откроется позже':x.description}</p>{x.rewardName&&<small>осталось на Животине: {x.rewardName}</small>}</div>)}</div>:<Empty>история началась сегодня</Empty>}</Card>
    <Card><div className="section-title">встретить Животин</div><p className="muted">ссылка живёт 30 дней. отправьте её человеку рядом: после открытия обе Животины запомнят встречу и совпадения по кино</p><Button kind="secondary" disabled={busy==='encounter'} onClick={makeEncounterLink}>{busy==='encounter'?'делаем ссылку…':'получить ссылку моей Животины'}</Button>{encounterLink&&<><input className="share-link" readOnly value={encounterLink}/><Button kind="secondary" onClick={async()=>{await copyText(encounterLink);setMsg('ссылка скопирована')}}>скопировать ссылку</Button></>}</Card>
    <Card><div className="section-title">профиль</div><Button kind="secondary" onClick={()=>nav('/onboarding?edit=1')}>изменить кинопрофиль</Button><Button kind="secondary" onClick={()=>nav('/notifications')}>уведомления</Button><Button kind="secondary" onClick={()=>nav('/rules')}>правила НАСЫПАТЕЛЕЙ В КИНО</Button></Card>
    <Card className="danger-zone"><div className="section-title">удаление</div><p className="muted">удалит кинопрофиль, Животину, дейтинг и персональную историю. платёжные записи и минимальные данные о купленных билетах не удаляются автоматически</p><Button kind="danger" disabled={busy==='delete'} onClick={remove}>удалить профиль</Button>{msg&&<div className="form-error">{msg}</div>}</Card>
  </div>
}

const intentOptions:[DatingIntent,string][]=[['friends','дружба'],['cinema_company','компания в кино'],['chat','общение'],['dates','свидания'],['anything','всё']]
export function DatingPage(){
  const {data,error,reload}=useBootstrap();const [busy,setBusy]=useState('');const [msg,setMsg]=useState('');const [setup,setSetup]=useState(false);const [match,setMatch]=useState<{name:string;creature:string;kind:string}|null>(null);const [swipeMotion,setSwipeMotion]=useState<'pass'|'like'|''>('');if(!data)return <Load error={error}/>;const d=data.dating
  const save=async(patch:Record<string,unknown>)=>{try{setBusy('save');setMsg('');await callApi('save-dating-profile',{dating:{...d,...patch}});await reload()}catch(e:any){setMsg(e.message)}finally{setBusy('')}}
  const swipe=async(userId:string,direction:'like'|'pass')=>{try{setBusy(userId);setSwipeMotion(direction);haptic(direction==='like'?'medium':'light');await new Promise(resolve=>window.setTimeout(resolve,220));const r:any=await callApi('dating-swipe',{targetUserId:userId,direction});if(r?.matched){hapticSuccess();setMatch({name:card?.displayName||'человек',creature:card?.creatureName||'Животина',kind:r.kind||'friend'});window.setTimeout(()=>setMatch(null),3200)}await reload()}catch(e:any){setMsg(e.message)}finally{setSwipeMotion('');setBusy('')}}
  if(!d.enabled||setup)return <div className="page dating-page"><div className="eyebrow">знакомства · 18+</div><h1>сначала<br/>решите, кого<br/>сюда пускать</h1><p className="muted">знакомства полностью добровольные. ваш возраст не показывается. до мэтча люди видят Животину, имя и кино-профиль</p><Card><div className="section-title">я</div><div className="chips"><button className={d.selfGender==='woman'?'active':''} onClick={()=>save({selfGender:'woman'})}>женщина</button><button className={d.selfGender==='man'?'active':''} onClick={()=>save({selfGender:'man'})}>мужчина</button></div><div className="section-title">хочу видеть</div><div className="chips"><button className={d.showGender==='women'?'active':''} onClick={()=>save({showGender:'women'})}>женщин</button><button className={d.showGender==='men'?'active':''} onClick={()=>save({showGender:'men'})}>мужчин</button><button className={d.showGender==='all'?'active':''} onClick={()=>save({showGender:'all'})}>всех</button></div><div className="section-title">что ищу</div><div className="chips">{intentOptions.map(([id,label])=><button key={id} className={d.intents.includes(id)?'active':''} onClick={()=>save({intents:d.intents.includes(id)?d.intents.filter(x=>x!==id):[...d.intents,id]})}>{label}</button>)}</div><Button disabled={busy==='save'||!d.selfGender||!d.showGender||!d.intents.length} onClick={()=>save({enabled:true,paused:false})}>включить знакомства</Button>{d.enabled&&<Button kind="secondary" onClick={()=>setSetup(false)}>назад</Button>}{msg&&<div className="form-error">{msg}</div>}</Card></div>
  const card=data.datingCards?.[0]
  return <div className="page dating-page">{match&&<div className="match-overlay"><div className="match-rabbits"><Rabbit creature={data.creature}/><Rabbit creature={{...data.creature,name:match.creature,cosmetics:[]}}/></div><div className="eyebrow">{match.kind==='romantic'?'мэтч':'зайцы нашли друг друга'}</div><h2>{data.creature.name} + {match.creature}</h2><p>{match.name} тоже выбрал(а) вас</p></div>}<div className="row spread"><div><div className="eyebrow">знакомства</div><h2>зайцы рядом</h2></div><button className="tiny-link" onClick={()=>setSetup(true)}>настроить</button></div>{d.paused?<Card><h3>знакомства на паузе</h3><Button onClick={()=>save({paused:false})}>вернуться</Button></Card>:card?<div className={`dating-card ${swipeMotion?`swipe-${swipeMotion}`:''}`}><div className="dating-rabbit"><Rabbit creature={{...data.creature,name:card.creatureName,stage:card.creatureStage,cosmetics:[],timeline:[],storyCount:0,crumbs:0,growthProgress:0,born:true,traits:data.creature.traits}}/></div><div className="dating-info"><div className="eyebrow">{card.creatureName}</div><h1>{card.displayName}</h1><p className="match-note">{card.matchNote}</p><div className="film-tags">{card.favoriteFilms.slice(0,4).map(x=><span key={x}>{x}</span>)}</div></div><div className="swipe-actions"><button disabled={busy===card.userId} onClick={()=>swipe(card.userId,'pass')}>×</button><button className="like" disabled={busy===card.userId} onClick={()=>swipe(card.userId,'like')}>♥</button></div></div>:<Card><div className="big-copy">пока всё</div><p className="muted">Животина не будет показывать людей просто ради бесконечной ленты. новые карточки появятся, когда найдутся подходящие участники</p></Card>}
    <Card><div className="section-title">животина-сваха</div><p>можно написать Животине «найди мне кого-нибудь на хоррор» или «с кем из клуба мне сходить в кино». только по такой просьбе она увидит до 6 уже доступных вам карточек и поможет выбрать, кого посмотреть здесь. мэтч всё равно происходит только после взаимного свайпа</p></Card>
    <Card><div className="section-title">ваши связи</div>{data.datingMatches?.length?data.datingMatches.map(m=><div className="match-row" key={m.id}><div><b>{m.creatureName}</b><span>{m.displayName} · {m.kind}</span></div><button onClick={()=>callApi('dating-hide-connection',{connectionId:m.id}).then(reload)}>скрыть</button></div>):<Empty>ваши зайцы ещё ни с кем не подружились</Empty>}</Card>
    <Button kind="secondary" onClick={()=>save({paused:true})}>поставить знакомства на паузу</Button>{msg&&<div className="form-error">{msg}</div>}
  </div>
}

export function ArchivePage(){const {data,error}=useBootstrap();if(!data)return <Load error={error}/>;return <div className="page"><div className="eyebrow">архив</div><h1 className="page-title">что с вами<br/>уже случилось</h1><Card><div className="section-title">вечера</div>{data.pastEvents.length?data.pastEvents.map(ev=><div className="archive-event" key={ev.id}><small>{cleanDate(ev.startsAt)}</small><b>{ev.movie?.title||ev.title}</b>{ev.review&&<span>есть коллективная рецензия</span>}</div>):<Empty>первый вечер ещё впереди</Empty>}</Card><Card><div className="section-title">история Животины</div>{data.creature.timeline?.length?<div className="timeline">{data.creature.timeline.map(x=><div key={x.id}><time>{cleanDate(x.happenedAt)}</time><b>{x.secret?'???':x.title}</b><p>{x.secret?'секретная история':x.description}</p></div>)}</div>:<Empty>пока пусто</Empty>}</Card></div>}

export function NotificationPage(){const {data,error,reload}=useBootstrap();const [busy,setBusy]=useState(false);const [msg,setMsg]=useState('');if(!data)return <Load error={error}/>;const p=data.notificationPrefs;const save=async(next:NotificationPrefs)=>{try{setBusy(true);await callApi('save-notification-prefs',{prefs:next});await reload()}catch(e:any){setMsg(e.message)}finally{setBusy(false)}};const toggle=(k:keyof NotificationPrefs)=>{if(k==='writeAccess')return;save({...p,[k]:!p[k]})};const request=async()=>{const ok=await requestTelegramWriteAccess();await save({...p,writeAccess:ok});setMsg(ok?'готово. бот может писать вам':'Telegram не дал разрешение. его можно запросить ещё раз позже')};return <div className="page"><div className="eyebrow">настройки</div><h1 className="page-title">уведомления</h1><Card>{!p.writeAccess&&<><p>сначала Telegram должен разрешить боту писать вам первым</p><Button onClick={request}>разрешить сообщения от бота</Button></>}{(['events','creature','stories','matches','tickets','reminders','quietHours'] as const).map(k=><button key={k} className="setting-row" disabled={busy} onClick={()=>toggle(k)}><span>{({events:'новые события',creature:'сообщения Животины',stories:'новые истории и изменения',matches:'мэтчи и знакомства',tickets:'билеты и оплата',reminders:'напоминания перед событиями',quietHours:'не беспокоить ночью'} as any)[k]}</span><i className={p[k]?'on':''}/></button>)}{msg&&<div className="form-error">{msg}</div>}</Card><p className="muted">Животина не будет присылать «я голодная, вернись». уведомления привязаны к реальным событиям, новым историям, кино и знакомствам</p></div>}

export function RulesPage(){return <div className="page legal-page"><div className="eyebrow">НАСЫПАТЕЛИ В КИНО</div><h1 className="page-title">правила</h1><Card><p>клуб и все социальные механики — 18+</p><p>не будьте мудаками друг с другом</p><p>чужие границы важнее игровой механики. если человек не хочет знакомиться, сниматься, отвечать на вопрос или участвовать в какой-то части вечера — этого достаточно</p><p>не публикуйте чужие личные ответы, переписки и фотографии без разрешения</p><p>не мешайте другим смотреть фильм и участвовать в вечере</p><p>игровые механики могут открываться и закрываться организаторами прямо во время события — это часть формата</p><p>анонимные ответы и идеи остаются анонимными до момента, когда формат прямо предусматривает раскрытие</p><p>если поведение участника мешает другим или делает происходящее небезопасным, организаторы могут остановить его участие</p></Card></div>}
