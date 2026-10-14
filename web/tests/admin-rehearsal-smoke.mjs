import {chromium,devices} from 'playwright'
import QRCode from 'qrcode'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'

const origin='http://127.0.0.1:4181/nasypateli-cinema_2/'
const slug='test-2026-10-17'
const ticket='nasypateli-ticket:v1:'+slug+':'+ '9d1acf37-f3f2-458b-a941-bc1048e2c32b'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4181','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
let browser,checkins=0
async function ready(){
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}
  throw Error('Preview did not start')
}
function fixture(source='2026-10-17'){
  return {
    isAdmin:true,
    event:{id:'37f64cb9-3847-4693-a3d7-c4c675312738',slug:source,title:'насыпатели в кино · 17 октября',status:'CHECKIN',startsAt:'2026-10-17T13:00:00Z',capacity:20,sold:0},
    show:{runtime:{runStatus:'idle',currentBlockId:'arrival',currentBlockIndex:0,currentBlock:{id:'arrival',type:'arrival',title:'сбор гостей',durationMin:60},currentRound:0,revision:1},
      program:{version:1,blocks:[{id:'arrival',type:'arrival',title:'сбор гостей',durationMin:60}],roundsTarget:4,rewards:{join:0,vote:0,round:0,finale:0}},onlineCount:0},
    adminParticipants:[],movieCatalog:[],filmPackages:[],reviewQueue:[]
  }
}
async function newPage(admin,viewport){
  const context=await browser.newContext({viewport,hasTouch:true,isMobile:true,userAgent:devices['Pixel 7'].userAgent})
  const page=await context.newPage()
  await page.route('**/telegram-web-app.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* browser-only test */'}))
  await page.route('https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app',async route=>{
    const body=JSON.parse(route.request().postData()||'{}')
    if(body.action==='admin-bootstrap')return route.fulfill({status:admin?200:403,contentType:'application/json',body:JSON.stringify(admin?fixture(body.slug):{error:'Доступ к пульту запрещён'})})
    if(body.action==='admin-checkin-ticket'){
      if(!admin)return route.fulfill({status:403,contentType:'application/json',body:'{"error":"Недостаточно прав"}'})
      if(body.ticketQr!==ticket)return route.fulfill({status:422,contentType:'application/json',body:'{"error":"QR билета не распознан"}'})
      checkins++
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,alreadyAttended:checkins>1,attendeeCount:1,displayName:'тестовый участник',creatureName:'хрюндель',creatureStage:'stage_1',visualVariant:1})})
    }
    if(body.action==='admin-screen-link')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({screenUrl:origin+'#/screen/'+slug+'?token=from-admin'})})
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  })
  return {page,context}
}
try{
  await mkdir('test-artifacts',{recursive:true});await ready()
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  // This verifies UI gating, not an actual server authentication test.
  const guest=await newPage(false,{width:360,height:760})
  try{
    await guest.page.goto(origin+'#/test/2026-10-17',{waitUntil:'domcontentloaded'})
    await guest.page.locator('.rehearsal-locked').waitFor({timeout:14000})
    if(await guest.page.locator('.admin-rehearsal-roles').count())throw Error('Guest can choose test-room role')
    await guest.page.goto(origin+'#/screen/'+slug,{waitUntil:'domcontentloaded'})
    await guest.page.getByText('нужен закрытый ключ экрана').waitFor({timeout:14000})
    console.log('PASS test hub locked and projector requires token')
  }finally{await guest.context.close()}
  const admin=await newPage(true,{width:360,height:760})
  try{
    await admin.page.goto(origin+'#/test/2026-10-17',{waitUntil:'domcontentloaded'})
    await admin.page.locator('.admin-rehearsal-hub').waitFor({timeout:14000})
    const buttons=admin.page.locator('.admin-rehearsal-roles button')
    if(await buttons.count()!==3)throw Error('Missing three roles')
    const bounds=await admin.page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}))
    if(bounds.scroll>bounds.width+3)throw Error('Android rehearsal overflows '+JSON.stringify(bounds))
    await admin.page.screenshot({path:'test-artifacts/admin-roles-360.png',fullPage:true})
    await buttons.nth(1).click()
    await admin.page.waitForURL('**/#/admin/test-2026-10-17')
    await admin.page.getByRole('button',{name:/сканировать qr билета/}).waitFor({timeout:15000})
    await admin.page.getByRole('button',{name:/сканировать qr билета/}).click()
    await admin.page.waitForURL('**/#/admin/checkin/test-2026-10-17')
    await admin.page.getByRole('heading',{name:/впускаем/}).waitFor({timeout:14000})
    const png=await QRCode.toBuffer(ticket,{width:450,errorCorrectionLevel:'M'})
    await admin.page.locator('.admin-checkin-upload input').setInputFiles({name:'ticket.png',mimeType:'image/png',buffer:png})
    await admin.page.getByText('готово. животина появилась на экране').waitFor({timeout:15000})
    await admin.page.getByText('хрюндель').waitFor({timeout:15000})
    // Scanner intentionally debounces the same QR for 2.5 seconds.
    await admin.page.waitForTimeout(2700)
    await admin.page.locator('.admin-checkin-manual input').fill(ticket)
    await admin.page.getByRole('button',{name:'отметить вход'}).click()
    await admin.page.getByText('уже отмечен. животина уже на экране').waitFor({timeout:15000})
    if(checkins!==2)throw Error('Check-in requests '+checkins)
    await admin.page.screenshot({path:'test-artifacts/admin-ticket-scanner-360.png',fullPage:true})
    console.log('PASS admin 3 roles, gallery ticket QR, one arrival and repeated scan')
  }catch(error){console.error(await admin.page.locator('body').innerText());await admin.page.screenshot({path:'test-artifacts/admin-scanner-failure.png',fullPage:true});throw error}finally{await admin.context.close()}
}catch(e){console.error('ADMIN REHEARSAL SMOKE FAIL',e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
