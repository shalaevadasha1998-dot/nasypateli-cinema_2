import { cloneElement, isValidElement, useId } from 'react'
import type { ReactElement } from 'react'
import type { MouseEvent, PropsWithChildren, ReactNode } from 'react'
import { haptic } from '../lib/telegram'

export function Card({children,className='',id}:PropsWithChildren<{className?:string;id?:string}>){return <section id={id} className={`card ${className}`}>{children}</section>}
export function Button({children,onClick,disabled=false,kind='primary',type='button'}:PropsWithChildren<{onClick?:()=>void;disabled?:boolean;kind?:'primary'|'secondary'|'danger';type?:'button'|'submit'}>){
  const tap=(event:MouseEvent<HTMLButtonElement>)=>{if(disabled)return;haptic(kind==='primary'?'soft':'light');onClick?.()}
  return <button type={type} className={`btn ${kind}`} disabled={disabled} onClick={tap}>{children}</button>
}
export function Pill({children}:PropsWithChildren){return <span className="pill">{children}</span>}
export function Empty({children}:PropsWithChildren){return <div className="empty">{children}</div>}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){
  const id=useId()
  const field=isValidElement(children)&&typeof children.type==='string'&&['input','select','textarea'].includes(children.type)
    ?cloneElement(children as ReactElement<{'aria-labelledby'?:string;'aria-describedby'?:string}>,{'aria-labelledby':id,'aria-describedby':hint?id+'-hint':undefined}):children
  return <label className="field"><span id={id}>{label}</span>{field}{hint&&<small id={id+'-hint'}>{hint}</small>}</label>
}
