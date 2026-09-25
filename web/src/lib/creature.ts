import type { CreatureState } from '../types'

export const CREATURE_VISUAL_LEVELS=50

export const creatureVisualLabels=[
  'новорождённая',
  'малышка',
  'подросток',
  'молодая',
  'взрослая'
] as const

function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value))}

export function creatureVisualLevel(creature:CreatureState){
  const maxGrowth=Math.max(1,Number(creature.stageThresholds?.stage_4||90))
  const growth=clamp(Number(creature.growthProgress||0),0,maxGrowth)
  const ratio=growth/maxGrowth
  return clamp(1+Math.round(ratio*(CREATURE_VISUAL_LEVELS-1)),1,CREATURE_VISUAL_LEVELS)
}

export function creatureVisualBand(level:number){
  const safe=clamp(Math.round(level||1),1,CREATURE_VISUAL_LEVELS)
  return clamp(Math.floor((safe-1)/10),0,4)
}

export function creatureVisualLabel(creature:CreatureState){
  return creatureVisualLabels[creatureVisualBand(creatureVisualLevel(creature))]
}

export function creatureVisualScale(creature:CreatureState){
  const level=creatureVisualLevel(creature)
  const ratio=(level-1)/(CREATURE_VISUAL_LEVELS-1)
  // More growth is visible early, while the last third settles into adult proportions.
  const eased=1-Math.pow(1-ratio,1.22)
  return Number((0.56+eased*0.44).toFixed(4))
}

export function creatureVisualRatio(creature:CreatureState){
  return (creatureVisualLevel(creature)-1)/(CREATURE_VISUAL_LEVELS-1)
}

export function growthProgressForVisualLevel(level:number,creature:CreatureState){
  const safe=clamp(Math.round(level||1),1,CREATURE_VISUAL_LEVELS)
  const maxGrowth=Math.max(1,Number(creature.stageThresholds?.stage_4||90))
  return ((safe-1)/(CREATURE_VISUAL_LEVELS-1))*maxGrowth
}
