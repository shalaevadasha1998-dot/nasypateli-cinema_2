import { Component, StrictMode } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

class AppErrorBoundary extends Component<{children:ReactNode},{error:string}> {
  state={error:''}
  static getDerivedStateFromError(error:unknown){return {error:error instanceof Error?error.message:'неизвестная ошибка'}}
  componentDidCatch(error:unknown,info:ErrorInfo){console.error('Mini App crash',error,info)}
  render(){
    if(this.state.error)return <div style={{minHeight:'100vh',background:'#090906',color:'#E9E2D7',padding:'24px 18px',fontFamily:'Inter,system-ui,-apple-system,sans-serif'}}><div style={{fontSize:14,fontWeight:900,letterSpacing:'.08em'}}>НАСЫПАТЕЛИ В КИНО</div><div style={{marginTop:'38vh',borderLeft:'3px solid #EA3D2F',paddingLeft:14}}><b>не удалось открыть приложение</b><p style={{color:'#9D9A91',lineHeight:1.45}}>{this.state.error}</p><button style={{background:'#E9E2D7',color:'#090906',border:0,padding:'12px 14px',fontWeight:800}} onClick={()=>location.reload()}>открыть ещё раз</button></div></div>
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><App/></AppErrorBoundary></StrictMode>)
