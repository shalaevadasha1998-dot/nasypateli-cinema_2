import { mediaKey, validMedia } from './scenePackage.ts'
const STATES=new Set(['loading','playing','buffering','paused','ended','error','blocked'])
/** Authenticated projector telemetry, fenced by run + projection + screen session + sequence. */
export function reducePlayback(previous:any,report:any,fragment:any,runId:string,revision:number,now=Date.now()):any|null{
  if(!validMedia(fragment)||report?.runId!==runId||report?.projectorRevision!==revision||!STATES.has(report.status)||typeof report.sessionId!=='string'||report.sessionId.length<8||report.sessionId.length>100||!Number.isSafeInteger(report.seq)||report.seq<1||!Number.isFinite(report.position))return null
  const keys=[mediaKey(fragment),...(Array.isArray(fragment.backups)?fragment.backups.filter((b:any)=>b.sameCut&&validMedia(b)&&b.startSec===fragment.startSec&&b.endSec===fragment.endSec).map(mediaKey):[])]
  if(!keys.includes(report.sourceKey))return null
  const same=previous?.runId===runId&&previous?.projectorRevision===revision
  const p=same?previous:null
  if(p&&p.sessionId!==report.sessionId&&now-p.lastSeenAt<12000)return null
  if(p&&p.sessionId===report.sessionId&&report.seq<=p.seq)return null
  const fresh=p&&p.sessionId===report.sessionId&&p.sourceKey===report.sourceKey&&now-p.lastSeenAt<12000
  const position=Math.max(fragment.startSec,Math.min(fragment.endSec,report.position))
  const reset=!fresh||report.position<Number(p.position)-.5
  const baseline=reset?fragment.startSec:Number(p.position)
  const delta=position-baseline
  // A seek, an ad clock, or a forged end event is not evidence of watching a scene.
  const maxAdvance=reset?2.5:Math.max(0,(now-p.lastSeenAt)/1000)*1.25+1
  const plausible=delta>=-.5&&delta<=maxAdvance&&report.position<=fragment.endSec+1
  const continuous=reset?plausible&&position<=fragment.startSec+2.5:p.continuous===true&&plausible
  const lastProgressAt=delta>.05&&plausible?now:reset?now:p.lastProgressAt
  let status=report.status
  if(status==='ended'&&(!continuous||position<fragment.endSec-.3))status='error'
  // The public YouTube iframe API has no documented ad/content clock boundary.
  // Only a reviewed direct backup or an operator-confirmed local copy can finish.
  if(status==='ended'&&String(report.sourceKey).startsWith('youtube:')&&report.localConfirmed!==true)status='blocked'
  if(status==='playing'&&now-lastProgressAt>10000)status='buffering'
  return {runId,projectorRevision:revision,sessionId:report.sessionId,seq:report.seq,sourceKey:report.sourceKey,position,status,continuous,lastSeenAt:now,lastProgressAt,localConfirmed:report.localConfirmed===true}
}
