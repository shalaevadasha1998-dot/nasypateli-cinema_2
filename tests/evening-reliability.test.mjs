import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mediaKey,sceneDigest,sceneProblems,reviewedScene,validMedia} from '../supabase/functions/app/_shared/scenePackage.ts'
import {judgeSuggestion,hostJudgement} from '../supabase/functions/app/_shared/fairJudgement.ts'
import {planDirector,playbackComplete} from '../supabase/functions/app/_shared/showDirector.ts'
import {reducePlayback} from '../supabase/functions/app/_shared/playback.ts'
const copy=x=>structuredClone(x)
const f=(start=0,end=10)=>({sourcePlatform:'youtube',videoId:'abcdefghijk',startSec:start,endSec:end})
function packageFixture(platform='youtube'){
 const fs=Array.from({length:4},(_,i)=>({...f(i*10,(i+1)*10),...(platform==='rutube'?{sourcePlatform:platform,videoId:'a'.repeat(32),sourceUrl:'https://rutube.ru/video/'+('a'.repeat(32))+'/'}:platform!=='youtube'?{sourcePlatform:platform,videoId:'',sourceUrl:'https://archive.org/download/example/movie.mp4'}:{})}))
 const qs=Array.from({length:3},(_,i)=>({position:i+1,prompt:'что случится?',options:['выйдет','сядет'],correct_answer:'выйдет',reveal_text:'герой выйдет из комнаты',reveal_fragment:fs[i+1]}))
 return {pack:{status:'ready',fragments:fs,match_data:{}},qs}
}
for(const platform of ['youtube','rutube','direct','internet_archive','wikimedia_commons'])test(`reviewed bundle supports ${platform} with exact scene continuation`,async()=>{
 const {pack,qs}=packageFixture(platform);assert.deepEqual(sceneProblems(pack,qs),[]);assert.equal(await reviewedScene(pack,qs,3),false)
 pack.match_data.sceneReview={version:1,reviewedAt:'2026-10-15',reviewedBy:'host',digest:await sceneDigest(pack,qs)}
 assert.equal(await reviewedScene(pack,qs,3),true)
 qs[0].reveal_text='другое продолжение';assert.equal(await reviewedScene(pack,qs,3),false)
})
const mutations={
 'missing reveal':({pack})=>pack.fragments.pop(),
 'missing question':({qs})=>qs.pop(),
 'different cut':({pack})=>pack.fragments[2].videoId='zzzzzzzzzzz',
 'skipped scene':({pack})=>pack.fragments[1].startSec+=3,
 'overlapping scenes':({pack})=>pack.fragments[1].startSec-=3,
 'wrong answer option':({qs})=>qs[0].correct_answer='уснёт',
 'duplicate options':({qs})=>qs[0].options=['выйдет','выйдет'],
 'swapped reveals':({qs})=>qs[0].reveal_fragment=f(20,30),
 'nonsequential questions':({qs})=>qs[0].position=2,
 'empty prompt':({qs})=>qs[0].prompt='',
 'unverified backup':({pack})=>pack.fragments[0].backups=[{...f(),videoId:'zzzzzzzzzzz'}],
 'wrong backup timing':({pack})=>pack.fragments[0].backups=[{...f(2,10),videoId:'zzzzzzzzzzz',sameCut:true}],
 'backup is original':({pack})=>pack.fragments[0].backups=[{...f(),sameCut:true}],
 'infinite timecode':({pack})=>pack.fragments[0].endSec=Infinity,
 'string timecode':({pack})=>pack.fragments[0].startSec='0',
 'null timecode':({pack})=>pack.fragments[0].endSec=null,
 'empty reveal explanation':({qs})=>qs[0].reveal_text=''
}
for(const [name,mutate]of Object.entries(mutations))test(`invalid bundle rejected: ${name}`,()=>{const value=packageFixture();mutate(value);assert.ok(sceneProblems(value.pack,value.qs).length)})
for(const url of ['javascript:alert(1)','http://example.com/a.mp4','https://user:password@example.com/a.mp4','file:///tmp/video'])test(`unsafe media scheme or credentials rejected: ${url.split(':')[0]}`,()=>assert.equal(validMedia({...f(),sourcePlatform:'direct',sourceUrl:url}),false))
test('approved backup is fingerprinted and supports the same scene',async()=>{const {pack,qs}=packageFixture();pack.fragments[0].backups=[{...f(),sourcePlatform:'direct',sourceUrl:'https://example.com/movie.mp4',sameCut:true}];assert.deepEqual(sceneProblems(pack,qs),[]);const digest=await sceneDigest(pack,qs);pack.fragments[0].backups[0].sourceUrl='https://example.com/other.mp4';assert.notEqual(await sceneDigest(pack,qs),digest)})
const answers=[{id:'first'},{id:'second'}]
for(const value of [null,{}, {winnerId:'first'}, {verdict:'winner',winnerIds:['foreign'],confidence:.99},{verdict:'winner',winnerIds:['first'],confidence:0},{verdict:'winner',winnerIds:['first'],confidence:NaN},{verdict:'winner',winnerIds:['first','first'],confidence:1},{verdict:'none',winnerIds:['first'],confidence:1},{verdict:'uncertain',winnerIds:[],confidence:1},{verdict:'winner',winnerIds:[],confidence:1}])test(`AI failure or invalid result never selects first: ${JSON.stringify(value)}`,()=>{const j=judgeSuggestion(value,answers);assert.equal(j.status,'needs_host');assert.deepEqual(j.winnerIds,[])})
test('confident none awards nobody',()=>assert.equal(judgeSuggestion({verdict:'none',winnerIds:[],confidence:.99},answers).outcome,'none'))
test('ties preserve all valid winners rather than arbitrary first',()=>assert.deepEqual(judgeSuggestion({verdict:'winner',winnerIds:['first','second'],confidence:.99},answers).winnerIds,['first','second']))
test('no answers is an explicit zero-score result',()=>assert.deepEqual(judgeSuggestion(null,[]).winnerIds,[]))
test('host may choose none, one or a tie, but never an outside answer',()=>{assert.equal(hostJudgement([],answers).outcome,'none');assert.equal(hostJudgement(['first'],answers).method,'host');assert.throws(()=>hostJudgement(['foreign'],answers));assert.throws(()=>hostJudgement(['first','first'],answers))})
const report=(seq=1,position=0,status='playing')=>({runId:'run-1',projectorRevision:7,sessionId:'screen-one',seq,position,status,sourceKey:mediaKey(f()),localConfirmed:true})
test('verified actual progress reaches ended; wall time is not the evidence',()=>{let state;for(let second=0;second<=10;second++)state=reducePlayback(state,report(second+1,second,second===10?'ended':'playing'),f(),'run-1',7,100000+second*1000);assert.equal(state.status,'ended');assert.equal(playbackComplete(state,{revision:7,payload:{fragment:f()}},'run-1'),true)})
for(const [name,patch] of Object.entries({run:{runId:'old'},revision:{projectorRevision:6},session:{sessionId:'x'},sequence:{seq:0},NaN:{position:NaN},source:{sourceKey:'youtube:zzzzzzzzzzz'},status:{status:'done'}}))test(`stale or invalid playback rejected: ${name}`,()=>assert.equal(reducePlayback(null,{...report(),...patch},f(),'run-1',7,1000),null))
test('out-of-order reports cannot overwrite a newer state',()=>{const p=reducePlayback(null,report(3),f(),'run-1',7,1000);assert.equal(reducePlayback(p,report(2,1),f(),'run-1',7,2000),null)})
test('a second projector cannot steal a live video lease',()=>{const p=reducePlayback(null,report(),f(),'run-1',7,1000);assert.equal(reducePlayback(p,{...report(2,1),sessionId:'screen-two'},f(),'run-1',7,2000),null)})
test('end without watching and skipped scene cannot advance',()=>{const p=reducePlayback(null,report(),f(),'run-1',7,1000),end=reducePlayback(p,report(2,10,'ended'),f(),'run-1',7,2000);assert.equal(end.status,'error');assert.equal(end.continuous,false)})
test('stalled playing state becomes buffering despite heartbeats',()=>{let p;for(let i=0;i<=12;i++)p=reducePlayback(p,report(i+1),f(),'run-1',7,1000+i*1000);assert.equal(p.status,'buffering')})
test('report after a disconnected projector requires a new complete showing',()=>{const p=reducePlayback(null,report(),f(),'run-1',7,1000),next=reducePlayback(p,report(2,10,'ended'),f(),'run-1',7,21000);assert.equal(next.status,'error')})
const now=1000000
function director(flow='playing_clip'){
 return {show:{runtime:{runId:'run-1',runStatus:'running',roundControlMode:'auto',currentBlock:{id:'cinema',type:'cinema_rounds',roundsTarget:2},directorState:{},videoState:{},currentBlockRoundCount:1},currentRound:{id:'round-1',status:'active',flowStatus:flow,roundNo:2,questionTarget:3,questionPosition:1}},projector:{state:flow==='playing_clip'?'film_intro':flow,revision:7,updatedAt:new Date(0).toISOString(),payload:{fragment:f()}},attended:2,packageId:'pack-1'}
}
for(const status of ['loading','buffering','error','blocked','paused','playing'])test(`no timed transition during ${status}`,()=>{const x=director();x.show.runtime.videoState={...report(1,10,status),continuous:true};assert.ok(planDirector(x,now).wait)})
test('phone-free director advances only after confirmed video end',()=>{const x=director();x.show.runtime.videoState={...report(11,10,'ended'),continuous:true};const step=planDirector(x,now);assert.equal(step.action,'admin-film-projector');assert.deepEqual(step.body,{filmPackageId:'pack-1',roundId:'round-1',op:'question_open',position:1})})
test('host-needed grading blocks automatic reveal forever',()=>{const x=director('question_results');x.projector.payload.judgement={status:'needs_host'};assert.ok(planDirector(x,now*10).wait);x.projector.payload.judgement.status='decided';assert.equal(planDirector(x,now).body.op,'question_reveal')})
test('manual mode and pause are durable stop switches',()=>{for(const patch of [{roundControlMode:'manual'},{runStatus:'paused'},{directorState:{blocked:true}}]){const x=director('round_intro');Object.assign(x.show.runtime,patch);assert.ok(planDirector(x,now).wait)}})
test('zero answers closes to an explicit none instead of hanging',()=>{const x=director('question_open');x.projector.payload.answerCount=0;assert.equal(planDirector(x,now).body.op,'question_results')})
test('cinema block duration never skips an unfinished scene',()=>{const x=director();x.show.runtime.currentBlock.autoAdvance=true;x.show.runtime.currentBlock.durationMin=1;assert.ok(planDirector(x,now).wait)})
test('the phone no longer contains a mutation-producing auto director',()=>{const s=readFileSync(new URL('../web/src/App.tsx',import.meta.url),'utf8');const section=s.slice(s.indexOf('function ShowRoundControl'),s.indexOf('function ProgramEditor'));assert.ok(!section.includes('setInterval'));assert.ok(!section.includes('fire('));assert.ok(!s.includes('watchMs+2000'))})
test('source contains neither plot fallback nor the first-zero-score selection',()=>{const s=readFileSync(new URL('../supabase/functions/app/handlers/api.ts',import.meta.url),'utf8');assert.ok(!s.includes('buildFallbackQuestionPackage'));assert.ok(!s.includes('let best=-1'));assert.ok(!s.includes('maybeAutoAdvanceShow'))})

test('offline projector also stops non-video transitions',()=>{const x=director('round_intro');x.screenOnline=false;assert.ok(planDirector(x,now).wait)})
test('grading closes submissions before taking its snapshot',()=>{const s=readFileSync(new URL('../supabase/functions/app/handlers/api.ts',import.meta.url),'utf8');const action=s.slice(s.indexOf("}else if(op==='question_results'){"));assert.ok(action.indexOf("rpc('freeze_film_question'")<action.indexOf("from('film_predictions')"))})

test('YouTube clock alone cannot finish an ad-sensitive scene',()=>{let p;for(let i=0;i<=10;i++)p=reducePlayback(p,{...report(i+1,i,i===10?'ended':'playing'),localConfirmed:false},f(),'run-1',7,100000+i*1000);assert.equal(p.status,'blocked');assert.equal(playbackComplete(p,{revision:7,payload:{fragment:f()}},'run-1'),false)})
