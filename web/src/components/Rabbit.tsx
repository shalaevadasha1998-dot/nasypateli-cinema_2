import type { CreatureState } from '../types'

export function Rabbit({
  creature,size='large'
}:{
  creature:CreatureState
  size?:'tiny'|'small'|'large'
}){
  const name=(creature.name||'Животина').trim()||'Животина'
  return <div className={`rabbit rabbit-${size} rabbit-static`} aria-label={name}>
    <span className="rabbit-art" aria-hidden>
      <img src={`${import.meta.env.BASE_URL}assets/rabbit-main-front.webp`} alt="" draggable={false}/>
    </span>
  </div>
}
