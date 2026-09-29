import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { demoMode } from '../lib/api'

export default function Layout(){
  const location=useLocation()
  useEffect(()=>{
    window.scrollTo({top:0,left:0,behavior:'auto'})
    document.documentElement.scrollTop=0
    document.body.scrollTop=0
  },[location.pathname,location.search])
  return <div className="app-shell">
    <header className="topbar">
      <NavLink className="brand" to="/">НАСЫПАТЕЛИ <span>В КИНО</span></NavLink>
      <div className="topbar-actions">{demoMode && <span className="demo-badge">demo</span>}</div>
    </header>
    <main><Outlet/></main>
    <nav className="bottom-nav">
      <NavLink end className={({isActive})=>isActive?'active':''} to="/"><i>●</i><span>событие</span></NavLink>
      <NavLink className={({isActive})=>isActive?'active':''} to="/zhivotina"><i>◉</i><span>чат</span></NavLink>
      <NavLink className={({isActive})=>isActive?'active':''} to="/dating"><i>↔</i><span>знакомства</span></NavLink>
      <NavLink className={({isActive})=>isActive?'active':''} to="/profile"><i>○</i><span>животина</span></NavLink>
      <NavLink className={({isActive})=>isActive?'active':''} to="/archive"><i>□</i><span>архив</span></NavLink>
    </nav>
  </div>
}
