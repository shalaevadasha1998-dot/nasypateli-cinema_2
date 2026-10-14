import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'

const origin='http://127.0.0.1:4176/nasypateli-cinema_2/'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4176','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
const testSlug='test-2026-10-03'
let browser

const scenarios=[
  {label:'android-pixel-7',viewport:{width:412,height:915},scale:2.625,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'},
  {label:'android-samsung-360',viewport:{width:360,height:740},scale:3,userAgent:'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'},
  {label:'android-compact-320',viewport:{width:320,height:640},scale:2.5,userAgent:'Mozilla/5.0 (Linux; Android 11; SM-A025F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'}
]
const blocks=[
  {id:'arrival',index:0,type:'arrival',title:'сбор гостей',durationMin:60,roundsTarget:0,autoAdvance:true,audioPlaylist:[],audioVolume:.28},
  {id:'feedback',index:1,type:'feedback',title:'что скажете о вечере?',durationMin:6,roundsTarget:0,autoAdvance:true,audioPlaylist:[],audioVolume:.18}
]
function fakeBootstrap(slug,stage){
  const isTest=slug===testSlug
  const block=blocks[stage==='feedback'?1:0]
  return {
    event:{id:'19b83043-f562-49f4-8f1c-2951bcee55d7',slug:isTest?testSlug:'2026-10-17',title:'насыпатели в кино',status:'CHECKIN',startsAt:'2026-10-17T13:00:00.000Z',capacity:40,sold:0,ticketPriceRub:0,nonexistentFilmEnabled:true},
    profile:{completed:true,displayName:'android tester'},onboardingComplete:true,
    registration:isTest?'attended':'paid',creature:{born:true,name:'чупакабра',stage:'stage_2'},
    show:{runtime:{runKey:'test_android',isTest,runStatus:stage==='feedback'?'running':'idle',
      currentBlockId:block.id,currentBlockIndex:block.index,currentBlock:block,currentRound:0,revision:1,voteState:'closed',resultsVisible:false,videoState:{status:'idle'}},
      program:{version:1,roundsTarget:4,blocks,rewards:{join:1,vote:1,round:2,finale:3}},voteResults:[],onlineCount:1},
    filmLive:null
  }
}
async function ready(){
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}
  throw Error('Android preview server failed')
}
async function check(config,stage){
  const context=await browser.newContext({viewport:config.viewport,deviceScaleFactor:config.scale,isMobile:true,hasTouch:true,userAgent:config.userAgent})
  const page=await context.newPage()
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  let sentFeedback=false
  await page.route('https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app',async route=>{
    const body=JSON.parse(route.request().postData()||'{}')
    if(body.action==='bootstrap')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fakeBootstrap(body.slug,stage))})
    if(body.action==='live-refresh')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({eventStatus:'CHECKIN',runtime:fakeBootstrap(testSlug,stage).show.runtime})})
    if(body.action==='submit-feedback'){sentFeedback=true;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})})}
    return route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})
  })
  try{
    const label=config.label+'-'+stage
    await page.goto(origin+'#/',{waitUntil:'domcontentloaded'})
    const shortcut=page.getByRole('button',{name:'войти в тестовую комнату'})
    await shortcut.waitFor({state:'visible',timeout:16000})
    await shortcut.tap()
    await page.waitForURL('**/#/test',{timeout:12000})
    const tab=page.locator('.bottom-nav a[href$="/test"]')
    await tab.waitFor({state:'visible'})
    await page.getByRole('button',{name:'войти как участник'}).tap()
    await page.waitForURL('**/#/rehearsal/'+testSlug,{timeout:12000})
    await page.getByText('тестовый вечер',{exact:true}).first().waitFor({timeout:16000})
    if(stage==='feedback'){
      await page.getByText('как вам вечер?',{exact:true}).waitFor({timeout:12000})
      await page.locator('.feedback-show textarea').first().fill('больше фильмов и необычных заданий')
      await page.locator('.feedback-show').getByRole('button',{name:'отправить'}).tap()
      await page.locator('.feedback-show [role="status"]').waitFor({state:'visible',timeout:15000})
      if(!sentFeedback)throw Error('Feedback submit did not reach API')
    }
    const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth,
      screenScroll:document.body.scrollWidth,touch:'ontouchstart' in window,ua:navigator.userAgent}))
    if(dimensions.scroll>dimensions.viewport+5)throw Error('horizontal overflow: '+JSON.stringify(dimensions))
    if(!dimensions.touch)throw Error('touch not detected')
    if(errors.length)throw Error('JavaScript errors: '+errors.join('; '))
    await page.screenshot({path:'test-artifacts/'+label+'.png',fullPage:true})
    console.log('PASS '+label+' '+JSON.stringify({width:dimensions.viewport,scroll:dimensions.scroll,touch:dimensions.touch,feedback:sentFeedback}))
  }catch(err){await page.screenshot({path:'test-artifacts/'+config.label+'-'+stage+'-failure.png',fullPage:true});console.error('ANDROID FAIL',config.label,stage,(await page.locator('body').innerText()).slice(0,1100));throw err}
  finally{await context.close()}
}
try{
  await mkdir('test-artifacts',{recursive:true})
  await ready();browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  for(const config of scenarios)await check(config,'arrival')
  for(const config of scenarios.slice(0,2))await check(config,'feedback')
}catch(e){console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
