import {fileURLToPath} from 'node:url'
process.chdir(fileURLToPath(new URL('..',import.meta.url)))
import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {initialDemoState} from '../src/demo.ts'
const base='http://127.0.0.1:4186/nasypateli-cinema_2/'
const server=spawn('./node_modules/.bin/vite',['preview','--host','127.0.0.1','--port','4186','--strictPort','--base=/nasypateli-cinema_2/'],{stdio:'inherit'})
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
 page.on('dialog',dialog=>dialog.accept())
 await page.addInitScript(()=>{window.Telegram={WebApp:{initData:'fixture'}}})
 await page.route('**/telegram-web-app.js*',r=>r.fulfill({body:'',contentType:'application/javascript'}))
 await page.route('**/functions/v1/app',async r=>{const {action}=r.request().postDataJSON();await r.fulfill({json:action==='screen-bootstrap'||action==='bootstrap'?state:action==='live-refresh'?{runtime:state.show.runtime}: {ok:true,owner:true}})})
 let releaseImage;const imageGate=new Promise(resolve=>{releaseImage=resolve})
 await page.route('**/assets/animal-001.webp',async r=>{await imageGate;await r.fulfill({status:404,body:''})})
 await page.goto(base+'#/screen/test-2026-10-17?token=fixture',{waitUntil:'domcontentloaded'})
 await page.locator('.projector-image-loading').waitFor()
 assert(await page.locator('.screen-creature-art img').count()===0,'Broken image shown during load')
 releaseImage()
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
 await page.goto(base+'#/screen/test-2026-10-17?token=fixture',{waitUntil:'domcontentloaded'})
 await page.getByRole('alert').filter({hasText:'показ приостановлен'}).waitFor()
 await page.getByLabel('резервный видеофайл').setInputFiles('public/assets/rabbit-boy.webm')
 await page.waitForFunction(()=>{const v=document.querySelector('.projector-media video');return v&&v.readyState>=2})
 assert(!await page.locator('.projector-media-error').count(),'Fallback video not restored')
 console.log('PASS YouTube error 150 replaced by recovery and local video playback')
 await page.screenshot({path:'test-artifacts/projector-video-recovery.png'})
 const rutubeId='a'.repeat(32)
 state.projector.payload.fragment={sourcePlatform:'rutube',sourceUrl:'https://rutube.ru/video/'+rutubeId+'/',startSec:10,endSec:20}
 await page.route('https://rutube.ru/play/embed/**',r=>r.fulfill({contentType:'text/html',body:`<body><p id="state">loaded</p><script>
 const send=x=>parent.postMessage(JSON.stringify(x),'*');setTimeout(()=>send({type:'player:ready'}),50);
 window.addEventListener('message',e=>{if(JSON.parse(e.data).type==='player:pause')document.querySelector('#state').textContent='paused'});
 window.emitTime=time=>send({type:'player:currentTime',data:{time}});window.emitError=()=>send({type:'player:error',data:{code:'blocked'}});
 </script></body>`}))
 await page.reload({waitUntil:'domcontentloaded'})
 const frame=page.frameLocator('iframe[title="тестовый фильм"]')
 await frame.locator('#state').waitFor()
 const url=await page.locator('iframe').getAttribute('src')
 assert(url.includes('t=10')&&url.includes('stopTime=20'),'Rutube fragment boundaries lost')
 await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://evil.example',data:JSON.stringify({type:'player:error'})})))
 assert(!await page.locator('.projector-media-error').count(),'Untrusted frame can inject a player error')
 await page.waitForTimeout(100)
 await frame.locator('body').evaluate(()=>window.emitTime(20))
 await frame.getByText('paused',{exact:true}).waitFor()
 await frame.locator('body').evaluate(()=>window.emitError())
 await page.getByRole('alert').filter({hasText:'показ приостановлен'}).waitFor()
 console.log('PASS Rutube timing, origin checks and blocked-video recovery')

}finally{await browser?.close();server.kill('SIGTERM')}
