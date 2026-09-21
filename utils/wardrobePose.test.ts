import {afterAll,describe,expect,it} from 'vitest';
import * as T from 'three';
import {createBlankBody} from '../apps/room3d/chibi/blankBody';
import {bindBlankBody} from '../apps/room3d/chibi/blankRig';
import {createWardrobeEntrance,createWardrobePose} from '../experiments/chibi/wardrobePose';

const body=new T.Mesh(createBlankBody('skin'),new T.MeshBasicMaterial());
const root=new T.Group(),hair=new T.Group();root.add(body,hair);
const rig=bindBlankBody(body,hair);
afterAll(()=>{body.geometry.dispose();body.material.dispose();rig.skeleton.dispose();});

function rotationAt(clip:T.AnimationClip,bone:string,time:number){
 const track=clip.tracks.find(t=>t.name===`${bone}.quaternion`)!;
 return new T.Quaternion().fromArray(new T.QuaternionLinearInterpolant(track.times,track.values,4).evaluate(time));
}
function expectRotation(actual:T.Quaternion,expected:T.Quaternion){
 expect(Math.abs(actual.dot(expected))).toBeCloseTo(1,6);
}

describe('approved wardrobe standing pose',()=>{
 it('keeps the user-approved mirrored arm and wrist angles with 37% curled fingers',()=>{
  const normal=createWardrobePose(rig,'normal');
  const fingers:Record<string,T.Quaternion>={};
  for(const name of Object.keys(rig.bones))fingers[name]=new T.Quaternion();
  rig.setHandCurl('L',.37,fingers);rig.setHandCurl('R',.37,fingers);
  for(const time of [0,.65,2,3.75,4])for(const [side,sign] of [['L',1],['R',-1]] as const){
   expectRotation(rotationAt(normal,`${side}_upperArm`,time),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),-sign*T.MathUtils.degToRad(56.56204993541357)));
   expectRotation(rotationAt(normal,`${side}_forearm`,time),new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.degToRad(.22869034709255356),-sign*T.MathUtils.degToRad(4.355252461993468),-sign*T.MathUtils.degToRad(.4959975074129086))));
   expectRotation(rotationAt(normal,`${side}_hand`,time),new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.degToRad(-.5192085023702001),-sign*T.MathUtils.degToRad(.45153134734424705),sign*T.MathUtils.degToRad(39.05468920902148))));
   for(const name of Object.keys(fingers).filter(n=>n.startsWith(`${side}_`)&&/(thumb|index|middle|ring|pinky)/.test(n)))expectRotation(rotationAt(normal,name,time),fingers[name]);
   expectRotation(rotationAt(normal,'chest',time),new T.Quaternion());
  }
 });
 it('keeps normal unchanged during entrance and retains the separate moving presentation poses',()=>{
  const normal=createWardrobePose(rig,'normal'),entry=createWardrobeEntrance(rig,normal);
  for(const track of normal.tracks)for(const time of [0,.35,.7,1.4]){
   const name=track.name.replace('.quaternion','');
   expectRotation(rotationAt(entry,name,time),rotationAt(normal,name,0));
  }
  for(const style of ['boy','cute'] as const){
   const clip=createWardrobePose(rig,style);
   expect(rotationAt(clip,'head',0).angleTo(rotationAt(clip,'head',1))).toBeGreaterThan(.01);
   expect(rotationAt(clip,'R_upperArm',0).angleTo(rotationAt(normal,'R_upperArm',0))).toBeGreaterThan(.1);
  }
 });
});
