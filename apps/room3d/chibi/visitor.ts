import * as THREE from 'three';
import {buildBody,loadBody} from './FbxBody';
import type {Parts,Motion} from './types';
import type {RollResult} from './CreatorRollBridge';

export async function decodeParts(result:RollResult):Promise<Parts>{
 const parts:Parts={};
 await Promise.all(Object.entries(result.layers).map(async([key,url])=>{const img=new Image();img.src=url;await img.decode();parts[key]=img;}));
 if(parts.outer&&parts.outfit){const c=document.createElement('canvas');c.width=c.height=472;const ctx=c.getContext('2d')!;ctx.drawImage(parts.outfit,0,0);ctx.drawImage(parts.outer,0,0);const img=new Image();img.src=c.toDataURL();await img.decode();parts.outfit=img;}
 return parts;
}
export async function createVisitor(parts:Parts){
 const source=await loadBody();
 let body:ReturnType<typeof buildBody>;
 try{body=buildBody(source,parts,'outfit');}
 finally{source.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
 const root=new THREE.Group();root.name='little-world-chibi';root.add(body.root);body.root.scale.setScalar(.7);
 // Keep the painted features legible under the room's brighter directional light.
 body.root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=false;o.receiveShadow=false;for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial){m.emissive.copy(m.color);m.emissiveIntensity=.12;}}});
 let disposed=false;
 return {root,animate(time:number,motion:Motion){body.animate(time,motion);},dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const resource of body.resources)resource.dispose();}};
}
export type ChibiVisitor=Awaited<ReturnType<typeof createVisitor>>;
