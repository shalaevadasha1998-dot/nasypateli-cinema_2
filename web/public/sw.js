const CACHE='nasypateli-pwa-v1'
const SHELL=['./','./manifest.webmanifest','./assets/rabbit-head.png']

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>undefined))
  self.skipWaiting()
})

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE&&key.startsWith('nasypateli-pwa-')).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  )
})

self.addEventListener('fetch',event=>{
  const request=event.request
  if(request.method!=='GET')return
  const url=new URL(request.url)
  if(url.origin!==self.location.origin)return

  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(request)
        const cache=await caches.open(CACHE)
        cache.put('./',fresh.clone()).catch(()=>undefined)
        return fresh
      }catch{
        return (await caches.match('./')) || Response.error()
      }
    })())
    return
  }

  if(url.pathname.includes('/assets/')){
    event.respondWith((async()=>{
      const cached=await caches.match(request)
      const network=fetch(request).then(async response=>{
        if(response.ok){
          const cache=await caches.open(CACHE)
          cache.put(request,response.clone()).catch(()=>undefined)
        }
        return response
      }).catch(()=>null)
      return cached || await network || Response.error()
    })())
  }
})

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting()
})
