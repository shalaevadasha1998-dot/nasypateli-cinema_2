import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const origin='http://127.0.0.1:4175/nasypateli-cinema_2/'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4175','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
let browser
async function newPage(options){
  const page=await browser.newPage(options)
  // The remote, parser-blocking Telegram SDK may stall GitHub-hosted Chromium.
  // UI smoke does not validate Telegram credentials: keep that in a real-device test.
  await page.route('**/telegram-web-app.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* telegram sdk skipped in browser-only ui smoke */'}))
  return page
}


const blocks=[
  ['arrival','arrival','сбор гостей',60],
  ['creature_intro','creature_intro','знакомство с животиной',5],
  ['cinema_first','cinema_rounds','снимаем кино',75],
  ['break','break','перерыв',30],
  ['cinema_second','cinema_rounds','угадываем кино',75],
  ['final_qr','final_qr','финал',5],
  ['music_outro','music_outro','музыка',30]
].map(([id,type,title,durationMin],index)=>({id,type,title,durationMin,index,roundsTarget:type==='cinema_rounds'?2:0,autoAdvance:type!=='cinema_rounds',audioPlaylist:[],audioVolume:.28}))

function fakeShow(status='idle',test=true){
  return {
    event:{id:'d5ac9f9c-d0e8-4fd2-9b09-6f914d7ef340',slug:test?'test-2026-10-03':'2026-10-17',title:'насыпатели в кино · репетиция',status:'CHECKIN'},
    show:{
      program:{version:1,roundsTarget:4,rewards:{join:1,vote:1,round:2,finale:3},blocks},
      runtime:{runId:'40000000-0000-0000-0000-000000000001',runKey:'test_002',isTest:test,runStatus:status,currentBlockId:status==='paused'?'cinema_first':'arrival',currentBlockIndex:status==='paused'?2:0,currentBlock:blocks[status==='paused'?2:0],currentRound:0,voteState:'closed',resultsVisible:false,videoState:{status:'idle'},revision:1},
      currentRound:null,voteResults:[],onlineCount:1,
      audio:{state:{mode:'auto',status:'stopped',volume:.28},assets:[],screen:{online:false,unlocked:false}}
    },
    adminParticipants:[],movieCatalog:[],filmPackages:[],reviewQueue:[]
  }
}
async function ready(){
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}
  throw Error('Preview failed to start')
}
async function director(viewport,label,status='idle',test=true){
  const page=await newPage({viewport})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(value=>{if(!localStorage.getItem('nasypateli-cinema-demo-v3'))localStorage.setItem('nasypateli-cinema-demo-v3',JSON.stringify(value))},fakeShow(status,test))
  try{
    await page.goto(origin+'#/admin/'+(test?'test-2026-10-03':'2026-10-17'),{waitUntil:'domcontentloaded'})
    await page.locator('#show-control').waitFor({state:'visible',timeout:17000})
    const stats=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}))
    if(stats.scroll>stats.viewport+5)throw Error('admin horizontal overflow '+JSON.stringify(stats))
    if(status==='idle'){
      const launch=page.getByRole('button',{name:test?'начать тест без звука':'начать тест без звука'})
      if(test){if(!await launch.isEnabled())throw Error('Test launch disabled without projector')}
      else if(await launch.isEnabled())throw Error('Live launch should require unlocked projector')
    }
    if(status==='running'){
      if(!await page.getByRole('button',{name:'← предыдущий блок'}).isVisible())throw Error('Previous control not shown')
      if(!await page.getByRole('button',{name:'следующий блок →'}).isVisible())throw Error('Next control not shown')
      if(!await page.getByRole('button',{name:'Ⅱ пауза'}).isVisible())throw Error('Pause control not shown')
      if(await page.locator('.show-timeline button').count()!==7)throw Error('Incorrect number of stages')
      const rail=page.locator('.show-timeline')
      const before=await rail.evaluate(el=>el.scrollLeft)
      await page.getByTitle('листать этапы вправо').click()
      await page.waitForTimeout(450)
      const after=await rail.evaluate(el=>el.scrollLeft)
      if(after<=before)throw Error('Timeline next button did not scroll')
    }
    if(status==='paused'){
      const switcher=page.getByRole('button',{name:'переключаю сама'})
      await switcher.click()
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('nasypateli-cinema-demo-v3')||'{}')?.show?.runtime?.roundControlMode==='manual',{timeout:10000})
      if(await switcher.getAttribute('aria-pressed')!=='true')throw Error('Manual director button was not selected')
      await page.reload({waitUntil:'domcontentloaded'})
      await page.getByRole('button',{name:'переключаю сама',pressed:true}).waitFor({state:'visible',timeout:10000})
      console.log('PASS director manual mode persists across reloads')
    }
    if(errors.length)throw Error('JavaScript errors '+errors.join('; '))
    await page.screenshot({path:'test-artifacts/'+label+'.png',fullPage:true})
    console.log('PASS director '+label+' '+JSON.stringify(stats))
  }catch(error){
    console.error('DIRECTOR FAILURE '+label+' '+(await page.locator('body').innerText()).slice(0,1600))
    await page.screenshot({path:'test-artifacts/'+label+'-failure.png',fullPage:true})
    throw error
  }finally{await page.close()}
}
async function manualRoundSequence(roundNo){
  const page=await newPage({viewport:{width:roundNo===1?390:320,height:860}})
  const fixture=fakeShow('running',true)
  fixture.show.runtime.currentBlock=blocks[2]
  fixture.show.runtime.currentBlockId=blocks[2].id
  fixture.show.runtime.currentBlockIndex=2
  fixture.show.runtime.roundControlMode='manual'
  fixture.show.runtime.currentRoundId='round-fixture-'+roundNo
  fixture.show.currentRound={
    id:'round-fixture-'+roundNo,roundNo,blockId:blocks[2].id,status:'active',
    flowStatus:'round_intro',pitchCount:1,questionTarget:roundNo%2===1?0:3,
    questionPosition:0,voteState:'closed',resultsVisible:false,videoState:{status:'idle'}
  }
  fixture.inventedFilms=[{id:'idea-1',userId:'guest-1',animalName:'кишка',title:'несуществующий фильм',description:'смешной и страшный',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]
  fixture.filmPackages=[{id:'pack-1',movieCandidateId:'movie-1',title:'проверочный фильм',status:'ready',fragments:[0,1,2,3].map(i=>({sourcePlatform:'direct',sourceUrl:'https://example.com/fixture.mp4',startSec:i*10,endSec:(i+1)*10})),questions:[1,2,3].map(i=>({id:'q-'+i,position:i,prompt:'что дальше?',options:[],correctAnswer:'да',revealText:'был дождь',revealFragment:{}}))}]
  fixture.projector={state:'round_intro',revision:1,payload:{roundNo}}
  await page.addInitScript(value=>{if(!localStorage.getItem('nasypateli-cinema-demo-v3'))localStorage.setItem('nasypateli-cinema-demo-v3',JSON.stringify(value))},fixture)
  try{
    await page.goto(origin+'#/admin/test-2026-10-03',{waitUntil:'domcontentloaded'})
    await page.locator('.manual-director-flow').waitFor({state:'visible',timeout:17000})
    if(await page.locator('.manual-director-stage').count()!==8)throw Error('Each manual stage must be visible')
    if(await page.getByRole('button',{name:'переключаю сама'}).getAttribute('aria-pressed')!=='true')throw Error('Manual mode must be selected')
    let clicked=0
    const doStep=async(label,expectedFlow)=>{
      const button=page.getByRole('button',{name:label,exact:false})
      await button.waitFor({state:'visible',timeout:12000})
      if(!await button.isEnabled())throw Error('Manual step disabled: '+label)
      await button.click()
      await page.waitForFunction(expected=>{
        const d=JSON.parse(localStorage.getItem('nasypateli-cinema-demo-v3')||'{}')
        return d.show?.currentRound?.flowStatus===expected
      },expectedFlow,{timeout:12000})
      clicked++
      // This suite exercises controls only. Playback and grading evidence is explicitly
      // simulated; the real reducer and database fences have separate regression tests.
      if(['playing_clip','question_reveal','question_results'].includes(expectedFlow)){
        await page.evaluate(flow=>{
          const key='nasypateli-cinema-demo-v3',d=JSON.parse(localStorage.getItem(key)||'{}')
          d.projector||={state:flow,revision:1,payload:{}}
          d.projector.payload||={}
          if(flow==='question_results')d.projector.payload.judgement={status:'decided',outcome:'none',method:'host',winnerIds:[]}
          else {
            const fragment=d.projector.payload.revealFragment||d.projector.payload.fragment||{startSec:0,endSec:10}
            d.projector.payload.fragment=fragment
            d.show.runtime.videoState={status:'ended',continuous:true,position:fragment.endSec,runId:d.show.runtime.runId,projectorRevision:d.projector.revision}
          }
          localStorage.setItem(key,JSON.stringify(d))
        },expectedFlow)
        await page.reload({waitUntil:'domcontentloaded'})
        await page.locator('.manual-director-flow').waitFor({state:'visible'})
      }
    }
    await doStep('открыть сбор названий','collecting_films')
    await doStep('закрыть сбор и показать идеи','films_locked')
    await doStep('показать первую идею','films_locked')
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('nasypateli-cinema-demo-v3')||'{}')?.projector?.state==='pitch_preview',null,{timeout:12000})
    await doStep('запустить рандом','submission_selected')
    await doStep('начать поиск фильма','movie_found')
    await doStep('показать фрагмент','playing_clip')
    if(roundNo===1){
      await doStep('запустить выбор животины','assignment_randomizing')
      await doStep('назвать выбранную животину','assignment_selected')
      await doStep('открыть рецензию одним словом','one_word_collecting')
      await doStep('показать результат рецензий','one_word_results')
    }else{
      for(let i=1;i<=3;i++){
        await doStep('открыть вопрос '+i+'/3','question_open')
        await doStep('закрыть ответы и оценить','question_results')
        await doStep('показать правильное продолжение','question_reveal')
      }
      await doStep('запустить выбор провидца','assignment_randomizing')
      await doStep('назвать выбранную животину','assignment_selected')
    }
    await doStep('завершить раунд','round_finished')
    const final=await page.evaluate(()=>JSON.parse(localStorage.getItem('nasypateli-cinema-demo-v3')||'{}'))
    if(final.show.currentRound.status!=='closed')throw Error('Finished round was not closed')
    const w=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}))
    if(w.scroll>w.width+4)throw Error('Manual director horizontal overflow '+JSON.stringify(w))
    await page.screenshot({path:'test-artifacts/manual-round-'+roundNo+'.png',fullPage:true})
    console.log('PASS manual director round '+roundNo+' ('+clicked+' individually confirmed stage clicks)')
  }finally{await page.close()}
}
try{
  await mkdir('test-artifacts',{recursive:true})
  await ready()
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  await director({width:390,height:844},'admin-test-idle-phone')
  await director({width:320,height:640},'admin-test-running-small','running')
  await director({width:1366,height:768},'admin-test-running-desktop','running')
  await director({width:390,height:844},'admin-test-manual-mode','paused')
  await director({width:390,height:844},'admin-live-idle-requires-audio','idle',false)
  await manualRoundSequence(1)
  await manualRoundSequence(2)
}catch(e){console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
