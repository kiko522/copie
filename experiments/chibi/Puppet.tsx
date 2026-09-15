import React,{useEffect,useRef,useState} from 'react';
import * as T from 'three';
import {buildBody,loadBody} from './FbxBody';
import type {HairSettings,Parts,Motion} from '../../apps/room3d/chibi/types';
export type {Parts,Motion};
export function Puppet({parts,yaw,motion,wire,playing,appearance='outfit',hair}:{hair?:HairSettings;parts:Parts;yaw:number;motion:Motion;wire:boolean;playing:boolean;appearance?:'skin'|'hair'|'outfit'}){
 const host=useRef<HTMLDivElement>(null),rig=useRef<ReturnType<typeof buildBody>>(),wake=useRef(()=>{});
 const controls=useRef({yaw,motion,wire,playing});controls.current={yaw,motion,wire,playing};
 const [source,setSource]=useState<T.Group>(),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false,loaded:T.Group|undefined;const release=()=>loaded?.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});loadBody().then(m=>{loaded=m;if(cancelled)release();else setSource(m);}).catch(e=>{if(!cancelled)setError(String(e));});return()=>{cancelled=true;release();};},[]);
 const scene=useRef<T.Scene>();
 useEffect(()=>{
  const element=host.current!;let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:true});}catch(e){setError(String(e));return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));element.appendChild(renderer.domElement);
  const world=new T.Scene();scene.current=world;
  world.add(new T.AmbientLight('#ffffff',.65),new T.HemisphereLight('#ffffff','#ede6df',1.9));
  const key=new T.DirectionalLight('#fff8ef',.65);key.position.set(-3,5,5);world.add(key);
  const fill=new T.DirectionalLight('#f1f4ff',.35);fill.position.set(3,2,-4);world.add(fill);
  const floor=new T.Mesh(new T.CircleGeometry(1.8,48),new T.MeshStandardMaterial({color:'#ddd5c7',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=.015;world.add(floor);
  const camera=new T.OrthographicCamera(-1.6,1.6,1.6,-1.6,.1,30);camera.position.set(0,1.1,6);camera.lookAt(0,1.1,0);
  let frame=0,disposed=false,time=0,previous=0,lastDraw=0,dirty=true,lastRig:typeof rig.current,lastMotion:Motion|undefined,frames=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const schedule=()=>{dirty=true;if(!disposed&&!document.hidden&&!frame)frame=requestAnimationFrame(draw);};wake.current=schedule;
  function draw(stamp:number){frame=0;if(disposed||document.hidden)return;const c=controls.current,r=rig.current,animate=c.playing&&!reduced.matches;
   const dt=previous?Math.min((stamp-previous)/1000,.05):0;previous=stamp;if(animate)time+=dt;
   if(dirty||stamp-lastDraw>=1000/30){
    if(r){if(r!==lastRig||c.motion!==lastMotion){time=0;r.animate(0,c.motion);}else if(animate)r.animate(time,c.motion);r.root.rotation.y=c.yaw*Math.PI/180;r.root.traverse(o=>{if(o instanceof T.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material])m.wireframe=c.wire;});lastRig=r;lastMotion=c.motion;}
    renderer.render(world,camera);frames++;element.dataset.frames=String(frames);element.dataset.drawCalls=String(renderer.info.render.calls);element.dataset.triangles=String(renderer.info.render.triangles);dirty=false;lastDraw=stamp;
   }
   if(animate)frame=requestAnimationFrame(draw);
  }
  const resize=()=>{const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;renderer.setSize(w,h);const aspect=w/h,half=Math.max(1.48,1.22/aspect);camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();schedule();};
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const visibility=()=>{previous=0;if(document.hidden){cancelAnimationFrame(frame);frame=0;}else schedule();};document.addEventListener('visibilitychange',visibility);
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',visibility);wake.current=()=>{};scene.current=undefined;floor.geometry.dispose();floor.material.dispose();renderer.dispose();renderer.domElement.remove();};
 },[]);
 useEffect(()=>{if(!source||!scene.current)return;let next:ReturnType<typeof buildBody>|undefined;try{next=buildBody(source,parts,appearance,hair);rig.current=next;scene.current.add(next.root);setError('');wake.current();}catch(e){setError(String(e));}return()=>{next?.root.removeFromParent();next?.resources.forEach(r=>r.dispose());if(rig.current===next)rig.current=undefined;};},[source,parts,appearance,hair]);
 useEffect(()=>{wake.current();},[yaw,motion,wire,playing]);
 return <div ref={host} className="puppet">{error&&<p role="alert">{error}</p>}{!source&&!error&&<p>正在加载小人…</p>}</div>;
}
