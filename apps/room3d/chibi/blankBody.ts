import * as T from 'three';
import data from './blankBody.json';

// Keep the supplied one-piece head/neck/body topology intact.
export const BLANK_SCALE=1.875/.354;
export const BLANK_HEAD_BOTTOM=.15;
// Tiny T-Pose Figure keeps the supplied proportions, including its original head.
const LEG_ANKLE=-.44,LEG_HIP=-.14,LEG_EXTENSION=0;
const upperLift=(LEG_HIP-LEG_ANKLE)*LEG_EXTENSION;
// Register the artwork to the face area, not the full head/neck bounding box.
const ART_JAW=.205,ART_CROWN=.515;
export const BLANK_HAIR_Y_SCALE=(ART_CROWN-ART_JAW)*BLANK_SCALE/1.50;
export const BLANK_HAIR_PIVOT=(ART_JAW+.5+upperLift)*BLANK_SCALE+(.64-.70)*BLANK_HAIR_Y_SCALE;
export const BLANK_HAIR_Z_SCALE=.34*BLANK_SCALE/(1.51953125*.82);

export function createBlankBody(appearance:'skin'|'hair'|'outfit'){
 const g=new T.BufferGeometry(),positions:number[]=[],uv:number[]=[],buckets=Array.from({length:6},()=>[] as number[]);
 for(let i=0;i<data.positions.length;i+=3){
  const [x,y,z]=data.positions.slice(i,i+3);
  const legLift=T.MathUtils.clamp(y-LEG_ANKLE,0,LEG_HIP-LEG_ANKLE)*LEG_EXTENSION;
  positions.push(x*BLANK_SCALE,(y+.5+legLift)*BLANK_SCALE,z*BLANK_SCALE);
  const faceY=.70+(y-ART_JAW)/(.5-ART_JAW)*1.30;
  uv.push((237+x*BLANK_SCALE/1.875*325)/472,1-(424-faceY/2*336)/472);
 }
 for(let i=0;i<data.indices.length;i+=3){
  const tri=data.indices.slice(i,i+3);
  const x=tri.reduce((v,k)=>v+data.positions[k*3],0)/3,y=tri.reduce((v,k)=>v+data.positions[k*3+1],0)/3,z=tri.reduce((v,k)=>v+data.positions[k*3+2],0)/3;
  const ear=Math.abs(x)>.168&&y<.30;
  // A continuous dyed crown covers the scalp beneath the lowered fringe.
  const scalp=appearance!=='skin'&&y>BLANK_HEAD_BOTTOM&&!ear&&(z<0||y>.405||(Math.abs(x*BLANK_SCALE)>.55&&z<.095));
  // Below the jaw use the existing plain skin material, never projected face art.
  const material=y<=BLANK_HEAD_BOTTOM||ear?1:scalp?(z>0?4:5):(z>0?0:1);
  buckets[material].push(...tri);
 }
 const indices:number[]=[];
 buckets.forEach((bucket,material)=>{const start=indices.length;indices.push(...bucket);if(bucket.length)g.addGroup(start,bucket.length,material);});
 g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
 return g;
}
