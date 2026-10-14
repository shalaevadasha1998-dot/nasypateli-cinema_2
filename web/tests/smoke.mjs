import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const base='http://127.0.0.1:4173/nasypateli-cinema_2/'
const issues=[]
await mkdir('test-artifacts',{recursive:true})
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4173','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit',env:process.env})
let browser
async function newPage(options){
  const page=await browser.newPage(options)
  // The remote, parser-blocking Telegram SDK may stall GitHub-hosted Chromium.
  // UI smoke does not validate Telegram credentials: keep that in a real-device test.
  await page.route('**/telegram-web-app.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* telegram sdk skipped in browser-only ui smoke */'}))
  await page.route('https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app',async route=>{
    const body=JSON.parse(route.request().postData()||'{}')
    if(body.action==='screen-bootstrap'){
      const fixture={
        event:{id:'test-screen',slug:'test-2026-10-03',title:'служебная репетиция',status:'CHECKIN',startsAt:'2026-10-17T13:00:00Z'},
        show:{runtime:{runStatus:'running',currentBlockId:'arrival',currentBlock:{id:'arrival',type:'arrival',title:'сбор гостей',durationMin:60},currentBlockIndex:0,currentRound:0,revision:1},
          program:{blocks:[{id:'arrival',type:'arrival',title:'сбор гостей',durationMin:60}],roundsTarget:1,rewards:{join:0,vote:0,round:0,finale:0}},audio:{state:{status:'stopped',mode:'auto'},assets:[],screen:{online:false,unlocked:false}}},
        projector:{state:'arrival',revision:1,payload:{}},screenCreatures:[],screenMessage:''
      }
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)})
    }
    if(body.action==='screen-audio-heartbeat'||body.action==='screen-audio-ended')return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"owner":true}'})
    return route.continue()
  })
  return page
}

async function ready(){
  for(let i=0;i<30;i++){
    try{const res=await fetch(base);if(res.ok)return}catch{}
    await new Promise(r=>setTimeout(r,500))
  }
  throw Error('Vite preview did not start')
}
async function caseRun(label,path,viewport,expected){
  let lastError
  // Hosted Chromium occasionally stalls before the initial DOM is committed.
  // Retry a completely fresh page, but never suppress a real reproducible error.
  for(let attempt=1;attempt<=3;attempt++){
    const page=await newPage({viewport,deviceScaleFactor:1})
    const pageErrors=[]
    page.on('pageerror',e=>pageErrors.push(e.message))
    try{
      const response=await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:20000})
      if(!response?.ok())throw Error('HTTP '+response?.status())
      await page.locator(expected).waitFor({state:'visible',timeout:20000})
      const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}))
      if(dimensions.scroll>dimensions.viewport+5)throw Error('horizontal overflow '+JSON.stringify(dimensions))
      if(pageErrors.length)throw Error('Uncaught errors: '+pageErrors.join(' | '))
      await page.screenshot({path:'test-artifacts/'+label+'.png',fullPage:true,timeout:20000})
      console.log('PASS '+label+' '+JSON.stringify(dimensions))
      return
    }catch(error){
      lastError=error
      console.warn('RETRY '+label+' attempt '+attempt+': '+String(error).slice(0,420))
      if(attempt===3){
        try{console.error(label+' screen: '+(await page.locator('body').innerText({timeout:2500})).slice(0,1500))}catch{}
        try{await page.screenshot({path:'test-artifacts/'+label+'-failure.png',fullPage:true,timeout:4500})}catch{}
      }
    }finally{await page.close().catch(()=>{})}
    await new Promise(resolve=>setTimeout(resolve,900))
  }
  throw lastError
}

