#!/usr/bin/env python3
"""Read-only 50-concurrent-user smoke/load test; no real users or bookings touched."""
import concurrent.futures, json, os, statistics, time, urllib.request, urllib.error
TARGETS = {
  "miniapp": "https://shalaevadasha1998-dot.github.io/nasypateli-cinema_2/",
  "api_get": "https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app",
  "api_health_post": "https://vwteokawtqnoiyzmsldj.supabase.co/functions/v1/app",
}
def check(item):
    kind, number = item
    start=time.monotonic()
    try:
        request=urllib.request.Request(TARGETS[kind], headers={"User-Agent":"nasypateli-readonly-load-test/1.0","Cache-Control":"no-cache", **({"Content-Type":"application/json"} if kind=="api_health_post" else {})}, data=b'{"action":"health"}' if kind=="api_health_post" else None)
        with urllib.request.urlopen(request, timeout=20) as response:
            body=response.read(1024)
            return {"target":kind,"user":number,"status":response.status,"ms":round((time.monotonic()-start)*1000),"bytes_sample":len(body),"ok":response.status==200}
    except Exception as e:
        return {"target":kind,"user":number,"status":None,"ms":round((time.monotonic()-start)*1000),"ok":False,"error":str(e)[:250]}
results=[]
for kind in TARGETS:
    with concurrent.futures.ThreadPoolExecutor(max_workers=50) as pool:
        results.extend(pool.map(check,[(kind,i) for i in range(50)]))
summary={}
for kind in TARGETS:
    subset=[x for x in results if x["target"]==kind]
    times=sorted(x["ms"] for x in subset)
    summary[kind]={"requests":len(subset),"success":sum(x["ok"] for x in subset),"failures":sum(not x["ok"] for x in subset),"p50_ms":times[24],"p95_ms":times[47],"max_ms":times[-1],"error_examples":list(dict.fromkeys(x.get("error","HTTP "+str(x["status"])) for x in subset if not x["ok"]))[:5]}
os.makedirs("test-results",exist_ok=True)
with open("test-results/load-50.json","w") as f:json.dump({"summary":summary,"results":results},f,ensure_ascii=False,indent=2)
print(json.dumps(summary,ensure_ascii=False,indent=2))
if any(s["failures"] for s in summary.values()):raise SystemExit(1)
