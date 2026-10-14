const KEY='nasypateli-onboarding-return'
// Only guest routes are resumable; never persist bearer tokens or external URLs.
function safePath(path:string){return /^\/(?:private|event|mission)\/[a-zA-Z0-9_-]+$/.test(path)}
export function rememberReturnPath(path:string){if(safePath(path)){try{sessionStorage.setItem(KEY,path)}catch{}}}
export function pendingReturnPath(){try{const path=sessionStorage.getItem(KEY)||'';return safePath(path)?path:'/'}catch{return '/'}}
export function consumeReturnPath(){const path=pendingReturnPath();try{sessionStorage.removeItem(KEY)}catch{}return path}