try{
  await ready()
  const audioBase='https://vwteokawtqnoiyzmsldj.supabase.co/storage/v1/object/public/event-media/audio/'
  const samples=['calm-exactly.mp3','creature-3.wav','energy-talk.mp3']
  for(const filename of samples){
    const response=await fetch(audioBase+filename,{method:'HEAD',signal:AbortSignal.timeout(12000)})
    if(!response.ok)throw Error('Audio file unavailable: '+filename+' HTTP '+response.status)
    console.log('PASS audio-resource '+filename+' '+response.headers.get('content-type'))
  }
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  // The live test room may currently show a round, not arrival. Verify screen readiness
  // regardless of its state; arrivals are tested with ?demo=animals below.
  await caseRun('projector-arrival','#/screen/test-2026-10-03?token=ci-screen',{width:1920,height:1080},'.screen-page .screen-content')
  await caseRun('projector-arrival-720p','#/screen/test-2026-10-03?token=ci-screen',{width:1280,height:720},'.screen-page .screen-content')
  await caseRun('projector-arrival-small','#/screen/test-2026-10-03?token=ci-screen',{width:1024,height:600},'.screen-page .screen-content')
  await caseRun('mobile-telegram-entry','',{width:390,height:844},'.telegram-gate, .loading-page, .page')
  await caseRun('compact-mobile-entry','',{width:320,height:640},'.telegram-gate, .loading-page, .page')
  // Exercise the long intro card without changing server/database state.
  for(const viewport of [{width:1280,height:720},{width:1024,height:600},{width:390,height:640}]){
    const page=await newPage({viewport})
    const width=viewport.width,height=viewport.height
    await page.route('https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app',async route=>{
      const request=route.request()
      const action=JSON.parse(request.postData()||'{}').action
      if(action==='screen-bootstrap'){
        const mocked={
          event:{id:'test-event',slug:'test-2026-10-03',status:'CHECKIN',startsAt:'2026-10-17T13:00:00Z'},
          show:{
            runtime:{isTest:true,runKey:'test_preview',runStatus:'running',currentBlockId:'cinema_first',
              currentBlock:{id:'cinema_first',type:'cinema_rounds',title:'снимаем кино',durationMin:75},
              currentBlockIndex:2,currentRound:1,revision:1,voteState:'closed',resultsVisible:false,videoState:{}},
            program:{version:1,roundsTarget:4,blocks:[],rewards:{join:1,vote:1,round:1,finale:1}},
            audio:{state:{mode:'auto',status:'stopped',volume:.2},assets:[],screen:{online:false,unlocked:false}}
          },
          projector:{state:'round_intro',revision:2,updatedAt:new Date().toISOString(),payload:{roundNo:1,opensAt:new Date(Date.now()+300000).toISOString()}},
          screenCreatures:[],screenMessage:''
        }
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(mocked)})
      }else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,owner:true})})
    })
    try{
      await page.goto(base+'#/screen/test-2026-10-03?token=ci-screen',{waitUntil:'domcontentloaded'})
      await page.locator('.screen-round-intro').waitFor({state:'visible',timeout:13000})
      const geometry=await page.evaluate(()=>{
        const rect=selector=>{const {top,right,bottom,left}=document.querySelector(selector).getBoundingClientRect();return {top,right,bottom,left}}
        return {header:rect('.screen-header'),notices:rect('.screen-notices'),body:rect('.screen-content'),footer:rect('.screen-footer'),
          scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,scrollHeight:document.querySelector('.screen-content').scrollHeight}
      })
      if(geometry.scrollWidth>geometry.viewport+5)throw Error('Projector horizontal overflow '+JSON.stringify(geometry))
      if(geometry.header.bottom>geometry.notices.top+2||geometry.notices.bottom>geometry.body.top+2||geometry.body.bottom>geometry.footer.top+2){
        throw Error('Projector header/notice/body overlap '+JSON.stringify(geometry))
      }
      await page.screenshot({path:'test-artifacts/projector-intro-'+width+'x'+height+'.png',fullPage:true})
      console.log('PASS projector-intro '+width+'x'+height+' '+JSON.stringify({scrollWidth:geometry.scrollWidth,scrollHeight:geometry.scrollHeight}))
    }finally{await page.close()}
  }
  // Animate arrivals in an isolated preview. It does not mutate live check-ins.
  const animalsPage=await newPage({viewport:{width:1920,height:1080}})
  try{
    await animalsPage.goto(base+'#/screen/test-2026-10-03?token=ci-screen&demo=animals',{waitUntil:'domcontentloaded'})
    await animalsPage.waitForFunction(()=>document.querySelectorAll('.screen-creature-card').length===12,null,{timeout:25000})
    const animals=await animalsPage.locator('.screen-creature-card').count()
    if(animals!==12)throw Error('Creature preview failed to render all arrivals')
    await animalsPage.screenshot({path:'test-artifacts/projector-creature-arrivals.png',fullPage:true})
    console.log('PASS creature-arrivals '+animals+' animated animals')
  }finally{await animalsPage.close()}
  // One stable Telegram /start test link must route directly to the rehearsal.
  const stableLinkPage=await newPage({viewport:{width:390,height:844}})
  try{
    await stableLinkPage.goto(base+'?tgWebAppStartParam=test',{waitUntil:'domcontentloaded'})
    await stableLinkPage.waitForFunction(()=>location.hash.startsWith('#/test/2026-10-17'),{timeout:15000})
    console.log('PASS admin-only test-telegram-deeplink')
  }finally{await stableLinkPage.close()}
  // A private full rehearsal must land on the real ticket page, not the test room.
  const privatePage=await newPage({viewport:{width:390,height:844}})
  try{
    await privatePage.goto(base+'?tgWebAppStartParam=private_private-live-20261014-7c2f4a9b',{waitUntil:'domcontentloaded'})
    await privatePage.waitForFunction(()=>location.hash.startsWith('#/private/private-live-20261014-7c2f4a9b'),null,{timeout:15000})
    console.log('PASS telegram-private-live-ticket-deeplink')
  }finally{await privatePage.close()}
  // Verify Telegram's compact deep link stays inside the isolated test route.
  const invitePage=await newPage({viewport:{width:390,height:844}})
  try{
    await invitePage.goto(base+'?test_invite=t_'+ '0'.repeat(32),{waitUntil:'domcontentloaded'})
    await invitePage.waitForFunction(()=>location.hash.startsWith('#/test/2026-10-17'),{timeout:15000})
    console.log('PASS retired test invite cannot grant participant access')
  }finally{await invitePage.close()}
  if(issues.length)throw Error('Uncaught browser errors: '+issues.join(' | '))
  console.log('UI smoke passed: projector arrival, mobile & compact mobile')
}catch(e){console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
