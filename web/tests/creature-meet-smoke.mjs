import { chromium,devices } from 'playwright'
import QRCode from 'qrcode'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const origin='http://127.0.0.1:4178/nasypateli-cinema_2/'
const endpoint='https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app'
const own='a'.repeat(32),other='b'.repeat(32)
const ownLink='https://t.me/nasipateli_v_kinobot?start=encounter_'+own
const otherLink='https://t.me/nasipateli_v_kinobot?start=encounter_'+other
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4178','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
let browser,connections=0
async function ready(){
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}
  throw Error('Meet preview did not start')
}
async function makePage(viewport){
  const context=await browser.newContext({viewport,hasTouch:true,isMobile:true,deviceScaleFactor:2,userAgent:devices['Pixel 7'].userAgent})
  const page=await context.newPage()
  await page.route('**/telegram-web-app.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* real telegram credentials are not tested */'}))
  await page.route(endpoint,async route=>{
    const body=JSON.parse(route.request().postData()||'{}')
    if(body.action==='bootstrap')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      event:{id:'event-1',slug:'test-2026-10-03',status:'CHECKIN',startsAt:'2026-10-17T13:00:00Z',capacity:30,sold:0,ticketPriceRub:0},
      profile:{displayName:'гость',completed:true},onboardingComplete:true,
      creature:{born:true,name:'чупакабра',stage:'stage_2'},registration:'attended'
    })})
    if(body.action==='my-encounter-token')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:own,deepLink:ownLink,expiresAt:'2026-11-14T00:00:00Z'})})
    if(body.action==='my-encounters')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,encounters:connections?[{creatureName:'пломбир',metAt:'2026-10-14T12:00:00Z',sharedFavorites:2,sharedGenres:1}]:[]})})
    if(body.action==='encounter'){
      if(body.token!==other)return route.fulfill({status:409,contentType:'application/json',body:'{"error":"это qr вашей собственной животины"}'})
      connections++
      return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"kind":"rabbit","sharedFavorites":2,"sharedGenres":1}'})
    }
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  })
  return {page,context}
}
async function test(viewport,label,photo=false){
  const {page,context}=await makePage(viewport)
  const errors=[]
  page.on('pageerror',e=>errors.push(String(e.message)))
  try{
    await page.goto(origin+'#/meet',{waitUntil:'domcontentloaded',timeout:20000})
    await page.getByRole('heading',{name:/знакомиться/i}).waitFor({timeout:18000})
    await page.getByAltText('qr-код знакомства животин').waitFor({timeout:18000})
    await page.getByRole('button',{name:'сканировать'}).click()
    await page.getByText('сканер животин',{exact:true}).waitFor()
    // A ticket QR must not call the encounter endpoint.
    await page.getByLabel('или вставь ссылку на животину').count().catch(()=>{})
    await page.locator('#meet-paste').fill('nasypateli-ticket:v1:17:random')
    await page.getByRole('button',{name:'проверить'}).click()
    await page.getByText(/это не qr животины/).waitFor()
    await page.locator('#meet-paste').fill(ownLink)
    await page.getByRole('button',{name:'проверить'}).click()
    await page.getByRole('heading',{name:'познакомить животин?'}).waitFor()
    await page.getByRole('button',{name:'отменить'}).click()
    if(photo){
      const buffer=await QRCode.toBuffer(otherLink,{width:500,errorCorrectionLevel:'M'})
      await page.locator('#meet-photo-input').setInputFiles({name:'animal-qr.png',mimeType:'image/png',buffer})
    }else{
      await page.locator('#meet-paste').fill(otherLink)
      await page.getByRole('button',{name:'проверить'}).click()
    }
    await page.getByRole('heading',{name:'познакомить животин?'}).waitFor({timeout:15000})
    await page.getByRole('button',{name:'да, познакомить'}).click()
    await page.getByRole('heading',{name:'животины встретились'}).waitFor({timeout:15000})
    await page.getByRole('heading',{name:'пломбир'}).waitFor({timeout:15000})
    const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}))
    if(dimensions.scroll>dimensions.viewport+3)throw Error('mobile overflow '+JSON.stringify(dimensions))
    if(errors.length)throw Error('js errors: '+errors.join(' ; '))
    await page.screenshot({path:'test-artifacts/creature-meet-'+label+'.png',fullPage:true})
    console.log('PASS creature-meet '+label+' '+JSON.stringify(dimensions))
  }finally{await context.close()}
}
try{
  await mkdir('test-artifacts',{recursive:true});await ready()
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  await test({width:412,height:915},'pixel-7',false)
  await test({width:320,height:640},'compact-gallery',true)
  // A Telegram encounter deep link must show consent rather than auto-save.
  const before=connections
  const {page,context}=await makePage({width:390,height:844})
  try{
    await page.goto(origin+'?encounter='+other+'#/',{waitUntil:'domcontentloaded',timeout:20000})
    await page.getByRole('heading',{name:'познакомить животин?'}).waitFor({timeout:18000})
    if(connections!==before)throw Error('Telegram deep link saved a meeting before confirmation')
    await page.getByRole('button',{name:'да, познакомить'}).click()
    await page.getByRole('heading',{name:'животины встретились'}).waitFor({timeout:15000})
    if(connections!==before+1)throw Error('Confirmed Telegram deep link did not save exactly once')
    console.log('PASS telegram-deeplink explicit animal consent')
  }finally{await context.close()}
}catch(e){console.error('CREATURE MEET FAIL',e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
