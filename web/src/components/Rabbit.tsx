import type { CreatureState } from '../types'

function equippedCodes(creature:CreatureState){return new Set((Array.isArray(creature.cosmetics)?creature.cosmetics:[]).filter(x=>x.equipped).map(x=>x.code))}

export function Rabbit({creature,size='large',animate=true}:{creature:CreatureState;size?:'tiny'|'small'|'large';animate?:boolean}){
  const eq=equippedCodes(creature)
  const classes=['rabbit','rabbit-'+size,animate?'rabbit-alive':'',`rabbit-stage-${creature.stage}`,...[...eq].map(x=>`wear-${x}`)].join(' ')
  return <div className={classes} aria-label={`Животина ${creature.name||''}`}>
    <img src={`${import.meta.env.BASE_URL}assets/rabbit-baby.png`} alt="" draggable={false}/>
    <span className="rabbit-scarf"/><span className="rabbit-fangs"/><span className="rabbit-heart">♥</span><span className="rabbit-ticket">КИНО</span><span className="rabbit-hat"/><span className="rabbit-bag"/><span className="rabbit-flower">✦</span>{(creature.cosmetics||[]).filter(x=>x.equipped&&!['scarf-red','horror-fangs','romantic-heart','travel-ticket','night-cap','random-bag','first-flower'].includes(x.code)).map(x=><span key={x.code} className={`rabbit-trace slot-${x.slot} rarity-${x.rarity}`}>{String(x.visual?.glyph||'•')}</span>)}
  </div>
}

export function CreatureCard({creature,onOpen}:{creature:CreatureState;onOpen?:()=>void}){
  return <button type="button" className="creature-card" onClick={onOpen}>
    <div className="creature-stage"><Rabbit creature={creature}/></div>
    <div className="creature-copy"><div className="eyebrow">ваша животина</div><h2>{creature.name||'пока без имени'}</h2><p>{creature.storyCount} историй · {creature.crumbs} кинокрошек</p></div>
  </button>
}
