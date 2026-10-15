import { createContext } from 'react'
export type PlaybackStatus='loading'|'playing'|'buffering'|'paused'|'ended'|'error'|'blocked'
export type PlaybackSample={status:PlaybackStatus;position:number}
export type PlaybackContextValue={paused:boolean;runId:string;revision:number;report:(sample:Record<string,unknown>)=>Promise<any>}
export const PlaybackContext=createContext<PlaybackContextValue|null>(null)
// New per-page, not copied with a sessionStorage-cloned tab. Never exposed to participants.
export const projectorSessionId=typeof crypto!=='undefined'?crypto.randomUUID():'preview-session'
