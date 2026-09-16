import {ROOM_HALF} from './dimensions.js';
import {boxes,isWaterablePlant} from './model.js';

// Temporary interaction positions, never furniture state. Check the full head,
// including room edges, and retry all four sides when furniture changes.
export function wateringSpot(room,catalog,itemId){
 const item=room.items.find(i=>i.id===itemId&&!i.stored),asset=catalog.find(a=>a.id===item?.assetId);
 if(!item||!isWaterablePlant(asset))return null;
 const obstacles=room.items.filter(i=>!i.stored).flatMap(i=>{const a=catalog.find(a=>a.id===i.assetId);return !a||['rug','ceiling'].includes(a.surface)?[]:boxes(i,a);});
 const target=boxes(item,asset),minX=Math.min(...target.map(b=>b[0])),maxX=Math.max(...target.map(b=>b[3])),minZ=Math.min(...target.map(b=>b[2])),maxZ=Math.max(...target.map(b=>b[5]));
 for(const [side,x,z,rotation]of [['front',item.x,maxZ+.59,Math.PI],['right',maxX+.59,item.z,-Math.PI/2],['back',item.x,minZ-.59,0],['left',minX-.59,item.z,Math.PI/2]]){
  const turned=side==='left'||side==='right',hx=turned?.52:.70,hz=turned?.70:.52;
  if(x-hx< -ROOM_HALF.x+.14||x+hx>ROOM_HALF.x-.14||z-hz< -ROOM_HALF.z+.15||z+hz>ROOM_HALF.z-.15)continue;
  const body=[x-.28,.18,z-.28,x+.28,.70,z+.28],head=[x-hx,.70,z-hz,x+hx,1.8,z+hz];
  if(obstacles.some(b=>[body,head].some(a=>a[0]<b[3]&&a[3]>b[0]&&a[1]<b[4]&&a[4]>b[1]&&a[2]<b[5]&&a[5]>b[2])))continue;
  return {side,position:[x,.18,z],rotation,target:[item.x,item.y+.36,item.z]};
 }
 return null;
}
export function roomPlants(room,catalog){return room.items.filter(i=>!i.stored&&isWaterablePlant(catalog.find(a=>a.id===i.assetId))).map(i=>({itemId:i.id,label:catalog.find(a=>a.id===i.assetId).name,spot:wateringSpot(room,catalog,i.id)}));}
