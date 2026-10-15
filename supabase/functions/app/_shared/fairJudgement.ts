export type Judgement={status:'needs_host'|'decided';outcome:'winner'|'none'|'uncertain';winnerIds:string[];comment:string;method:'ai'|'host'|'no_answers'}
export function judgeSuggestion(value:any,answers:{id:string}[]):Judgement{
  if(!answers.length)return {status:'decided',outcome:'none',winnerIds:[],comment:'ответов нет · баллы не начислены',method:'no_answers'}
  const uncertain:Judgement={status:'needs_host',outcome:'uncertain',winnerIds:[],comment:'автоматическая оценка не подтверждена · нужно решение ведущей',method:'ai'}
  if(!value||!Number.isFinite(value.confidence)||value.confidence<.85||value.confidence>1)return uncertain
  const ids=Array.isArray(value.winnerIds)?value.winnerIds:[]
  if(new Set(ids).size!==ids.length||ids.some((id:unknown)=>typeof id!=='string'||!answers.some(a=>a.id===id)))return uncertain
  if(value.verdict==='none'&&ids.length===0)return {...uncertain,status:'decided',outcome:'none',comment:String(value.comment||'никто не угадал').slice(0,500)}
  if(value.verdict==='winner'&&ids.length>0)return {...uncertain,status:'decided',outcome:'winner',winnerIds:ids,comment:String(value.comment||'ответ совпадает с показанным продолжением').slice(0,500)}
  return uncertain
}
export function hostJudgement(ids:unknown,answers:{id:string}[]):Judgement{
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!answers.some(a=>a.id===id))||new Set(ids).size!==ids.length)throw Error('выбери существующие ответы этого вопроса')
  return {status:'decided',outcome:ids.length?'winner':'none',winnerIds:ids,comment:ids.length?'решение ведущей':'никто не угадал · решение ведущей',method:'host'}
}
