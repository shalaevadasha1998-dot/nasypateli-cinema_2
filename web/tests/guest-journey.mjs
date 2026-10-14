import {fileURLToPath} from 'node:url'
process.chdir(fileURLToPath(new URL('..',import.meta.url)))
import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import {initialDemoState} from '../src/demo.ts'
const base='http://127.0.0.1:4184/nasypateli-cinema_2/'
const api='https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4184','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
const assert=(x,m)=>{if(!x)throw Error(m)}
let browser
const privateSlug='private-audit-invite'
let state=structuredClone(initialDemoState),failBootstrap=true,failProgress=true,failDating=true,failChat=true,chatRequestId=''
state.event={...state.event,slug:privateSlug,title:'закрытый тестовый вечер',status:'SALES_OPEN',ticketPriceRub:0,startsAt:'2027-10-17T13:00:00Z',capacity:20,sold:0,paymentsAvailable:false}
state.isAdmin=false
try{
 await mkdir('test-artifacts',{recursive:true})
 for(let i=0;i<40;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
 browser=await chromium.launch({headless:true})
 const context=await browser.newContext({viewport:{width:360,height:780},isMobile:true,hasTouch:true,reducedMotion:'reduce'})
 const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'test-fixture',HapticFeedback:{impactOccurred(){throw Error('unsupported haptics')},notificationOccurred(){throw Error('unsupported haptics')}}}}})
 await page.route('**/telegram-web-app.js*',r=>r.fulfill({body:'/* isolated fixture */',contentType:'application/javascript'}))
 await page.route(api,async r=>{
  const body=JSON.parse(r.request().postData()||'{}');let data={ok:true},status=200
  if(body.action==='bootstrap'){
   if(failBootstrap){failBootstrap=false;status=503;data={error:'сервер временно недоступен'}}else data=state
  }else if(body.action==='save-profile-progress'){
   if(failProgress&&body.step===2){failProgress=false;status=503;data={error:'не получилось сохранить профиль'}}
   else state.profile={...state.profile,...body.profile,onboardingStep:body.step}
  }else if(body.action==='save-profile'){state.profile={...body.profile,completed:true};state.onboardingComplete=true}
  else if(body.action==='birth-creature'){state.creature={...state.creature,born:true,name:body.name}}
  else if(body.action==='claim-event-ticket'){assert(body.slug===privateSlug,'Ticket targeted wrong event');state.registration='paid';state.registrationId='33333333-3333-4333-8333-333333333333';data={ok:true,status:'paid'}}
  else if(body.action==='save-dating-profile'){
   if(failDating){failDating=false;status=503;data={error:'настройки не сохранены. повторите'}}else state.dating={...state.dating,...body.dating}
  }else if(body.action==='save-notification-prefs'){state.notificationPrefs=body.prefs}
  else if(body.action==='jipitina-chat'){
   if(failChat){failChat=false;chatRequestId=body.requestId;status=503;data={error:'чат временно недоступен'}}
   else{assert(body.requestId===chatRequestId,'Chat retry lost idempotency key');data={ok:true,reply:'давай обсудим кино'}}
  }
  else if(body.action.startsWith('admin-')){status=403;data={error:'Доступ к пульту запрещён'}}
  else if(body.action==='live-refresh')data={}
  else throw Error('Unhandled fixture action '+body.action)
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
 })
 try{
  await page.goto(base+'#/private/'+privateSlug,{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'попробовать ещё раз'}).click()
  await page.getByRole('button',{name:'собрать мой кинопрофиль'}).click()
  const next=()=>page.getByRole('button',{name:'дальше',exact:true}).click()
  await next();await page.locator('.form-error').waitFor();assert(state.profile.onboardingStep===1,'Validation was skipped')
  await page.getByLabel('как вас называть').fill('тестовый гость')
  await page.getByRole('button',{name:'женский род',exact:true}).click()
  await page.getByLabel('возраст',{exact:true}).selectOption('25-34')
  await page.getByLabel('город',{exact:true}).fill('москва')
  await page.getByLabel(/одна строка о себе/).fill('люблю странное кино')
  await next();await page.getByText('не получилось сохранить профиль',{exact:true}).waitFor()
  assert(await page.getByLabel('как вас называть').inputValue()==='тестовый гость','Lost form after save failure')
  await next()
  await page.getByLabel(/минимум 3 любимых фильма/).fill('сталкер\nамели\nпаразиты')
  await page.getByLabel(/любимые жанры/).fill('драма, фантастика')
  await page.getByLabel('последний фильм, который реально понравился').fill('амели');await next()
  await page.getByLabel('фильм, который вам вообще не понравился').fill('тестовый фильм')
  await page.getByLabel(/что вам почти точно не стоит показывать/).fill('скримеры');await next();await next()
  await page.getByRole('button',{name:'подумать после',exact:true}).click();await next()
  await page.getByRole('button',{name:'хочу всё',exact:true}).click()
  await page.locator('.choice-question').filter({hasText:'можно снимать'}).getByRole('button',{name:'нет',exact:true}).click()
  for(const box of await page.getByRole('checkbox').all())await box.check()
  await page.getByRole('button',{name:'прочитать правила',exact:true}).click()
  await page.getByRole('button',{name:/назад/}).click()
  await page.locator('.onboarding-body[data-step="6"]').waitFor()
  assert(await page.getByRole('checkbox').first().isChecked(),'Consent lost after rules')
  await next();await page.getByRole('button',{name:'войти в клуб',exact:true}).click()
  await page.getByLabel('имя животины').fill('киноша')
  await page.getByRole('button',{name:'это её имя',exact:true}).click()
  await page.waitForURL('**/#/private/'+privateSlug)
  await page.locator('.home-event-ticket').waitFor()
  assert(!await page.locator('.admin-entry-link').count(),'Guest sees admin entry')
  await page.getByRole('button',{name:/получить билет|зарегистрироваться/}).first().click()
  await page.locator('.event-pass').waitFor({timeout:15000})
  assert(state.registration==='paid','Free ticket was not issued')
  console.log('PASS complete onboarding, validation, save recovery, rules return, birth and private ticket')
  for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844})
   for(const path of ['/','/profile','/archive','/dating','/notifications','/zhivotina']){
    await page.goto(base+'#'+path,{waitUntil:'domcontentloaded'})
    await page.locator('.bottom-nav a').first().waitFor();await page.waitForTimeout(150);await page.evaluate(()=>document.fonts.ready)
    const d=await page.evaluate(()=>({w:innerWidth,s:document.documentElement.scrollWidth}))
    assert(d.s<=d.w+3,`${path} overflow at ${width}: ${d.s}`)
    assert(await page.locator('.bottom-nav a').count()===5,'Five tabs missing')
   }
  }
  await page.setViewportSize({width:360,height:780})
  await page.goto(base+'#/dating',{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'женщина',exact:true}).click()
  await page.getByRole('button',{name:'всех',exact:true}).click()
  await page.locator('.chips').last().getByRole('button').first().click()
  await page.getByRole('button',{name:'включить знакомства',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'настройки не сохранены'}).waitFor()
  await page.getByRole('button',{name:'включить знакомства',exact:true}).click()
  await page.getByRole('button',{name:'нравится профиль'}).waitFor()
  assert(!await page.locator('.dating-meet-link').count(),'Dead QR route remains')
  await context.setOffline(true)
  await page.getByRole('status').filter({hasText:'нет интернета'}).waitFor()
  await context.setOffline(false)
  await page.locator('.connection-status').waitFor({state:'detached'})
  await page.screenshot({path:'test-artifacts/guest-dating-360.png',fullPage:true})
  await page.goto(base+'#/zhivotina',{waitUntil:'domcontentloaded'})
  await page.locator('.chat-compose textarea').fill('поговорим о кино')
  await page.getByRole('button',{name:'отправить',exact:true}).click()
  await page.getByRole('button',{name:'повторить',exact:true}).click()
  await page.getByText('давай обсудим кино',{exact:true}).waitFor()
  assert(await page.locator('.chat-msg.user').count()===1,'Chat duplicated the user message')
  console.log('PASS chat failure, same-request retry and single delivered message')
  await page.goto(base+'#/test/2026-10-17',{waitUntil:'domcontentloaded'})
  await page.getByText('Доступ к пульту запрещён',{exact:true}).waitFor()
  assert(!await page.locator('.admin-rehearsal-roles').count(),'Guest can launch test')
  state.event=null
  await page.goto(base+'#/',{waitUntil:'domcontentloaded'});await page.reload()
  await page.getByRole('heading',{name:'готовим следующий вечер'}).waitFor()
  assert(!await page.locator('.home-event-ticket').count(),'Invented a demo event when no real event exists')
  assert(errors.length===0,'Browser errors: '+errors.join('; '))
  console.log('PASS 18 responsive guest routes, dating save error/retry, offline status and denied test entry')
 }catch(e){await page.screenshot({path:'test-artifacts/guest-journey-failure.png',fullPage:true});console.error(await page.locator('.onboarding-body,.onboarding-body .btn').evaluateAll(es=>es.map(e=>({tag:e.className,style:getComputedStyle(e).cssText,opacity:getComputedStyle(e).opacity,visibility:getComputedStyle(e).visibility,animation:getComputedStyle(e).animation,rect:e.getBoundingClientRect().toJSON()}))));console.error((await page.locator('body').innerText()).slice(0,1600));throw e}
 finally{await context.close()}
}catch(e){console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
