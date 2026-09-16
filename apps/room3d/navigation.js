import {ROOM_HALF} from './dimensions.js';
import {boxes} from './model.js';
import {ROOM_EDGES} from './building.js';
import {boundary,boundaryBoxes,ROOM_STEP,neighbor,insideFloors} from './topology.js';
export function walkingMap(home,level,catalog,{headWidth=1.5}={}){
 const cells=[],areas=[],obstacles=[];const half=Math.max(.75,headWidth/2);
 for(const room of home.rooms.filter(r=>r.level===level)){
  const start=cells.length,x=room.x*ROOM_STEP.x,z=room.z*ROOM_STEP.z;cells.push([x-ROOM_HALF.x,z-ROOM_HALF.z,x+ROOM_HALF.x,z+ROOM_HALF.z]);
  for(const [edge,e] of Object.entries(ROOM_EDGES)){const door=boundary(room,edge).door;if(!door||neighbor(home,room,edge))continue;
   const lo=door.at-door.width/2-.35,hi=door.at+door.width/2+.35,at=e.at,sign=Math.sign(at),a=at-sign*.3,b=at+sign*2.2;
   cells.push(e.axis==='z'?[x+lo,z+Math.min(a,b),x+hi,z+Math.max(a,b)]:[x+Math.min(a,b),z+lo,x+Math.max(a,b),z+hi]);
  }
  areas.push(...cells.slice(start).map(rect=>({roomId:room.id,rect})));
  const local=[...boundaryBoxes(room,catalog),...room.items.filter(i=>!i.stored&&!catalog.find(a=>a.id===i.assetId)?.building&&!['rug','ceiling'].includes(catalog.find(a=>a.id===i.assetId)?.surface)).flatMap(i=>boxes(i,catalog.find(a=>a.id===i.assetId)))];
  obstacles.push(...local.map(b=>[b[0]+x,b[1],b[2]+z,b[3]+x,b[4],b[5]+z]));
  // Freestanding walls are obstacles too (edge segments already included above).
  for(const i of room.items.filter(i=>!i.stored&&catalog.find(a=>a.id===i.assetId)?.building))obstacles.push(...boxes(i,catalog.find(a=>a.id===i.assetId)).map(b=>[b[0]+x,b[1],b[2]+z,b[3]+x,b[4],b[5]+z]));
 }
 const free=(x,z)=>{
  // Reserve the head width in both directions, including while turning.
  if(!insideFloors([x-half,z-half,x+half,z+half],cells))return false;
  const body=[x-.28,.18,z-.28,x+.28,.7,z+.28],head=[x-half,.7,z-half,x+half,1.95,z+half];
  return !obstacles.some(b=>[body,head].some(a=>a[0]<b[3]&&a[3]>b[0]&&a[1]<b[4]&&a[4]>b[1]&&a[2]<b[5]&&a[5]>b[2]));
 };
 return {free,cells,obstacles,areas};
}
export function findWalkPath(map,start,target){
 const step=.2,key=(x,z)=>x+','+z,point=([x,z])=>[x*step,z*step];
 const clear=(a,b)=>{const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.07));for(let i=0;i<=n;i++)if(!map.free(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n))return false;return true;};
 if(!map.free(...start)||!map.free(...target))return null;
 if(clear(start,target))return [start,target];
 const source=start.map(v=>Math.round(v/step)),goal=target.map(v=>Math.round(v/step));
 if(!clear(start,point(source))||!clear(point(goal),target))return null;
 const queue=[source],parents=new Map([[key(...source),null]]);let end=null;
 for(let n=0;n<queue.length&&n<40000;n++){
  const p=queue[n];if(p[0]===goal[0]&&p[1]===goal[1]){end=p;break;}
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
   const next=[p[0]+dx,p[1]+dz],id=key(...next);if(parents.has(id)||!map.free(...point(next)))continue;
   if(dx&&dz&&(!map.free(...point([p[0]+dx,p[1]]))||!map.free(...point([p[0],p[1]+dz]))))continue;
   parents.set(id,p);queue.push(next);
  }
 }
 if(!end)return null;const path=[target];for(let p=end;p;p=parents.get(key(...p)))path.push(point(p));path.push(start);path.reverse();
 // Remove grid zigzags without cutting corners; do not overshoot the destination
 // and turn backwards for the final few centimetres.
 const smooth=[start];for(let i=0;i<path.length-1;){let j=path.length-1;while(j>i+1&&!clear(path[i],path[j]))j--;smooth.push(path[j]);i=j;}return smooth;
}
export function doorTarget(home,room,edge,outside=false){
 const e=ROOM_EDGES[edge],d=boundary(room,edge).door;if(!d)return null;
 const sign=Math.sign(e.at),normal=e.at+sign*(outside?-1:1)*1.05;
 return e.axis==='z'?[room.x*ROOM_STEP.x+d.at,room.z*ROOM_STEP.z+normal]:[room.x*ROOM_STEP.x+normal,room.z*ROOM_STEP.z+d.at];
}
