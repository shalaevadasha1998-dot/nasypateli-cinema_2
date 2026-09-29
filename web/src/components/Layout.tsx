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
  useEffect(()=>{
    const root=document.getElementById('root')
    if(!root)return
    const clean=()=>{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT)
      let node:Node|null
      while((node=walker.nextNode())){
        const text=node as Text
        const parent=text.parentElement
        if(!parent||parent.closest('script,style,code,pre,textarea,input'))continue
        const next=text.data.replace(/\.(?=\s|$)/g,'')
        if(next!==text.data)text.data=next
      }
    }
    clean()
    let frame=0
    const observer=new MutationObserver(()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;clean()})})
    observer.observe(root,{subtree:true,childList:true,characterData:true})
    return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame)}
  },[])
  return <div className="app-shell">
    <header className="topbar">
      <NavLink className="brand" to="/">насыпатели <span>в кино</span></NavLink>
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
