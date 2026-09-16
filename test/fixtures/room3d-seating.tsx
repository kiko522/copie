import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CreatorRollBridge} from '../../apps/room3d/chibi/CreatorRollBridge';
import {decodeParts,createVisitor} from '../../apps/room3d/chibi/visitor';
import {mountHomeEditor} from '../../apps/room3d/editor.js';
import {createHome,findPlace} from '../../apps/room3d/model.js';
import '../../apps/room3d/editor.css';
import {seatTransform} from '../../apps/room3d/seating.js';
import * as THREE from 'three';
function Check(){
 const [request,setRequest]=useState(0);
 return <><div id="home"/><CreatorRollBridge request={request} onReady={()=>setRequest(1)} onError={message=>{throw Error(message)}} onResult={async result=>{
  const w=window as any;if(w.__homeEditor)return;
  const catalog=await fetch('/room3d/catalog.json').then(r=>r.json()),home=createHome(catalog),room=home.rooms[0];
  room.items.push(findPlace(catalog.find((a:any)=>a.id==='petal_sofa'),room,catalog));
  room.items.push(findPlace(catalog.find((a:any)=>a.id==='petal_armchair'),room,catalog));
  const editor=await mountHomeEditor(document.querySelector('#home')!,{assetBase:new URL('/room3d/',location.href).href,initialState:home});
  const parts=await decodeParts(result),visitor=await createVisitor(parts);editor.setVisitor!(visitor);
  w.showPair=async()=>{
   const companion=await createVisitor(parts),sofa=room.items.find(i=>i.assetId==='petal_sofa')!,seat=seatTransform(room,catalog,{roomId:room.id,itemId:sofa.id,seatId:'right'})!;
   companion.animate(1,'sit');companion.root.position.fromArray(seat.position);companion.root.position.y-=companion.seatOffset;companion.root.rotation.y=seat.rotation;visitor.root.parent!.parent!.add(companion.root);
   editor.advanceTime!(0);w.__companion=companion;
   const headBounds=(root:THREE.Object3D)=>{root.updateWorldMatrix(true,true);const box=new THREE.Box3();root.traverse(o=>{if(o.name==='chibi-body'&&o instanceof THREE.Mesh){const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)>.84)box.expandByPoint(o.localToWorld(new THREE.Vector3().fromBufferAttribute(p,i)));}});return box;};
   const left=headBounds(visitor.root),right=headBounds(companion.root);return {gap:right.min.x-left.max.x};
  };
  w.__homeEditor=editor;w.__visitor=visitor;w.render_game_to_text=()=>JSON.stringify(editor.inspect!());w.advanceTime=(ms:number)=>editor.advanceTime!(ms);
 }}/></>;
}
createRoot(document.querySelector('#root')!).render(<Check/>);
