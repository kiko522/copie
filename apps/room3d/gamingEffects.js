import {rhythmFrame} from './rhythm.js';
import * as T from 'three';
// Only the active station's material is temporarily cloned. Restored/disposed on
// stop and before rebuilding; no new meshes, textures or geometry during animation.
export function createGamingEffects(){
 let entries=[],key='';const v=new T.Vector3(),axis=new T.Vector3(0,0,1);
 function clear(){for(const e of entries){e.mesh.position.copy(e.position);e.mesh.rotation.copy(e.rotation);if(e.material){e.mesh.material=e.original;e.material.dispose();}}entries=[];key='';}
 function update(objects,activity,time){
  const next=activity?activity.itemId+'/'+activity.kind+'/'+(activity.stationId||''):'';
  if(next!==key){clear();key=next;if(activity)for(const obj of objects){if(obj.userData.itemId!==activity.itemId&&!activity.dependencies.includes(obj.userData.itemId))continue;
   obj.traverse(mesh=>{if(!mesh.isMesh||Array.isArray(mesh.material))return;const wheel=mesh.userData.gamingRole==='wheel',role=mesh.userData.gamingRole,lit=role==='rhythm-button'||role?.startsWith('rhythm-key-')||mesh.material.name==='gaming-screen';if(!wheel&&!lit)return;
    mesh.geometry.computeBoundingBox();const e={mesh,wheel,role,position:mesh.position.clone(),rotation:mesh.rotation.clone(),center:mesh.geometry.boundingBox.getCenter(new T.Vector3())};if(lit){e.original=mesh.material;e.material=mesh.material.clone();mesh.material=e.material;}entries.push(e);
   });
  }}
  const beat=activity?.kind==='rhythm'?rhythmFrame(activity,time):null;
  for(const e of entries){if(e.wheel&&activity?.kind==='race'){const angle=Math.sin(time*1.9)*.31;e.mesh.rotation.z=angle;v.copy(e.center).applyAxisAngle(axis,angle);e.mesh.position.copy(e.position).add(e.center).sub(v);}if(e.material){e.material.emissive.copy(e.material.color);e.material.emissiveIntensity=e.role?.startsWith('rhythm-key-')?(beat?.keys.includes(e.role)?.85:.025):.16+.12*(.5+.5*Math.sin(time*4));}}
 }
 return {update,clear};
}
