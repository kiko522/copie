import * as T from 'three';
import data from './hoodieClothes.json';
import {BLANK_SCALE} from './blankBody';
import type {bindBlankBody} from './blankRig';

/** Extracted Meshy garment, retargeted from its A-pose into the body's bind pose. */
export function dressHoodie(rig:ReturnType<typeof bindBlankBody>){
 const body=rig.mesh.geometry,p=body.attributes.position,si=body.attributes.skinIndex,sw=body.attributes.skinWeight;
 const resources:Array<{dispose():void}>=[],meshes:T.SkinnedMesh[]=[];
 data.forEach((part,partIndex)=>{
  const positions:number[]=[],skinIndex:number[]=[],skinWeight:number[]=[];
  for(let i=0;i<part.positions.length;i+=3){
   const [x,y,z]=part.positions.slice(i,i+3),side=Math.sign(x),ax=Math.abs(x);
   let tx=x*.94,ty=y*.82-.0207,tz=z*1.04;
   if(partIndex===0){
    const sleeveEdge=.095+.05*(1-T.MathUtils.smoothstep(y,-.14,-.07))-.035*T.MathUtils.smoothstep(y,.03,.13);
    const blend=T.MathUtils.smoothstep(ax,sleeveEdge,sleeveEdge+.025);
    const angle=57*Math.PI/180,dx=ax-.068,dy=y-.135;
    const armX=side*(.063+dx*Math.cos(angle)-dy*Math.sin(angle)),armY=.090+(dx*Math.sin(angle)+dy*Math.cos(angle))*.95;
    tx=T.MathUtils.lerp(tx,armX,blend);ty=T.MathUtils.lerp(ty,armY,blend);
   }else{tx=x*.94;ty=y;tz=z;}
   const v=new T.Vector3(tx,(ty+.5),tz).multiplyScalar(BLANK_SCALE);positions.push(v.x,v.y,v.z);
   let nearest=0,distance=Infinity;
   for(let k=0;k<p.count;k++){const d=(p.getX(k)-v.x)**2+(p.getY(k)-v.y)**2+(p.getZ(k)-v.z)**2;if(d<distance){distance=d;nearest=k;}}
   for(let j=0;j<4;j++){let index=si.array[nearest*4+j];
    // The hood belongs to the shoulders, not the head it surrounds.
    if(partIndex===0&&['head','neck'].includes(rig.skeleton.bones[index].name))index=rig.skeleton.bones.indexOf(rig.bones.chest);
    skinIndex.push(index);skinWeight.push(sw.array[nearest*4+j]);
   }
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(part.indices);geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndex,4));geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeight,4));geometry.computeVertexNormals();
  const material=new T.MeshStandardMaterial({color:partIndex?'#f3eee7':'#d994ae',roughness:1,metalness:0,side:T.DoubleSide});
  let materials:T.Material|T.Material[]=material;
  if(partIndex){
   const shoeMaterial=new T.MeshStandardMaterial({color:'#30231f',roughness:1,metalness:0,side:T.DoubleSide});resources.push(shoeMaterial);materials=[material,shoeMaterial];
   const socks:number[]=[],shoes:number[]=[];
   for(let i=0;i<part.indices.length;i+=3){const ids=part.indices.slice(i,i+3),height=ids.reduce((sum,id)=>sum+part.positions[id*3+1],0)/3;(height<-.427?shoes:socks).push(...ids);}
   geometry.setIndex([...socks,...shoes]);geometry.addGroup(0,socks.length,0);geometry.addGroup(socks.length,shoes.length,1);
  }
  const mesh=new T.SkinnedMesh(geometry,materials);mesh.name=partIndex?'hoodie-boots':'hoodie-top';mesh.frustumCulled=false;rig.mesh.parent!.add(mesh);mesh.bind(rig.skeleton,rig.mesh.bindMatrix);resources.push(geometry,material);meshes.push(mesh);
 });
 const original=body.index!.clone(),groups=body.groups.map(g=>({...g})),masked:number[]=[],maskedGroups:typeof body.groups=[];
 for(const group of groups){const start=masked.length;
  for(let i=group.start;i<group.start+group.count;i+=3){const ids=[0,1,2].map(j=>original.getX(i+j));
   // All corners must belong to ONE covered region. A long simplified triangle
   // may span from shirt to boot while its middle is exposed thigh.
   const regions=[(x:number,y:number)=>y<-.244,(x:number,y:number)=>y>-.126&&y<.122&&x<.10,(x:number,y:number)=>x>=.10&&x<.298&&y>.015&&y<.135];
   const covered=regions.some(region=>ids.every(id=>region(Math.abs(p.getX(id))/BLANK_SCALE,p.getY(id)/BLANK_SCALE-.5)));
   if(!covered)masked.push(...ids);
  }maskedGroups.push({start,count:masked.length-start,materialIndex:group.materialIndex});
 }
 const setVisible=(visible:boolean)=>{meshes.forEach(m=>m.visible=visible);body.setIndex(visible?masked:original);body.clearGroups();for(const g of visible?maskedGroups:groups)body.addGroup(g.start,g.count,g.materialIndex);};
 setVisible(true);
 return {meshes,resources,setVisible,triangles:data.reduce((sum,p)=>sum+p.indices.length/3,0)};
}
