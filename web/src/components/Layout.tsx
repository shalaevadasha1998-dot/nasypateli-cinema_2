import { NavLink, Outlet } from 'react-router-dom'
import { demoMode } from '../lib/api'

export default function Layout(){
  return <div className="app-shell">
    <header className="topbar">
      <NavLink className="brand" to="/">НАСЫПАТЕЛИ <span>В КИНО</span></NavLink>
      <div className="topbar-actions">{demoMode && <span className="demo-badge">demo</span>}</div>
    </header>
    <main><Outlet/></main>
    <nav className="bottom-nav">
      <NavLink to="/"><i>●</i><span>событие</span></NavLink>
      <NavLink to="/jipitina"><i>◉</i><span>чат</span></NavLink>
      <NavLink to="/dating"><i>↔</i><span>знакомства</span></NavLink>
      <NavLink to="/profile"><i>○</i><span>животина</span></NavLink>
      <NavLink to="/archive"><i>□</i><span>архив</span></NavLink>
    </nav>
  </div>
}
