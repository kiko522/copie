import * as T from 'three';
import source from './blankBody.json';
import {BLANK_SCALE} from './blankBody';

export type RigPose='bind'|'relaxed'|'reference'|'arm'|'knee'|'head';
const smooth=T.MathUtils.smoothstep;
// Little Figure source coordinates; preserve its original rest proportions.
const at=(x:number,y:number,z=0)=>new T.Vector3(x*BLANK_SCALE,(y+.5)*BLANK_SCALE,z*BLANK_SCALE);

export function bindBlankBody(original:T.Mesh,hair:T.Group){
 const bones:T.Bone[]=[],named:Record<string,T.Bone>={},indices:Record<string,number>={};
 const add=(name:string,parent:string|null,position:T.Vector3)=>{
  const bone=new T.Bone();bone.name=name;bone.position.copy(position);
  if(parent){const parentWorld=named[parent].userData.rest as T.Vector3;bone.position.sub(parentWorld);named[parent].add(bone);}
  bone.userData.rest=position.clone();indices[name]=bones.length;bones.push(bone);named[name]=bone;return bone;
 };
 add('root',null,new T.Vector3());add('hips','root',at(0,-.12));
 add('spine','hips',at(0,-.035));add('chest','spine',at(0,.078));
 add('neck','chest',at(0,.13));add('head','neck',at(0,.15));
 for(const [side,prefix] of [[1,'L'],[-1,'R']] as const){
  add(`${prefix}_clavicle`,'chest',at(side*.025,.092));
  add(`${prefix}_upperArm`,`${prefix}_clavicle`,at(side*.063,.090,-.002));
  add(`${prefix}_forearm`,`${prefix}_upperArm`,at(side*.21,.090,-.002));
  add(`${prefix}_hand`,`${prefix}_forearm`,at(side*.305,.090,.004));
  add(`${prefix}_thigh`,'hips',at(side*.049,-.13,.006));
  add(`${prefix}_shin`,`${prefix}_thigh`,at(side*.049,-.30,.012));
  add(`${prefix}_foot`,`${prefix}_shin`,at(side*.049,-.451,-.001));
  add(`${prefix}_toe`,`${prefix}_foot`,at(side*.049,-.483,.045));
 }
 const g=original.geometry,skinIndices:number[]=[],skinWeights:number[]=[];
 for(let i=0;i<g.attributes.position.count;i++){
  const [x,y,z]=source.positions.slice(i*3,i*3+3),ax=Math.abs(x),prefix=x>=0?'L':'R';
  const weights=new Map<string,number>();
  const put=(name:string,value:number)=>{if(value>0)weights.set(name,(weights.get(name)||0)+value);};
  if(y>.125){
   const head=smooth(y,.132,.158);put('neck',1-head);put('head',head);
  }else if(y<-.105){
   const leg=1-smooth(y,-.20,-.105),knee=smooth(y,-.33,-.27),ankle=1-smooth(y,-.47,-.43);
   const toes=(1-smooth(y,-.47,-.452))*smooth(z,.022,.061);
   put('hips',1-leg);put(`${prefix}_thigh`,leg*knee);
   put(`${prefix}_shin`,leg*(1-knee)*(1-ankle));
   put(`${prefix}_foot`,leg*(1-knee)*ankle*(1-toes));put(`${prefix}_toe`,leg*(1-knee)*ankle*toes);
  }else{
   // Share the outer shoulder with the upper arm around the narrower joint.
   const arm=smooth(ax,.047,.093)*smooth(y,.015,.06);
   const elbow=smooth(ax,.182,.235),wrist=smooth(ax,.284,.326),clavicle=1-smooth(ax,.05,.093);
   put(`${prefix}_clavicle`,arm*clavicle);put(`${prefix}_upperArm`,arm*(1-clavicle)*(1-elbow));
   put(`${prefix}_forearm`,arm*(1-clavicle)*elbow*(1-wrist));put(`${prefix}_hand`,arm*(1-clavicle)*elbow*wrist);
   const chest=smooth(y,-.015,.075),spine=smooth(y,-.105,-.025),neck=smooth(y,.10,.13);
   put('hips',(1-arm)*(1-spine));put('spine',(1-arm)*spine*(1-chest));
   put('chest',(1-arm)*spine*chest*(1-neck));put('neck',(1-arm)*spine*chest*neck);
  }
  const top=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=top.reduce((s,v)=>s+v[1],0);
  if(!sum)top.push(['hips',1]);
  for(let j=0;j<4;j++){skinIndices.push(top[j]?indices[top[j][0]]:0);skinWeights.push(top[j]?top[j][1]/(sum||1):0);}
 }
 g.setAttribute('skinIndex',new T.Uint16BufferAttribute(skinIndices,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(skinWeights,4));
 const mesh=new T.SkinnedMesh(g,original.material);mesh.name=original.name;mesh.castShadow=original.castShadow;mesh.receiveShadow=original.receiveShadow;mesh.frustumCulled=false;
 const parent=original.parent!;parent.remove(original);parent.add(mesh);mesh.add(bones[0]);
 parent.updateWorldMatrix(true,true);const skeleton=new T.Skeleton(bones);mesh.bind(skeleton);
 // Preserve the fitted rest placement while parenting all hair to the head bone.
 named.head.attach(hair);
 for(const bone of bones)delete bone.userData.rest;
 let current:RigPose='bind';
 const setPose=(pose:RigPose)=>{
  current=pose;for(const b of bones)b.rotation.set(0,0,0);
  if(pose!=='bind')for(const [side,prefix] of [[1,'L'],[-1,'R']] as const)named[`${prefix}_upperArm`].rotation.z=-side*1.15;
  if(pose==='reference'){
   // Quiet standing pose: planted feet, a slight torso lean and loose arms.
   named.spine.rotation.set(-.06,0,.025);
   named.chest.rotation.x=-.035;
   named.head.rotation.set(.075,-.10,-.025);
   for(const [side,prefix] of [[1,'L'],[-1,'R']] as const){
    named[`${prefix}_clavicle`].rotation.z=-side*.035;
    named[`${prefix}_upperArm`].rotation.set(.035,0,-side*1.43);
    named[`${prefix}_forearm`].rotation.set(-.08,0,-side*.025);
    named[`${prefix}_hand`].rotation.z=side*.075;
   }
  }
  if(pose==='arm'){named.L_upperArm.rotation.z=.25;named.L_forearm.rotation.z=1.05;named.L_hand.rotation.z=.12;}
  if(pose==='knee'){named.L_thigh.rotation.x=-.65;named.L_shin.rotation.x=1.15;named.L_foot.rotation.x=-.3;}
  if(pose==='head'){named.head.rotation.y=.48;named.head.rotation.z=.10;}
  mesh.updateWorldMatrix(true,true);skeleton.update();mesh.boundingBox=null;mesh.boundingSphere=null;
 };
 const inspect=()=>({bones:bones.length,vertices:g.attributes.position.count,pose:current,skinned:mesh.isSkinnedMesh});
 return {mesh,skeleton,bones:named,setPose,inspect};
}
