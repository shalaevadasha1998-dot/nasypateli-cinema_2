import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import QRCode from 'qrcode'

const origin='http://127.0.0.1:4178/nasypateli-cinema_2/'
const token='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const another='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const invite='https://t.me/nasipateli_v_kinobot?start=encounter_'+token
const otherInvite='https://t.me/nasipateli_v_kinobot?start=encounter_'+another
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4178','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
let browser
let encounterCalls=0

async function ready(){
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}
  throw Error('QR smoke preview did not start')
}
async function check(viewport,label){
  const page=await browser.newPage({viewport,isMobile:viewport.width<500,hasTouch:true})
  await page.route('**/telegram-web-app.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* browser-only smoke */'}))
  await page.route('https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app',async route=>{
    const body=JSON.parse(route.request().postData()||'{}')
    if(body.action==='bootstrap')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      event:{id:'3a9631d2-03c0-42ae-b212-3b8e866ad1e8',slug:'2026-10-17',title:'насыпатели в кино',status:'SALES_OPEN',startsAt:'2026-10-17T13:00:00Z',ticketPriceRub:0,capacity:40,sold:1,held:0},
      profile:{completed:true,displayName:'тестовый человек'},onboardingComplete:true,registration:'none',creature:{born:true,name:'киношлёп',stage:'stage_1'}
    })})
    if(body.action==='my-encounter-token')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,token,deepLink:invite,expiresAt:'2026-11-13T13:00:00Z'})})
    if(body.action==='encounter'){
      encounterCalls++
      if(body.token!==another)return route.fulfill({status:403,contentType:'application/json',body:'{"error":"неверный токен"}'})
      return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"kind":"rabbit","sharedFavorites":2,"sharedGenres":1}'})
    }
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  })
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  try{
    await page.goto(origin+'#/',{waitUntil:'domcontentloaded',timeout:20000})
    await page.getByRole('button',{name:'встретить животин'}).waitFor({state:'visible',timeout:16000})
    await page.getByRole('button',{name:'встретить животин'}).click()
    await page.waitForURL('**/#/meet',{timeout:15000})
    await page.getByAltText('qr-код животины киношлёп').waitFor({state:'visible',timeout:12000})
    const pixels=await page.evaluate(()=>({width:document.documentElement.scrollWidth,screen:innerWidth,
      qrWidth:Math.round(document.querySelector('.meet-qr')?.getBoundingClientRect().width||0)}))
    if(pixels.width>pixels.screen+4)throw Error('Meet page horizontally overflows '+JSON.stringify(pixels))
    if(pixels.qrWidth<160)throw Error('QR code rendered too small '+JSON.stringify(pixels))
    const startCalls=encounterCalls
    await page.locator('#meet-qr-link').fill('nasypateli-ticket:v1:2026-10-17:12345678')
    await page.getByRole('button',{name:'встретить',exact:true}).click()
    await page.getByText('это не qr животины',{exact:false}).waitFor({timeout:6000})
    if(encounterCalls!==startCalls)throw Error('Ticket QR was sent as a creature encounter')
    await page.locator('#meet-qr-link').fill(invite)
    await page.getByRole('button',{name:'встретить',exact:true}).click()
    await page.getByText('это твоя животина',{exact:false}).waitFor({timeout:6000})
    if(encounterCalls!==startCalls)throw Error('Own QR reached encounter API')
    await page.locator('#meet-qr-link').fill(otherInvite)
    await page.getByRole('button',{name:'встретить',exact:true}).click()
    await page.getByRole('heading',{name:'уже знакомы'}).waitFor({state:'visible',timeout:7000})
    if(encounterCalls!==startCalls+1)throw Error('Expected one authenticated encounter request')
    const result=await page.locator('.meet-result').innerText()
    if(!result.includes('2')||!result.includes('1'))throw Error('Compatibility counts missing: '+result)
    await page.screenshot({path:'test-artifacts/'+label+'-creature-qr.png',fullPage:true})
    if(errors.length)throw Error('JavaScript errors: '+errors.join('; '))
    console.log('PASS creature-encounter '+label+' '+JSON.stringify(pixels))
  }catch(e){
    console.error('creature QR failure '+label,await page.locator('body').innerText().catch(()=>''))
    await page.screenshot({path:'test-artifacts/'+label+'-creature-qr-error.png',fullPage:true}).catch(()=>{})
    throw e
  }finally{await page.close()}
}
try{
  await mkdir('test-artifacts',{recursive:true})
  await ready()
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  await check({width:390,height:844},'mobile-390')
  await check({width:320,height:640},'mobile-320')
  await check({width:1280,height:900},'desktop-1280')
}catch(e){console.error(e);process.exitCode=1}
finally{await browser?.close();server.kill('SIGTERM')}
