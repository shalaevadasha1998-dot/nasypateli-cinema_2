import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const origin='http://127.0.0.1:4175/nasypateli-cinema_2/'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4175','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
let browser

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
      runtime:{runKey:'test_002',isTest:test,runStatus:status,currentBlockId:'arrival',currentBlockIndex:0,currentBlock:blocks[0],currentRound:0,voteState:'closed',resultsVisible:false,videoState:{status:'idle'},revision:1},
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
  const page=await browser.newPage({viewport})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(value=>{localStorage.setItem('nasypateli-cinema-demo-v3',JSON.stringify(value))},fakeShow(status,test))
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
    if(errors.length)throw Error('JavaScript errors '+errors.join('; '))
    await page.screenshot({path:'test-artifacts/'+label+'.png',fullPage:true})
    console.log('PASS director '+label+' '+JSON.stringify(stats))
  }catch(error){
    console.error('DIRECTOR FAILURE '+label+' '+(await page.locator('body').innerText()).slice(0,1600))
    await page.screenshot({path:'test-artifacts/'+label+'-failure.png',fullPage:true})
    throw error
  }finally{await page.close()}
}
try{
  await mkdir('test-artifacts',{recursive:true})
  await ready()
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  await director({width:390,height:844},'admin-test-idle-phone')
  await director({width:320,height:640},'admin-test-running-small','running')
  await director({width:1366,height:768},'admin-test-running-desktop','running')
  await director({width:390,height:844},'admin-live-idle-requires-audio','idle',false)
}catch(e){console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
