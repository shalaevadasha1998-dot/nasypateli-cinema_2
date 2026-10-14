import { chromium, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const origin='http://127.0.0.1:4174/nasypateli-cinema_2/'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4174','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
let browser
async function newPage(options){
  const page=await browser.newPage(options)
  // The remote, parser-blocking Telegram SDK may stall GitHub-hosted Chromium.
  // UI smoke does not validate Telegram credentials: keep that in a real-device test.
  await page.route('**/telegram-web-app.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* telegram sdk skipped in browser-only ui smoke */'}))
  return page
}

async function ready(){
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}
  throw Error('Demo preview failed')
}
async function check(viewport,label){
  const page=await newPage({viewport})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  try{
    await page.goto(origin+'#/onboarding',{waitUntil:'domcontentloaded'})
    await page.locator('.onboarding-page').waitFor({timeout:15000})
    const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}))
    if(width.scroll>width.viewport+5)throw Error('Onboarding width overflow: '+JSON.stringify(width))
    await page.screenshot({path:'test-artifacts/'+label+'-welcome.png',fullPage:true})
    await page.getByRole('button',{name:'собрать мой кинопрофиль'}).click()
    await page.locator('.onboarding-body[data-step="1"]').waitFor({timeout:12000})
    const after=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}))
    if(after.scroll>after.viewport+5)throw Error('Onboarding fields overflow: '+JSON.stringify(after))
    if(errors.length)throw Error(errors.join('; '))
    await page.screenshot({path:'test-artifacts/'+label+'-profile.png',fullPage:true})
    console.log('PASS demo-onboarding '+label+' '+JSON.stringify(after))
  }catch(e){console.error(label+' body '+(await page.locator('body').innerText()).slice(0,1200));await page.screenshot({path:'test-artifacts/'+label+'-error.png',fullPage:true});throw e}
  finally{await page.close()}
}
try{
  await mkdir('test-artifacts',{recursive:true})
  await ready()
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  await check({width:390,height:844},'phone-390')
  await check({width:320,height:640},'phone-320')
  await check({width:1440,height:900},'desktop-1440')
  const android=await browser.newContext({...devices['Pixel 7']})
  const page=await android.newPage()
  // External Telegram SDK is not needed for UI-only Android browser checks.
  await page.route('**/telegram-web-app.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* browser smoke stub */'}))
  const problems=[]
  page.on('pageerror',e=>problems.push(e.message))
  try{
    await page.goto(origin+'#/test/2026-10-17',{waitUntil:'domcontentloaded'})
    await page.locator('.admin-rehearsal-hub').waitFor({state:'visible',timeout:14000})
    const roles=page.locator('.admin-rehearsal-roles button')
    if(await roles.count()!==3)throw Error('Admin hub must offer participant, director and projector modes')
    const geometry=await page.evaluate(()=>{
      const e=document.querySelector('.bottom-nav')
      return {screen:innerWidth,scroll:document.documentElement.scrollWidth,navClient:e?.clientWidth,navScroll:e?.scrollWidth}
    })
    if(geometry.scroll>geometry.screen+5)throw Error('Android document overflows '+JSON.stringify(geometry))
    if(geometry.navScroll>geometry.navClient+3)throw Error('Android navigation still requires horizontal scrolling '+JSON.stringify(geometry))
    const tabs=await page.locator('.bottom-nav a').count()
    if(tabs!==5)throw Error('Android guest navigation must show five tabs, found '+tabs)
    if(await page.locator('.bottom-nav a[href$="/test"]').count())throw Error('Admin tools visible in guest tabs')
    await page.screenshot({path:'test-artifacts/android-pixel-7-admin-roles.png',fullPage:true})
    await roles.first().click()
    await page.waitForURL('**/#/rehearsal/test-2026-10-03')
    if(problems.length)throw Error('Android javascript errors: '+problems.join('; '))
    console.log('PASS Android Pixel 7 test hub, navigation and participant route '+JSON.stringify(geometry))
  }finally{await android.close()}
}catch(e){console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
