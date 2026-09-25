import type { CreatureState } from '../types'

export type CreatureAnimationState =
  | 'unborn'|'birth'|'idle'|'hungry'|'feeding'|'happy'|'thinking'|'sleeping'|'waking'|'growing'

const idleAsset:Record<CreatureState['stage'],string>={
  stage_0:'rabbit-idle.webp',
  stage_1:'rabbit-baby.png',
  stage_2:'rabbit-baby.png',
  stage_3:'rabbit-baby.png',
  stage_4:'rabbit-baby.png'
}

export function getCreatureAnimation(stage:CreatureState['stage'],state:CreatureAnimationState='idle'){
  const idle=idleAsset[stage]||idleAsset.stage_0
  const canonical:Partial<Record<CreatureAnimationState,string>>={
    idle,
    hungry:idle,
    feeding:idle,
    happy:idle,
    thinking:idle,
    sleeping:idle,
    waking:idle,
    growing:idle
  }
  return canonical[state]||idle
}

function equippedCodes(creature:CreatureState){
  return new Set((Array.isArray(creature.cosmetics)?creature.cosmetics:[]).filter(x=>x.equipped).map(x=>x.code))
}

export function Rabbit({
  creature,size='large',animate=true,state='idle'
}:{
  creature:CreatureState
  size?:'tiny'|'small'|'large'
  animate?:boolean
  state?:CreatureAnimationState
}){
  const eq=equippedCodes(creature)
  const classes=['rabbit','rabbit-'+size,animate?'rabbit-alive':'',`rabbit-stage-${creature.stage}`,`rabbit-state-${state}`,...[...eq].map(x=>`wear-${x}`)].join(' ')
  const asset=getCreatureAnimation(creature.stage,state)
  return <div className={classes} aria-label={`Животина ${creature.name||''}`} data-stage={creature.stage} data-state={state}>
    <span className="rabbit-aura" aria-hidden/>
    <img src={`${import.meta.env.BASE_URL}assets/${asset}`} alt="" draggable={false}/>
    {state==='feeding'&&<span className="rabbit-feed-fx" aria-hidden>{[0,1,2,3,4,5].map(i=><i key={i}/>)}</span>}
    {state==='growing'&&<span className="rabbit-growth-fx" aria-hidden>{[0,1,2,3,4,5,6,7].map(i=><i key={i}/>)}</span>}
    <span className="rabbit-scarf"/><span className="rabbit-fangs"/><span className="rabbit-heart">♥</span><span className="rabbit-ticket">КИНО</span><span className="rabbit-hat"/><span className="rabbit-bag"/><span className="rabbit-flower">✦</span>{(creature.cosmetics||[]).filter(x=>x.equipped&&!['scarf-red','horror-fangs','romantic-heart','travel-ticket','night-cap','random-bag','first-flower'].includes(x.code)).map(x=><span key={x.code} className={`rabbit-trace slot-${x.slot} rarity-${x.rarity}`}>{String(x.visual?.glyph||'•')}</span>)}
  </div>
}

export function CreatureCard({
  creature,onOpen,animationState='idle'
}:{
  creature:CreatureState
  onOpen?:()=>void
  animationState?:CreatureAnimationState
}){
  return <button type="button" className="creature-card" onClick={onOpen}>
    <div className="creature-stage"><Rabbit creature={creature} state={animationState}/></div>
    <div className="creature-copy"><div className="eyebrow">ваша животина</div><h2>{creature.name||'пока без имени'}</h2><p>{creature.storyCount} историй · {creature.crumbs} кинокрошек</p></div>
  </button>
}
