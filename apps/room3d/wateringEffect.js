import * as T from 'three';
// Tiny shared meshes, no textures, particles or extra animation loop.
export function createWateringEffect(){
 const root=new T.Group(),can=new T.Group();root.add(can);root.visible=false;
 const mint=new T.MeshStandardMaterial({color:'#a5bfaf',roughness:.8}),water=new T.MeshBasicMaterial({color:'#92c9e0'});
 function add(g,m,p,rotation){const o=new T.Mesh(g,m);o.position.fromArray(p);if(rotation)o.rotation.fromArray(rotation);can.add(o);return o;}
 add(new T.CylinderGeometry(.11,.13,.18,16),mint,[0,0,0]);
 add(new T.TorusGeometry(.105,.022,6,16),mint,[-.12,.03,0],[0,Math.PI/2,0]);
 const start=new T.Vector3(0,-.02,.08),end=new T.Vector3(0,.05,.34),spout=add(new T.CylinderGeometry(.025,.042,start.distanceTo(end),10),mint,start.clone().add(end).multiplyScalar(.5).toArray());spout.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.clone().sub(start).normalize());
 const drops=Array.from({length:7},()=>{const o=new T.Mesh(new T.SphereGeometry(.013,6,4),water);root.add(o);return o;});
 return {root,update(time,spot){root.visible=!!spot;if(!spot)return;const tilt=.25+.07*Math.sin(time*2);can.position.set(.08,.36,.36);can.rotation.x=tilt;can.updateMatrix();const source=new T.Vector3(0,.05,.34).applyMatrix4(can.matrix);const distance=Math.hypot(spot.target[0]-spot.position[0],spot.target[2]-spot.position[2]);const target=new T.Vector3(0,spot.target[1]-.18,distance);drops.forEach((o,i)=>{const u=(time*1.1+i/7)%1;o.position.lerpVectors(source,target,u);o.position.y+=Math.sin(u*Math.PI)*.025;});},dispose(){root.traverse(o=>{if(o.isMesh)o.geometry.dispose();});mint.dispose();water.dispose();}};
}
