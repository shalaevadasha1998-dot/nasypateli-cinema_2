import type { MouseEvent, PropsWithChildren, ReactNode } from 'react'
import { haptic } from '../lib/telegram'

export function Card({children,className=''}:PropsWithChildren<{className?:string}>){return <section className={`card ${className}`}>{children}</section>}
export function Button({children,onClick,disabled=false,kind='primary',type='button'}:PropsWithChildren<{onClick?:()=>void;disabled?:boolean;kind?:'primary'|'secondary'|'danger';type?:'button'|'submit'}>){
  const tap=(event:MouseEvent<HTMLButtonElement>)=>{if(disabled)return;haptic(kind==='primary'?'soft':'light');onClick?.()}
  return <button type={type} className={`btn ${kind}`} disabled={disabled} onClick={tap}>{children}</button>
}
export function Pill({children}:PropsWithChildren){return <span className="pill">{children}</span>}
export function Empty({children}:PropsWithChildren){return <div className="empty">{children}</div>}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
