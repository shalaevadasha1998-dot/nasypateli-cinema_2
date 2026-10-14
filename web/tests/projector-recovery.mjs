import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {initialDemoState} from '../src/demo.ts'
const base='http://127.0.0.1:4186/nasypateli-cinema_2/'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4186','--strictPort'],{stdio:'inherit'})
const assert=(v,m)=>{if(!v)throw Error(m)}
let browser
let state=structuredClone(initialDemoState)
state.profile.completed=true;state.onboardingComplete=true;state.creature.born=true;state.registration='attended';state.isAdmin=true
state.event.slug='test-2026-10-17'
state.show={runtime:{},program:{blocks:[],roundsTarget:1,rewards:{join:0,vote:0,round:0,finale:0}},audio:{state:{status:'stopped',mode:'auto'},assets:[],screen:{online:false,unlocked:false}}}
state.show.runtime={...state.show.runtime,runStatus:'running',currentBlockId:'arrival',currentBlockIndex:0,currentBlock:{id:'arrival',type:'arrival',title:'сбор гостей'}}
state.show.program.blocks=[{id:'arrival',type:'arrival',title:'сбор гостей'},{id:'intro',type:'creature_intro',title:'знакомство'}]
state.projector={state:'arrival',payload:{},revision:1}
state.screenCreatures=[{id:'test',name:'киноша',stage:'stage_0',visualVariant:1}]
try{
 for(let i=0;i<40;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,250))}
 browser=await chromium.launch({headless:true})
 const page=await browser.newPage({viewport:{width:1280,height:720}})
 await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'fixture'}}})
 await page.route('**/telegram-web-app.js*',r=>r.fulfill({body:'',contentType:'application/javascript'}))
 await page.route('**/functions/v1/app',async r=>{const {action}=r.request().postDataJSON();await r.fulfill({json:action==='screen-bootstrap'||action==='bootstrap'?state:action==='live-refresh'?{runtime:state.show.runtime}: {ok:true,owner:true}})})
 await page.route('**/assets/animal-001.webp',async r=>{await new Promise(resolve=>setTimeout(resolve,800));await r.fulfill({status:404,body:''})})
 await page.goto(base+'#/screen/test-2026-10-17?token=fixture')
 await page.locator('.projector-image-loading').waitFor()
 assert(await page.locator('.screen-creature-art img').count()===0,'Broken image shown during load')
 await page.locator('.screen-creature-art img').waitFor()
 assert(await page.locator('.screen-creature-art img').evaluate(e=>e.complete&&e.naturalWidth>0),'Fallback failed')
 console.log('PASS delayed and missing image never renders broken placeholder')
 await page.goto(base+'#/rehearsal/test-2026-10-17');await page.getByRole('heading',{name:'ты в зале'}).waitFor()
 state.show.runtime={...state.show.runtime,currentBlockId:'intro',currentBlockIndex:1,currentBlock:state.show.program.blocks[1]}
 await page.locator('.admin-rehearsal-ticket').waitFor({state:'detached',timeout:15000})
 await page.getByRole('heading',{name:'животина настоящая'}).waitFor()
 console.log('PASS check-in screen disappears during live program without reload')
 state.projector={state:'film_intro',payload:{filmTitle:'тестовый фильм',fragment:{videoId:'testid12345',sourcePlatform:'youtube',startSec:0,endSec:5}},revision:2}
 await page.route('https://www.youtube.com/iframe_api',r=>r.fulfill({contentType:'application/javascript',body:`window.YT={Player:class {constructor(node,opts){this.node=node;setTimeout(()=>opts.events.onError({data:150}),50)}destroy(){}getIframe(){return null}}};window.onYouTubeIframeAPIReady()`}))
 await page.goto(base+'#/screen/test-2026-10-17?token=fixture')
 await page.getByRole('alert').filter({hasText:'фрагмент недоступен'}).waitFor()
 await page.getByLabel('резервный видеофайл').setInputFiles('public/assets/rabbit-boy.webm')
 await page.waitForFunction(()=>{const v=document.querySelector('.projector-media video');return v&&v.readyState>=2})
 assert(!await page.locator('.projector-media-error').count(),'Fallback video not restored')
 console.log('PASS YouTube error 150 replaced by recovery and local video playback')
 await page.screenshot({path:'test-artifacts/projector-video-recovery.png'})
}finally{await browser?.close();server.kill('SIGTERM')}
