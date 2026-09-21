import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {HairEditor} from './HairEditor';
import {CreatorRollBridge,type RollResult} from './CreatorRollBridge';
import {decodeParts} from '../../apps/room3d/chibi/visitor';
import {selectedHairAssets,type HairSettings,type Parts} from '../../apps/room3d/chibi/types';
import './style.css';
import './wardrobe-studio.css';
const DRAFT='chibi-wardrobe-studio-draft-v1';
const defaults:HairSettings={layers:{},extras:[],bodyShape:'blank',wardrobeStyle:'normal'};
function read(key:string){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function Studio(){
 const [hair,setHair]=useState<HairSettings>(()=>{const h=read(DRAFT)??read('chibi-world-hair-settings');return h?.layers&&Array.isArray(h.extras)?{...h,bodyShape:'blank'}:defaults;});
 const [preview,setPreview]=useState(hair),[parts,setParts]=useState<Parts>(),[request,setRequest]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [savedState]=useState(()=>read('chibi-world-experiment-appearance'));
 const [appearance,setAppearance]=useState<unknown>(),[assets,setAssets]=useState<Record<string,string>>({}),[extraParts,setExtraParts]=useState<Parts>();
 const past=useRef<HairSettings[]>([]),future=useRef<HairSettings[]>([]),group=useRef(false),recorded=useRef(false);
 const change=(next:HairSettings)=>{if(JSON.stringify(next)===JSON.stringify(hair))return;if(!group.current||!recorded.current){past.current.push(hair);if(past.current.length>40)past.current.shift();recorded.current=true;}future.current=[];setHair(next);setNotice('');};
 const undo=()=>{const h=past.current.pop();if(h){future.current.push(hair);setHair(h);group.current=false;}};
 const redo=()=>{const h=future.current.pop();if(h){past.current.push(hair);setHair(h);group.current=false;}};
 useEffect(()=>{const timer=setTimeout(()=>{setPreview(hair);try{localStorage.setItem(DRAFT,JSON.stringify(hair));}catch{setError('草稿未保存：本机存储空间不足。');}},120);return()=>clearTimeout(timer);},[hair]);
 useEffect(()=>{let cancelled=false;if(!parts)return;Promise.all(hair.extras.filter(e=>e.src).map(async e=>{const image=new Image();image.src=e.src!;await image.decode();return [e.source,image] as const;})).then(extra=>{if(!cancelled)setExtraParts({...parts,...Object.fromEntries(extra)});}).catch(e=>setError(String(e)));return()=>{cancelled=true};},[parts,hair.extras]);
 const effective=useMemo(()=>({...preview,assets}),[preview,assets]);
 const accept=async(result:RollResult)=>{try{setParts(await decodeParts(result));setAssets(selectedHairAssets(result.state));setAppearance(result.state);}catch(e){setError(String(e));}};
 const save=()=>{try{localStorage.setItem('chibi-world-hair-settings',JSON.stringify(hair));if(appearance)localStorage.setItem('chibi-world-experiment-appearance',JSON.stringify(appearance));setNotice('搭配已保存，下次打开会恢复。');}catch{setError('保存失败：本机存储空间不足。');}};
 return <><header className="wardrobe-studio-top"><div><strong>小人衣橱</strong><span>3D 装扮</span></div><button onClick={save} disabled={!parts}>保存搭配</button></header><CreatorRollBridge savedState={savedState??undefined} request={request} onReady={()=>setRequest(1)} onResult={accept} onError={setError}/>{extraParts?<HairEditor parts={extraParts} hair={hair} previewHair={effective} assets={assets} onChange={change} onUndo={undo} onRedo={redo} onReset={()=>change(structuredClone(defaults))} canUndo={!!past.current.length} canRedo={!!future.current.length} onBegin={()=>{group.current=true;recorded.current=false;}} onEnd={()=>{group.current=false;}}/>:<div className="wardrobe-loading">正在准备你的衣橱…</div>}{(notice||error)&&<div className="wardrobe-notice" role={error?'alert':'status'}>{error||notice}<button aria-label="关闭提示" onClick={()=>{setError('');setNotice('');}}>×</button></div>}</>;
}
createRoot(document.getElementById('root')!).render(<Studio/>);
