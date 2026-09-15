import React,{useState} from 'react';
import {Puppet} from './Puppet';
import {defaultHairLayer,type HairSettings,type HairLayer,type Parts} from '../../apps/room3d/chibi/types';
import './hair-editor.css';
export function HairEditor({parts,hair,previewHair,onChange}:{parts:Parts;hair:HairSettings;previewHair:HairSettings;onChange:(v:HairSettings)=>void}){
 const [selected,setSelected]=useState('fronthair'),[yaw,setYaw]=useState(25),[error,setError]=useState('');
 const extra=hair.extras.find(e=>e.id===selected),layer=extra??hair.layers[selected]??defaultHairLayer;
 const update=(patch:Partial<HairLayer>)=>onChange(extra?{...hair,extras:hair.extras.map(e=>e.id===selected?{...e,...patch}:e)}:{...hair,layers:{...hair.layers,[selected]:{...layer,...patch}}});
 const add=(source:string,src?:string)=>{const id=crypto.randomUUID();onChange({...hair,extras:[...hair.extras,{...defaultHairLayer,id,source:src?id:source,src,distance:.12+hair.extras.length*.06}]});setSelected(id);};
 const upload=async(file?:File)=>{if(!file)return;try{setError('');if(file.size>5*1024*1024)throw Error('请选择小于 5 MB 的透明图片');const src=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});const image=new Image();image.src=src;await image.decode();add('',src);}catch(e){setError(String(e));}};
 return <div className="hair-editor">
  <div className="hair-preview"><Puppet parts={parts} hair={previewHair} yaw={yaw} motion="idle" wire={false} playing={false}/><label className="hair-angle">转一圈 <input aria-label="3D 预览转角" type="range" min={-180} max={180} value={yaw} onChange={e=>setYaw(+e.target.value)}/>{yaw}°</label></div>
  <div className="hair-options">
   <label>调整哪一层 <select value={selected} onChange={e=>setSelected(e.target.value)}>{[['fronthair','前发'],['earhair','耳发'],['back1','后发1'],['back2','后发2'],...hair.extras.map((e,i)=>[e.id,`额外发片 ${i+1}`])].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   {([['length','长度',.25,2],['width','宽度',.4,2],['offsetY','上下位置',-.8,.8],['distance','离头距离',0,.8]] as const).map(([key,label,min,max])=><label key={key}>{label}<input aria-label={`${label}调节`} type="range" min={min} max={max} step={.01} value={layer[key]} onChange={e=>update({[key]:+e.target.value})}/><output>{layer[key].toFixed(2)}</output></label>)}
   <div className="hair-buttons"><button onClick={()=>update(defaultHairLayer)}>重置这一层</button>{extra&&<button onClick={()=>{onChange({...hair,extras:hair.extras.filter(e=>e.id!==selected)});setSelected('back1');}}>删除额外发片</button>}</div>
   <p>额外发片包在头发外面一整圈，透明处仍然透空。上传素材建议用与原图对齐的透明 PNG。</p>
   <div className="hair-buttons"><button disabled={hair.extras.length>=6} onClick={()=>add('back1')}>＋ 用后发1加一层</button><button disabled={hair.extras.length>=6} onClick={()=>add('back2')}>＋ 用后发2加一层</button><label className="hair-upload">＋ 上传额外发片<input disabled={hair.extras.length>=6} type="file" accept="image/png,image/webp" onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label></div>
   {error&&<p role="alert">{error}</p>}
  </div>
 </div>;
}
