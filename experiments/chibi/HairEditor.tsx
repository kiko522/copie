import React,{useState,useEffect} from 'react';
import {Puppet} from './Puppet';
import {defaultHairLayer,hairMode,type HairSettings,type HairLayer,type Parts} from '../../apps/room3d/chibi/types';
import './hair-editor.css';
export function HairEditor({parts,hair,previewHair,assets,onChange,onUndo,onRedo,onReset,canUndo,canRedo,onBegin,onEnd}:{parts:Parts;hair:HairSettings;previewHair:HairSettings;assets:Record<string,string>;onChange:(v:HairSettings)=>void;onUndo:()=>void;onRedo:()=>void;onReset:()=>void;canUndo:boolean;canRedo:boolean;onBegin:()=>void;onEnd:()=>void}){
 const [selected,setSelected]=useState('fronthair'),[yaw,setYaw]=useState(25),[error,setError]=useState('');
 useEffect(()=>{if(!['fronthair','earhair','back1','back2','outfit','outer'].includes(selected)&&!hair.extras.some(e=>e.id===selected))setSelected('back2');},[hair.extras,selected]);
 const extra=hair.extras.find(e=>e.id===selected),layer=extra??hair.layers[selected]??defaultHairLayer;
 const clothing=selected==='outfit'||selected==='outer';
 const update=(patch:Partial<HairLayer>)=>onChange(extra?{...hair,extras:hair.extras.map(e=>e.id===selected?{...e,...patch}:e)}:{...hair,layers:{...hair.layers,[selected]:{...layer,...patch}}});
 const add=(source:string,src?:string)=>{const id=crypto.randomUUID();onChange({...hair,extras:[...hair.extras,{...defaultHairLayer,id,source:src?id:source,src,distance:.12+hair.extras.length*.06}]});setSelected(id);};
 const upload=async(file?:File)=>{if(!file)return;try{setError('');if(file.size>5*1024*1024)throw Error('请选择小于 5 MB 的透明图片');const src=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});const image=new Image();image.src=src;await image.decode();add('',src);}catch(e){setError(String(e));}};
 return <div className="hair-editor">
  <div className="hair-preview"><Puppet parts={parts} hair={previewHair} yaw={yaw} motion="idle" wire={false} playing={false}/><label className="hair-angle">转一圈 <input aria-label="3D 预览转角" type="range" min={-180} max={180} value={yaw} onChange={e=>setYaw(+e.target.value)}/>{yaw}°</label></div>
  <div className="hair-options">
   <div className="hair-buttons"><button disabled={!canUndo} onClick={onUndo}>撤销</button><button disabled={!canRedo} onClick={onRedo}>重做</button><button onClick={onReset}>全部重置</button></div>
   <label>调整哪一层 <select value={selected} onChange={e=>setSelected(e.target.value)}>{[['fronthair','前发'],['earhair','耳发'],['back1','后发1'],['back2','后发2'],['outfit','衣服'],['outer','外套'],...hair.extras.map((e,i)=>[e.id,`额外发片 ${i+1}`])].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   {!clothing&&<label>素材分类 <select aria-label="素材分类" value={extra?.mode??hairMode({...hair,assets},selected)} onChange={e=>{const mode=e.target.value as 'wrap'|'project';if(extra||!assets[selected])update({mode});else onChange({...hair,assetModes:{...hair.assetModes,[assets[selected]]:mode}});}}><option value="wrap">贴头包裹</option><option value="project">向外伸出（马尾 / 啾啾 / 猫耳）</option></select></label>}
   <p>{clothing?'衣服和外套分别从上沿调整长度，覆盖不到的位置露出肤色。':extra?'分类随这张额外发片保存。':assets[selected]?`当前素材：${assets[selected]} · 分类只作用于这张素材。`:'当前层未选择素材。'}「全部重置」恢复默认分类与尺寸，并移除额外层；可以撤销。</p>
   {([['length','长度',.25,2],['width','宽度',.4,2],['offsetY','上下位置',-.8,.8],['offsetX','左右位置',-1.5,1.5],['offsetZ','前后位置',-1.5,1.5],['puff','发片厚度',0,.5]] as const).filter(([key])=>!clothing||key==='length').map(([key,label,min,max])=><label key={key}>{label}<input aria-label={`${label}调节`} type="range" min={clothing?0:min} max={max} step={.01} onPointerDown={onBegin} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd} value={layer[key]??defaultHairLayer[key]} onChange={e=>update({[key]:+e.target.value})}/><output>{(layer[key]??defaultHairLayer[key]??0).toFixed(2)}</output></label>)}
   <div className="hair-buttons"><button onClick={()=>update(defaultHairLayer)}>重置这一层</button>{extra&&<button onClick={()=>{onChange({...hair,extras:hair.extras.filter(e=>e.id!==selected)});setSelected('back1');}}>删除额外发片</button>}</div>
   <p>「发片厚度」用于伸出类：前后两片曲面复用原图，中间用同色圆润发边连接。左右和前后位置适用于所有发片。上传素材建议用与原图对齐的透明 PNG。</p>
   <div className="hair-buttons"><button disabled={hair.extras.length>=6} onClick={()=>add('back1')}>＋ 用后发1加一层</button><button disabled={hair.extras.length>=6} onClick={()=>add('back2')}>＋ 用后发2加一层</button><label className="hair-upload">＋ 上传额外发片<input disabled={hair.extras.length>=6} type="file" accept="image/png,image/webp" onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label></div>
   {error&&<p role="alert">{error}</p>}
  </div>
 </div>;
}
