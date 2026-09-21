import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {createBlankBody} from '../apps/room3d/chibi/blankBody';
import {bindBlankBody} from '../apps/room3d/chibi/blankRig';
import {createBlankMotion} from '../apps/room3d/chibi/blankMotion';
import {dressApprovedWardrobe} from '../apps/room3d/chibi/approvedClothing';

// Load the shipped geometry, skin and scene placement in Node. Image decoding
// is irrelevant to this regression; replace materials, not the real mesh data.
function loadLocalAssets(){
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async url=>{
  const file=String(url).split('/').pop()!.split('?')[0];
  const bytes=readFileSync(`public/room3d/wardrobe/${file}`),oldLength=bytes.readUInt32LE(12);
  const doc=JSON.parse(bytes.subarray(20,20+oldLength).toString()),binary=bytes.subarray(28+oldLength);
  doc.images=[];doc.textures=[];doc.materials=[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}];
  for(const mesh of doc.meshes)for(const primitive of mesh.primitives)primitive.material=0;
  const json=Buffer.from(JSON.stringify(doc)),length=Math.ceil(json.length/4)*4,out=Buffer.alloc(28+length+binary.length);
  out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(length,12);out.writeUInt32LE(0x4e4f534a,16);out.fill(32,20,20+length);json.copy(out,20);out.writeUInt32LE(binary.length,20+length);out.writeUInt32LE(0x004e4942,24+length);binary.copy(out,28+length);
  return new GLTFLoader().parseAsync(out.buffer.slice(out.byteOffset,out.byteOffset+out.length),'');
 });
}
function makeRig(height=1){
 const root=new T.Group(),hair=new T.Group(),body=new T.Mesh(createBlankBody('skin',{bodyHeight:height,headSize:1.04}),Array(6).fill(new T.MeshBasicMaterial()));root.add(body,hair);
 return {root,rig:bindBlankBody(body,hair,true)};
}
const referenced=(g:T.BufferGeometry)=>new Set(Array.from(g.index!.array));
afterEach(()=>vi.restoreAllMocks());

describe('footwear on the current body',()=>{
 it('plants geta once, preserves the open foot, and restores the body on removal',async()=>{
  loadLocalAssets();
  for(const height of [.8,1,1.25]){
   const {root,rig}=makeRig(height),original=rig.mesh.geometry;
   const outfit=await dressApprovedWardrobe(rig,{shoes:'shoe-geta'});
   root.updateMatrixWorld(true);rig.skeleton.update();
   expect(Array.from(rig.mesh.geometry.index!.array)).toEqual(Array.from(original.index!.array));
   const box=new T.Box3();for(const mesh of outfit.meshes){mesh.computeBoundingBox();box.union(new T.Box3().setFromObject(mesh));}
   expect(box.min.y).toBeCloseTo(0,4);
   const point=new T.Vector3();let minFoot=Infinity;
   for(const i of referenced(original)){point.fromBufferAttribute(original.attributes.position,i);rig.mesh.applyBoneTransform(i,point).applyMatrix4(rig.mesh.matrixWorld);minFoot=Math.min(minFoot,point.y);}
   expect(minFoot).toBeGreaterThan(.17*height);expect(minFoot).toBeLessThan(.20*height);
   outfit.dispose();expect(root.position.y).toBeCloseTo(0,8);expect(rig.mesh.geometry).toBe(original);
  }
 });
 it('keeps the ankle above a loafer opening even when the tongue is higher',async()=>{
  loadLocalAssets();const {rig}=makeRig(),original=rig.mesh.geometry;
  const outfit=await dressApprovedWardrobe(rig,{shoes:'school-loafers'}),used=referenced(rig.mesh.geometry);
  const ankle=[...referenced(original)].filter(i=>{const y=original.attributes.position.getY(i);return y>.34&&y<.46;});
  expect(ankle.length).toBeGreaterThan(4);for(const i of ankle)expect(used.has(i),`visible ankle vertex ${i}`).toBe(true);
  outfit.dispose();
 });
 it('retains geta support while the real motion system writes the body position',async()=>{
  loadLocalAssets();const {root,rig}=makeRig(),animate=createBlankMotion(rig,root);
  const outfit=await dressApprovedWardrobe(rig,{shoes:'shoe-geta'});
  animate(0,'walk','standing');for(let t=1;t<=60;t++)animate(t/30,'walk','standing');
  expect(root.position.y).toBeCloseTo(.18,5);
  animate(3,'sit','seated');for(let t=1;t<=60;t++)animate(3+t/30,'sit','seated');
  expect(root.userData.wardrobeLift.applied).toBeLessThan(.001);
  const seatedY=root.position.y;outfit.dispose();expect(root.position.y).toBeCloseTo(seatedY,3);
 });
 it('does not cut a sock up to the loafer tongue or remove it on open sandals',async()=>{
  loadLocalAssets();
  for(const shoes of ['school-loafers','shoe-geta']){
   const {rig}=makeRig(),outfit=await dressApprovedWardrobe(rig,{shoes,socks:'school-socks'});
   const sock=outfit.meshes.find(m=>m.userData.garmentId==='school-socks')!,used=referenced(sock.geometry);
   const min=Math.min(...[...used].map(i=>sock.geometry.attributes.position.getY(i)));
   expect(min).toBeLessThan(shoes==='shoe-geta'?.02:.30);
   expect(min).toBeGreaterThan(shoes==='shoe-geta'?-.02:.24);
   outfit.dispose();
  }
 });
 it('hides boot shafts buried in long trousers and restores them when trousers are removed',async()=>{
  loadLocalAssets();const {rig}=makeRig();
  const withTrousers=await dressApprovedWardrobe(rig,{shoes:'tall-boots',bottom:'lower-cargo'});
  const shoe=withTrousers.meshes.find(m=>m.userData.garmentId==='tall-boots')!;
  const top=Math.max(...[...referenced(shoe.geometry)].map(i=>shoe.geometry.attributes.position.getY(i)));
  // The cargo cuff rises to .55; its low hanging folds reach .30 and must not
  // be mistaken for the opening, or the remaining boot ends visibly too low.
  expect(top).toBeLessThan(.64);expect(top).toBeGreaterThan(.55);
  withTrousers.dispose();const bareBoot=await dressApprovedWardrobe(rig,{shoes:'tall-boots'});
  const restored=bareBoot.meshes.find(m=>m.userData.garmentId==='tall-boots')!;
  expect(Math.max(...[...referenced(restored.geometry)].map(i=>restored.geometry.attributes.position.getY(i)))).toBeGreaterThan(1.2);
  bareBoot.dispose();
 });
});
