import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const base='http://127.0.0.1:4173/nasypateli-cinema_2/'
const issues=[]
await mkdir('test-artifacts',{recursive:true})
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4173','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit',env:process.env})
let browser
async function ready(){
  for(let i=0;i<30;i++){
    try{const res=await fetch(base);if(res.ok)return}catch{}
    await new Promise(r=>setTimeout(r,500))
  }
  throw Error('Vite preview did not start')
}
async function caseRun(label,path,viewport,expected){
  const page=await browser.newPage({viewport,deviceScaleFactor:1})
  page.on('pageerror',e=>issues.push(label+': '+e.message))
  try{
    const response=await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:25000})
    if(!response?.ok())throw Error('HTTP '+response?.status())
    const element=page.locator(expected)
    try{await element.waitFor({state:'visible',timeout:30000})}
    catch(e){console.error(label+' visible body: '+(await page.locator('body').innerText()).slice(0,1500));await page.screenshot({path:'test-artifacts/'+label+'-failure.png',fullPage:true});throw e}
    const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}))
    if(dimensions.scroll>dimensions.viewport+5)throw Error('horizontal overflow '+JSON.stringify(dimensions))
    await page.screenshot({path:'test-artifacts/'+label+'.png',fullPage:true})
    console.log('PASS '+label+' '+JSON.stringify(dimensions))
  }finally{await page.close()}
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
  await caseRun('projector-arrival','#/screen/test-2026-10-03',{width:1920,height:1080},'.screen-creature-wall')
  await caseRun('mobile-telegram-entry','',{width:390,height:844},'.telegram-gate, .loading-page, .page')
  await caseRun('compact-mobile-entry','',{width:320,height:640},'.telegram-gate, .loading-page, .page')
  // Verify Telegram's compact deep link stays inside the isolated test route.
  const invitePage=await browser.newPage({viewport:{width:390,height:844}})
  try{
    await invitePage.goto(base+'?test_invite=t_'+ '0'.repeat(32),{waitUntil:'domcontentloaded'})
    await invitePage.waitForFunction(()=>location.hash.startsWith('#/rehearsal/test-2026-10-03?room='),{timeout:15000})
    console.log('PASS test-invite-route: deep link stayed in the test room')
  }finally{await invitePage.close()}
  if(issues.length)throw Error('Uncaught browser errors: '+issues.join(' | '))
  console.log('UI smoke passed: projector arrival, mobile & compact mobile')
}catch(e){console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
