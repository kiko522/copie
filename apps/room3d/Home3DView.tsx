import React, {useEffect,useRef,useState,useMemo} from 'react';
import {mountHomeEditor} from './editor.js';
import type {Home3DState} from './types';
import './editor.css';
import type {HomeEditor} from './editor.js';
import type {Parts,HairSettings} from './chibi/types';
import {selectedHairAssets} from './chibi/types';
import type {CharacterProfile} from '../../types';
import {CreatorRollBridge} from './chibi/CreatorRollBridge';
import {createVisitor,decodeParts} from './chibi/visitor';
import {loadCreatorPartsForRender} from '../../utils/creatorPartsBlob';

export default function Home3DView({value,onChange,onBack,character,parts:previewParts,hair}:{value?:Home3DState;onChange:(value:Home3DState)=>void;onBack:()=>void;character?:CharacterProfile;parts?:Parts;hair?:HairSettings}){
 const host=useRef<HTMLDivElement>(null),save=useRef(onChange),back=useRef(onBack),initial=useRef(value);
 const [editor,setEditor]=useState<HomeEditor>(),[parts,setParts]=useState<Parts>(),[residentError,setResidentError]=useState('');
 const [residentAssets,setResidentAssets]=useState<Record<string,string>>({});
 const residentHair=useMemo(()=>({...hair,layers:hair?.layers??{},extras:hair?.extras??[],assets:hair?.assets??residentAssets}),[hair,residentAssets]);
 const [extraItems,setExtraItems]=useState<unknown[]>(),[creatorReady,setCreatorReady]=useState(false);
 const savedState=character?.chibiStudio?.room?.state??character?.chibiStudio?.vr?.state;
 useEffect(()=>{let cancelled=false;if(!savedState)return;loadCreatorPartsForRender().then(items=>{if(!cancelled)setExtraItems(items.map(p=>({...p,categoryKey:p.categoryKey})));}).catch(()=>{if(!cancelled)setResidentError('自定义素材读取失败，请退出小屋重试。');});return()=>{cancelled=true};},[savedState]);
 useEffect(()=>{let cancelled=false;if(!editor||!(previewParts||parts))return;
  createVisitor((previewParts||parts)!,residentHair).then(visitor=>{if(cancelled)visitor.dispose();else {editor.setVisitor?.(visitor);setResidentError('');}}).catch(e=>{if(!cancelled)setResidentError(String(e));});
  return()=>{cancelled=true;editor.setVisitor?.(null)};
 },[editor,previewParts,parts,residentHair]);
 const [error,setError]=useState('');save.current=onChange;back.current=onBack;
 useEffect(()=>{
  let cancelled=false,editor:{dispose:()=>void}|undefined;const controller=new AbortController();
  const assetBase=new URL(`${import.meta.env.BASE_URL}room3d/`,location.href).href;
  mountHomeEditor(host.current!,{assetBase,initialState:initial.current,onChange:(s:Home3DState)=>save.current(s),onBack:()=>back.current(),signal:controller.signal})
   .then(e=>{editor=e;if(cancelled)e.dispose();else setEditor(e)}).catch(e=>{if(!cancelled)setError(e.message)});
  return()=>{cancelled=true;controller.abort();editor?.dispose()};
 },[]);
 return <div className="relative h-full w-full" style={{paddingTop:'var(--chrome-top, 0px)',paddingBottom:'var(--safe-bottom, 0px)',background:'#e8dde7'}}>
   <div ref={host} className="h-full w-full" />
   {savedState&&<CreatorRollBridge request={creatorReady&&extraItems?1:0} savedState={savedState} extraItems={extraItems} onReady={()=>setCreatorReady(true)} onResult={result=>{setResidentAssets(selectedHairAssets(result.state));decodeParts(result).then(setParts).catch(e=>setResidentError(String(e)));}} onError={setResidentError}/>}
   {(residentError||character&&!savedState)&&<p role="status" style={{position:'absolute',top:100,left:18,right:18,fontSize:12,pointerEvents:'none',color:'#665274'}}>{residentError||'先在手办柜捏好小小窝或彼方形象，小人就能住进来。'}</p>}
   {error&&<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#e8dde7] p-8 text-center text-sm text-purple-900"><p>{error}</p><button className="rounded-full bg-white px-5 py-3" onClick={onBack}>返回 2D 小屋</button></div>}
 </div>;
}
