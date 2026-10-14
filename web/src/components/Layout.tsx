import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { demoMode } from '../lib/api'

type NavIconName='event'|'chat'|'dating'|'creature'|'archive'

function NavIcon({name}:{name:NavIconName}){
  const common={viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,'aria-hidden':true}
  if(name==='event')return <svg {...common}><path d="M5.5 6.25h13a1.75 1.75 0 0 1 1.75 1.75v2.15a2.15 2.15 0 0 0 0 3.7V16a1.75 1.75 0 0 1-1.75 1.75h-13A1.75 1.75 0 0 1 3.75 16v-2.15a2.15 2.15 0 0 0 0-3.7V8A1.75 1.75 0 0 1 5.5 6.25Z"/><path d="M9 8.7v6.6"/></svg>
  if(name==='chat')return <svg {...common}><path d="M5.2 5.75h13.6A2.2 2.2 0 0 1 21 7.95v7.1a2.2 2.2 0 0 1-2.2 2.2H10l-4.8 2.3v-2.3A2.2 2.2 0 0 1 3 15.05v-7.1a2.2 2.2 0 0 1 2.2-2.2Z"/><path d="M7.5 11.5h9"/></svg>
  if(name==='dating')return <svg {...common}><circle cx="8" cy="9" r="2.4"/><circle cx="16" cy="9" r="2.4"/><path d="M3.9 17.4c.55-2.45 2-3.7 4.1-3.7 1.45 0 2.56.6 3.3 1.78"/><path d="M20.1 17.4c-.55-2.45-2-3.7-4.1-3.7-1.45 0-2.56.6-3.3 1.78"/></svg>
  if(name==='creature')return <svg {...common}><path d="M8.1 8.2C6.7 5.2 6.95 2.8 8.35 2.45c1.45-.35 2.55 2.1 2.8 5.1"/><path d="M15.9 8.2c1.4-3 1.15-5.4-.25-5.75-1.45-.35-2.55 2.1-2.8 5.1"/><path d="M6.25 13.2c0-3.4 2.55-5.8 5.75-5.8s5.75 2.4 5.75 5.8-2.3 6.05-5.75 6.05-5.75-2.65-5.75-6.05Z"/><circle cx="9.75" cy="12.8" r=".65" fill="currentColor" stroke="none"/><circle cx="14.25" cy="12.8" r=".65" fill="currentColor" stroke="none"/><path d="M11.15 15.55c.6.45 1.1.45 1.7 0"/></svg>
  return <svg {...common}><path d="M5 8.25h14v10.5H5z"/><path d="M4 5.25h16v3H4z"/><path d="M9.2 12h5.6"/></svg>
}

export default function Layout(){
  const location=useLocation()
  useEffect(()=>{
    window.scrollTo({top:0,left:0,behavior:'auto'})
    document.documentElement.scrollTop=0
    document.body.scrollTop=0
  },[location.pathname,location.search])
  return <div className="app-shell">
    <header className="topbar">
      <NavLink className="brand" to="/">насыпатели <span>в кино</span></NavLink>
      <div className="topbar-actions">{demoMode && <span className="demo-badge">demo</span>}</div>
    </header>
    <main><Outlet/></main>
    <nav className="bottom-nav">
      <NavLink end className={({isActive})=>isActive?'active':''} to="/"><span className="nav-icon-wrap"><NavIcon name="event"/></span><span>событие</span></NavLink>
      <NavLink className={({isActive})=>isActive?'active':''} to="/zhivotina"><span className="nav-icon-wrap"><NavIcon name="chat"/></span><span>чат</span></NavLink>
      <NavLink className={({isActive})=>isActive?'active':''} to="/dating"><span className="nav-icon-wrap"><NavIcon name="dating"/></span><span>знакомства</span></NavLink>
      <NavLink className={({isActive})=>isActive?'active':''} to="/profile"><span className="nav-icon-wrap"><NavIcon name="creature"/></span><span>животина</span></NavLink>
      <NavLink className={({isActive})=>isActive?'active':''} to="/archive"><span className="nav-icon-wrap"><NavIcon name="archive"/></span><span>архив</span></NavLink>
    </nav>
  </div>
}
