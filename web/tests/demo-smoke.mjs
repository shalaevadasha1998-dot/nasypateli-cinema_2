import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const origin='http://127.0.0.1:4174/nasypateli-cinema_2/'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4174','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
let browser
async function ready(){
  for(let i=0;i<40;i++){try{if((await fetch(origin)).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}
  throw Error('Demo preview failed')
}
async function check(viewport,label){
  const page=await browser.newPage({viewport})
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
}catch(e){console.error(e);process.exitCode=1}
finally{if(browser)await browser.close();server.kill('SIGTERM')}
