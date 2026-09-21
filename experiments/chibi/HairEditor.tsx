import React,{useState,useEffect} from 'react';
import {Puppet} from './Puppet';
import {BodyControls} from './BodyControls';
import {WardrobePicker} from './WardrobePicker';
import {defaultHairLayer,hairMode,bodyProportions,type HairSettings,type HairLayer,type Parts} from '../../apps/room3d/chibi/types';
import './hair-editor.css';
export function HairEditor({parts,hair,previewHair,assets,onChange,onUndo,onRedo,onReset,canUndo,canRedo,onBegin,onEnd}:{parts:Parts;hair:HairSettings;previewHair:HairSettings;assets:Record<string,string>;onChange:(v:HairSettings)=>void;onUndo:()=>void;onRedo:()=>void;onReset:()=>void;canUndo:boolean;canRedo:boolean;onBegin:()=>void;onEnd:()=>void}){
 const [category,setCategory]=useState<'clothes'|'hair'|'head'|'body'>('clothes');
 const [selected,setSelected]=useState('fronthair'),[yaw,setYaw]=useState(8),[error,setError]=useState(''),[playing,setPlaying]=useState(true),[bare,setBare]=useState(false);
 const focus=category==='hair'||category==='head'?'head':'body';
 useEffect(()=>{if(!['fronthair','earhair','back1','back2','outfit','outer'].includes(selected)&&!hair.extras.some(e=>e.id===selected))setSelected('back2');},[hair.extras,selected]);
 const extra=hair.extras.find(e=>e.id===selected),layer=extra??hair.layers[selected]??defaultHairLayer;
 const update=(patch:Partial<HairLayer>)=>onChange(extra?{...hair,extras:hair.extras.map(e=>e.id===selected?{...e,...patch}:e)}:{...hair,layers:{...hair.layers,[selected]:{...layer,...patch}}});
 const add=(source:string,src?:string)=>{const id=crypto.randomUUID();onChange({...hair,extras:[...hair.extras,{...defaultHairLayer,id,source:src?id:source,src,distance:.12+hair.extras.length*.06}]});setSelected(id);};
 const upload=async(file?:File)=>{if(!file)return;try{setError('');if(file.size>5*1024*1024)throw Error('请选择小于 5 MB 的透明图片');const src=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});const image=new Image();image.src=src;await image.decode();add('',src);}catch(e){setError(String(e));}};
 const sliderEvents={onPointerDown:onBegin,onPointerUp:onEnd,onPointerCancel:onEnd,onBlur:onEnd,onKeyDown:(e:React.KeyboardEvent)=>{if(!e.repeat&&e.key.startsWith('Arrow'))onBegin();},onKeyUp:onEnd};
 return <div className="hair-editor">
  <div className="hair-preview" aria-label="角色预览">
   <Puppet parts={parts} hair={previewHair} yaw={yaw} motion="idle" wire={false} playing={playing} appearance={bare?'skin':'outfit'} focus={focus} wardrobeStyle={hair.wardrobeStyle??'normal'}/>
   <div className="preview-tools"><button aria-pressed={bare} onClick={()=>setBare(!bare)}>{bare?'穿回衣服':'查看素体'}</button><button aria-pressed={!playing} onClick={()=>setPlaying(!playing)}>{playing?'暂停动作':'播放动作'}</button><button onClick={()=>setYaw(0)}>正面</button></div>
   <div className="preview-caption"><span>{focus==='head'?'头部特写':'全身预览'}</span><select aria-label="试衣站姿" value={hair.wardrobeStyle??'normal'} onChange={e=>onChange({...hair,wardrobeStyle:e.target.value as 'boy'|'cute'|'normal'})}><option value="normal">普通站姿</option><option value="boy">叉腰</option><option value="cute">可爱</option></select></div>
   <label className="hair-angle"><span>转向</span><input aria-label="3D 预览转角" type="range" min={-180} max={180} value={yaw} onChange={e=>setYaw(+e.target.value)}/><output>{yaw}°</output></label>
  </div>
  <section className="creator-inspector" aria-label="角色调整">
   <nav className="creator-categories" aria-label="调整分类">{([['clothes','衣橱'],['hair','头发'],['head','头部'],['body','体型']] as const).map(([key,label])=><button key={key} aria-pressed={category===key} onClick={()=>setCategory(key)}>{label}</button>)}</nav>
   <div className="hair-options" key={category}>
   {category==='clothes'&&<WardrobePicker hair={hair} onBegin={onBegin} onEnd={onEnd} onChange={next=>{setBare(false);onChange(next);}}/>}
   {category==='hair'&&<>
    <nav className="garment-slots" aria-label="头发分层">{[['fronthair','前发'],['earhair','耳发'],['back1','后发 1'],['back2','后发 2'],...hair.extras.map((e,i)=>[e.id,`发片 ${i+1}`])].map(([id,label])=><button key={id} aria-pressed={selected===id} onClick={()=>setSelected(id)}>{label}</button>)}</nav>
    <label className="creator-select">发型走向<select aria-label="素材分类" value={extra?.mode??hairMode({...hair,assets},selected)} onChange={e=>{const mode=e.target.value as 'wrap'|'project';if(extra||!assets[selected])update({mode});else onChange({...hair,assetModes:{...hair.assetModes,[assets[selected]]:mode}});}}><option value="wrap">贴头包裹</option><option value="project">向外伸出</option></select></label>
    {([['length','长度',.25,2],['width','宽度',.4,2],['offsetY','上下位置',-.8,.8],['offsetX','左右位置',-1.5,1.5],['offsetZ','前后位置',-1.5,1.5],['puff','发片厚度',0,.5]] as const).map(([key,label,min,max])=><label className="creator-slider" key={key}><span>{label}</span><input aria-label={`${label}调节`} type="range" min={min} max={max} step={.01} {...sliderEvents} value={layer[key]??defaultHairLayer[key]} onChange={e=>update({[key]:+e.target.value})}/><output>{(layer[key]??defaultHairLayer[key]??0).toFixed(2)}</output></label>)}
    <div className="hair-buttons"><button onClick={()=>update(defaultHairLayer)}>重置这一层</button>{extra&&<button onClick={()=>{onChange({...hair,extras:hair.extras.filter(e=>e.id!==selected)});setSelected('back1');}}>删除发片</button>}</div>
    <details><summary>添加发片</summary><div className="hair-buttons"><button disabled={hair.extras.length>=6} onClick={()=>add('back1')}>使用后发 1</button><button disabled={hair.extras.length>=6} onClick={()=>add('back2')}>使用后发 2</button><label className="hair-upload">上传透明图片<input disabled={hair.extras.length>=6} type="file" accept="image/png,image/webp" onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}}/></label></div></details>
   </>}
   {category==='head'&&<><h2>头部比例</h2><label className="creator-slider"><span>头大小</span><input aria-label="头大小" type="range" min={75} max={140} value={Math.round(bodyProportions(hair).headSize*100)} {...sliderEvents} onChange={e=>onChange({...hair,headSize:+e.target.value/100})}/><output>{Math.round(bodyProportions(hair).headSize*100)}%</output></label><p>头发和五官跟随头部一起调整。</p><button onClick={()=>onChange({...hair,headSize:1.04})}>恢复头部比例</button></>}
   {category==='body'&&<><label className="creator-select">身体比例<select aria-label="身体比例" value={hair.bodyShape??'classic'} onChange={e=>onChange({...hair,bodyShape:e.target.value as 'classic'|'blank'})}><option value="classic">原版 · 圆润</option><option value="blank">骨骼素体</option></select></label>{hair.bodyShape==='blank'&&<BodyControls hair={hair} onChange={onChange} onBegin={onBegin} onEnd={onEnd}/>}<details><summary>原版衣服长度</summary>{(['outfit','outer'] as const).map(key=><label className="creator-slider" key={key}><span>{key==='outfit'?'衣服':'外套'}</span><input aria-label={`原版${key==='outfit'?'衣服':'外套'}长度`} type="range" min={0} max={2} step={.01} {...sliderEvents} value={hair.layers[key]?.length??1} onChange={e=>onChange({...hair,layers:{...hair.layers,[key]:{...defaultHairLayer,...hair.layers[key],length:+e.target.value}}})}/></label>)}</details></>}
   {error&&<p role="alert">{error}</p>}
   </div>
   <div className="creator-history"><button disabled={!canUndo} onClick={onUndo} aria-label="撤销">↶ 撤销</button><button disabled={!canRedo} onClick={onRedo} aria-label="重做">↷ 重做</button><button className="reset-all" onClick={onReset}>恢复默认</button></div>
  </section>
 </div>;
}
