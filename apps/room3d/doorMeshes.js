import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
export function createDoor(door,color='#FFF2E3',trim='#A99BE8',highWall=false){
 const root=new T.Group(),frame=new T.MeshStandardMaterial({color:trim,roughness:.8}),leafMat=new T.MeshStandardMaterial({color,roughness:.9});frame.userData.owned=true;leafMat.userData.owned=true;
 const box=(parent,x,y,z,w,h,d,material=frame)=>{const geometry=new RoundedBoxGeometry(w,h,d,2,Math.min(.045,w/4,h/4,d/4));geometry.userData.owned=true;const mesh=new T.Mesh(geometry,material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;};
 const w=door.width;
 box(root,-w/2-.055,1.1,0,.11,2.2,.28);box(root,w/2+.055,1.1,0,.11,2.2,.28);
 if(door.kind==='arch'){
  const curve=new T.EllipseCurve(0,2.2,w/2+.055,.24,0,Math.PI,false,0),points=curve.getPoints(24).map(p=>new T.Vector3(p.x,p.y,0));
  const geometry=new T.TubeGeometry(new T.CatmullRomCurve3(points),24,.07,6,false);geometry.userData.owned=true;root.add(new T.Mesh(geometry,frame));
  if(highWall){
   const shape=new T.Shape();shape.moveTo(-w/2,4.65);shape.lineTo(-w/2,2.2);
   for(let i=0;i<=24;i++){const t=Math.PI-i*Math.PI/24;shape.lineTo(Math.cos(t)*(w/2),2.2+Math.sin(t)*.24);}
   shape.lineTo(w/2,4.65);shape.closePath();const g=new T.ExtrudeGeometry(shape,{depth:.22,bevelEnabled:false});g.translate(0,0,-.11);g.userData.owned=true;root.add(new T.Mesh(g,leafMat));
   box(root,0,4.595,0,w,.11,.24);
  }
 }else box(root,0,2.25,0,w+.22,.14,.3);
 const leaf=new T.Group();root.add(leaf);
 if(door.kind==='door'){leaf.position.x=-w/2;box(leaf,w/2,1.08,0,w-.03,2.12,.07,leafMat);box(leaf,w-.18,1.03,.065,.075,.075,.08);}
 if(door.kind==='sliding'){box(leaf,0,1.08,.07,w-.03,2.12,.065,leafMat);box(leaf,w/2-.18,1.1,.13,.055,.3,.04);}
 root.userData.doorLeaf=leaf;root.userData.doorKind=door.kind;root.userData.doorWidth=w;
 return root;
}
