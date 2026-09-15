import React, {useEffect,useRef,useState} from 'react';
import {mountHomeEditor} from './editor.js';
import type {Home3DState} from './types';
import './editor.css';

export default function Home3DView({value,onChange,onBack}:{value?:Home3DState;onChange:(value:Home3DState)=>void;onBack:()=>void}){
 const host=useRef<HTMLDivElement>(null),save=useRef(onChange),back=useRef(onBack),initial=useRef(value);
 const [error,setError]=useState('');save.current=onChange;back.current=onBack;
 useEffect(()=>{
  let cancelled=false,editor:{dispose:()=>void}|undefined;const controller=new AbortController();
  const assetBase=new URL(`${import.meta.env.BASE_URL}room3d/`,location.href).href;
  mountHomeEditor(host.current!,{assetBase,initialState:initial.current,onChange:(s:Home3DState)=>save.current(s),onBack:()=>back.current(),signal:controller.signal})
   .then(e=>{editor=e;if(cancelled)e.dispose()}).catch(e=>{if(!cancelled)setError(e.message)});
  return()=>{cancelled=true;controller.abort();editor?.dispose()};
 },[]);
 return <div className="relative h-full w-full" style={{paddingTop:'var(--chrome-top, 0px)',paddingBottom:'var(--safe-bottom, 0px)',background:'#e8dde7'}}>
   <div ref={host} className="h-full w-full" />
   {error&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#e8dde7] p-8 text-center text-sm text-purple-900"><p>{error}</p><button className="rounded-full bg-white px-5 py-3" onClick={onBack}>返回 2D 小屋</button></div>}
 </div>;
}
