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
  // The external Telegram SDK sometimes hangs in CI and blocks DOMContentLoaded.
  // Mock it only in browser-only smoke; this never tests real Telegram authorization.
  await page.route('**/telegram-web-app.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:'/* telegram sdk skipped in browser-only ui smoke */'}))
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
    await page.locator('.bottom-nav').waitFor({state:'visible',timeout:16000})
    const navGeometry=await page.evaluate(()=>{
      const links=[...document.querySelectorAll('.bottom-nav a')].map(a=>({text:a.textContent||'',x:a.getBoundingClientRect().x,right:a.getBoundingClientRect().right}))
      return {links,viewport:innerWidth,navScroll:document.querySelector('.bottom-nav')?.scrollWidth,navClient:document.querySelector('.bottom-nav')?.clientWidth}
    })
    if(navGeometry.links.length!==5||navGeometry.links.some(x=>x.x<0||x.right>navGeometry.viewport+1))throw Error('Android five-tab navigation clipped '+JSON.stringify(navGeometry))
    if(navGeometry.navScroll>navGeometry.navClient+2)throw Error('Android nav requires hidden horizontal swipe '+JSON.stringify(navGeometry))
    if(await page.locator('.bottom-nav a[href$="/test"]').count())throw Error('Admin test leaked into guest navigation')
    const testLinks=await page.getByRole('button',{name:/войти в тестовую комнату|проверить весь вечер/}).count()
    if(testLinks>0)throw Error('Admin rehearsal promoted to regular guest')
    // A real finger drag must move a long guest screen. No fixed-height shell may trap it.
    const before=await page.evaluate(()=>scrollY)
    const maxScroll=await page.evaluate(()=>document.documentElement.scrollHeight-innerHeight)
    if(maxScroll>70){
      await page.evaluate(()=>scrollTo(0,Math.max(120,document.documentElement.scrollHeight)))
      await page.waitForTimeout(150)
      const after=await page.evaluate(()=>scrollY)
      if(after<=before+30)throw Error('Android page cannot scroll vertically '+JSON.stringify({before,after,maxScroll}))
      await page.evaluate(()=>scrollTo(0,0))
    }
    if(stage==='feedback'){
      await page.goto(origin+'#/rehearsal/'+testSlug,{waitUntil:'domcontentloaded'})
      await page.getByText('как вам вечер?',{exact:true}).waitFor({timeout:12000})
      await page.locator('.feedback-show textarea').first().fill('больше фильмов и необычных заданий')
      await page.locator('.feedback-show').getByRole('button',{name:'отправить'}).tap()
      await page.locator('.feedback-show [role="status"]').waitFor({state:'visible',timeout:15000})
      if(!sentFeedback)throw Error('Feedback submit did not reach API')
    }
    const typography=await page.evaluate(async()=>{
      await document.fonts.ready
      const loaded=await document.fonts.load('400 16px "IBM Plex Mono"','Широкий экран')
      const canvas=document.createElement('canvas').getContext('2d')
      canvas.font='400 16px "IBM Plex Mono"'
      return {loaded:loaded.length>0,family:getComputedStyle(document.body).fontFamily,
        narrow:canvas.measureText('iiii').width,wide:canvas.measureText('ШШШШ').width}
    })
    if(!typography.loaded||!typography.family.includes('IBM Plex Mono')||Math.abs(typography.narrow-typography.wide)>.1)
      throw Error('Cyrillic cinematic font did not load: '+JSON.stringify(typography))
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
