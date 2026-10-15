import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {initialDemoState} from '../src/demo.ts'
const origin='http://127.0.0.1:4192/nasypateli-cinema_2/'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4192','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
const check=(ok,msg)=>{if(!ok)throw Error(msg)}
let browser
try{
 await mkdir('test-artifacts',{recursive:true})
 for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)break}catch{}await new Promise(r=>setTimeout(r,150))}
 browser=await chromium.launch({headless:true})
 for(const width of [390,1366]){
  const state=structuredClone(initialDemoState)
  Object.assign(state,{isAdmin:true,onboardingComplete:true,registration:'attended',movieCatalog:[],filmPackages:[],reviewQueue:[],adminParticipants:[]})
  state.profile.completed=true;state.creature.born=true;state.event.slug='test-2026-10-17'
  const block={id:'cinema',type:'cinema_rounds',title:'снимаем кино',index:0,roundsTarget:2,durationMin:60}
  state.show={program:{version:1,blocks:[block],roundsTarget:2,rewards:{join:0,vote:0,round:0,finale:0}},runtime:{runId:'40000000-0000-0000-0000-000000000001',isTest:true,runStatus:'running',roundControlMode:'manual',currentBlock:block,currentBlockId:'cinema',currentBlockIndex:0,currentRound:2,currentRoundId:'round-1',videoState:{},directorState:{lastTickAt:new Date().toISOString()},revision:1},currentRound:{id:'round-1',roundNo:2,status:'active',flowStatus:'question_results',questionTarget:3,questionPosition:1},audio:{state:{status:'stopped',mode:'auto'},assets:[],screen:{online:true,unlocked:true}},voteResults:[],onlineCount:2}
  state.projector={state:'question_results',revision:7,payload:{questionId:'q-1',position:1,judgement:{status:'needs_host',outcome:'uncertain'}}}
  state.judgeReview={questionId:'q-1',roundId:'round-1',packageId:'pack-1',revision:7,prompt:'что случится дальше?',actual:'герой выйдет',reveal:'он открывает дверь',judgement:{status:'needs_host'},answers:[{id:'answer-1',animal_name_snapshot:'первая',answer:'он уснёт'},{id:'answer-2',animal_name_snapshot:'вторая',answer:'он уйдёт'}]}
  const calls=[],errors=[]
  const page=await browser.newPage({viewport:{width,height:900}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'fixture'}}})
  await page.route('**/telegram-web-app.js*',r=>r.fulfill({contentType:'application/javascript',body:''}))
  await page.route('**/functions/v1/app',async r=>{
    const b=r.request().postDataJSON();calls.push(b)
    if(b.action==='admin-question-judge'){
      await new Promise(resolve=>setTimeout(resolve,250))
      state.projector.revision++;state.projector.payload.judgement={status:'decided',outcome:b.winnerIds.length?'winner':'none'}
      state.judgeReview={...state.judgeReview,revision:state.projector.revision,judgement:state.projector.payload.judgement}
      return r.fulfill({json:{ok:true}})
    }
    return r.fulfill({json:['bootstrap','admin-bootstrap'].includes(b.action)?state:b.action==='live-refresh'?{runtime:state.show.runtime}:b.action==='admin-feedback-summary'?{ok:true,total:0,byIntent:{},comments:[]}:{ok:true,owner:true}})
  })
  await page.goto(origin+'#/admin/test-2026-10-17',{waitUntil:'domcontentloaded'})
  const none=page.getByRole('button',{name:'никто не угадал · подтвердить',exact:true})
  await none.waitFor()
  await none.evaluate(el=>{el.click();el.click()})
  await page.getByRole('status').filter({hasText:'сохранено'}).waitFor()
  const decisions=calls.filter(x=>x.action==='admin-question-judge')
  check(decisions.length===1,'double tap submitted twice')
  check(decisions[0].winnerIds.length===0,'none selected a winner')
  check(decisions[0].expectedProjectorRevision===7&&decisions[0].expectedRunId===state.show.runtime.runId,'host decision has no stale-run fence')
  await page.locator('.host-answers input').nth(1).check()
  await page.getByRole('button',{name:'подтвердить правильные ответы',exact:true}).click()
  await page.waitForTimeout(500)
  check(calls.filter(x=>x.action==='admin-question-judge').at(-1).winnerIds.join()==='answer-2','host selected wrong answer')
  check((await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth))<=5,'host panel overflows')
  await page.screenshot({path:`test-artifacts/evening-host-${width}.png`,fullPage:true})
  // Advancing the browser clock must not produce any automatic show mutation.
  state.show.runtime.roundControlMode='auto';state.show.currentRound.flowStatus='round_intro';state.judgeReview=null
  state.projector={state:'round_intro',revision:9,payload:{},updatedAt:'2026-01-01T00:00:00Z'}
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#show-control').waitFor()
  const before=calls.filter(x=>['admin-round-pitches-open','admin-show-control','admin-round-start','admin-film-projector'].includes(x.action)).length
  await page.clock.install();await page.clock.fastForward(360000)
  check(calls.filter(x=>['admin-round-pitches-open','admin-show-control','admin-round-start','admin-film-projector'].includes(x.action)).length===before,'phone timer still runs show commands')
  check(!errors.length,errors.join('; '))
  console.log(`PASS host none/correction, double tap, save confirmation, run/revision fence and phone-free controls at ${width}px`)
  await page.close()
 }
}finally{await browser?.close();server.kill('SIGTERM')}
