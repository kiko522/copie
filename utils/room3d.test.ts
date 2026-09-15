import {describe,it,expect} from 'vitest';
import catalog from '../public/room3d/catalog.json';
import {createHome,addRoom,validateHome,placementError,findPlace,clone,moveFurniture,snapToSupport,findResidentSpot} from '../apps/room3d/model.js';
import {stripSensitiveCardFields} from './characterCard';
describe('modular homes',()=>{
 it('finds resident floor space in the furnished starter without changing the layout',()=>{
  const r=createHome(catalog).rooms[0],before=clone(r);
  expect(findResidentSpot(r,catalog)).not.toBeNull();expect(r).toEqual(before);
 });
 it('does not force a resident into an occupied room, but ignores stored obstacles',()=>{
  const r=createHome(catalog).rooms[0];
  const blocker={...catalog[0],id:'blocker',surface:'floor',boxes:[[-4,0,-4,4,4,4]]};
  r.items=[{id:'blocker',assetId:'blocker',x:0,y:0,z:0,rotation:0,color:null,stored:false}];
  expect(findResidentSpot(r,[blocker])).toBeNull();
  r.items[0].stored=true;expect(findResidentSpot(r,[blocker])).not.toBeNull();
 });
 it('requires a usable support and rejects overhang and occupied tabletop space',()=>{
  const r=createHome(catalog).rooms[0];r.items=[];
  const mug=catalog.find(a=>a.id==='tea_mug')!;
  expect(()=>findPlace(mug,r,catalog)).toThrow('台面');
  const table=findPlace(catalog.find(a=>a.id==='table')!,r,catalog);r.items.push(table);
  const cup=findPlace(mug,r,catalog);r.items.push(cup);
  expect(cup.supportId).toBe(table.id);
  expect(placementError({...cup,id:'duplicate'},r,catalog)).toContain('碰到');
  expect(placementError({...cup,x:table.x+1},r,catalog)).toContain('台面');
  expect(placementError({...cup,supportId:null},r,catalog)).toContain('桌台');
 });
 it('moves and rotates supported objects together, and rejects a whole-group collision atomically',()=>{
  const r=createHome(catalog).rooms[0];r.items=r.items.filter(i=>i.assetId==='table'||i.supportId);
  const table=r.items.find(i=>i.assetId==='table')!,children=r.items.filter(i=>i.supportId===table.id),before=clone(r);
  moveFurniture(r,table.id,{x:table.x-.2,rotation:90},catalog);
  for(const child of children){const now=r.items.find(i=>i.id===child.id)!;expect(now.x).toBeCloseTo(table.x-.2+child.z-table.z);expect(now.z).toBeCloseTo(table.z-child.x+table.x);expect(now.rotation).toBe(90)}
  const good=clone(r);expect(()=>moveFurniture(r,table.id,{x:8},catalog)).toThrow();expect(r).toEqual(good);expect(r).not.toEqual(before);
  const bad=createHome(catalog);bad.rooms[0]=clone(r);bad.activeRoomId=r.id;bad.rooms[0].items.find(i=>i.supportId)!.supportId='missing';expect(()=>validateHome(bad,catalog)).toThrow('承托');
 });
 it('migrates old layouts without discarding their room or furniture identities',()=>{
  const s=createHome(catalog);delete s.assetVersion;s.rooms[0].items=s.rooms[0].items.filter(i=>!i.supportId);
  const id=s.rooms[0].items.find(i=>i.assetId==='table')!.id,next=validateHome(s,catalog);
  expect(next.rooms[0].items.find(i=>i.id===id)).toBeTruthy();expect(next.rooms[0].items.some(i=>i.supportId===id)).toBe(true);
  expect(validateHome(next,catalog)).toEqual(next);
 });
 it('starts with walkable floor furniture and no intersecting placement volumes',()=>{
  const r=createHome(catalog).rooms[0];
  const invalid=r.items.map(i=>({asset:i.assetId,error:placementError(i,r,catalog)})).filter(v=>v.error);
  expect(invalid).toEqual([]);
 });
 it('adds adjacent rooms and supported floors without duplicate cells',()=>{
  const s=createHome(catalog),first=s.activeRoomId;
  const right=addRoom(s,'right');expect(right.x).toBe(1);expect(right.items).toEqual([]);
  addRoom(s,'up');expect(s.rooms.at(-1)?.level).toBe(1);
  expect(()=>addRoom(s,'right')).toThrow('下面');
  addRoom(s,'down');expect(s.activeRoomId).toBe(right.id);expect(s.rooms).toHaveLength(3);
  addRoom(s,'left');expect(s.activeRoomId).toBe(first);
  expect(()=>addRoom(s,'down')).toThrow();
 });
 it('rejects corrupt or unknown furniture data without mutating the current home',()=>{
  const original=createHome(catalog),bad=clone(original);bad.rooms[0].items[0].x=Infinity;
  expect(()=>validateHome(bad,catalog)).toThrow();expect(Number.isFinite(original.rooms[0].items[0].x)).toBe(true);
  bad.rooms[0].items[0].x=0;bad.rooms[0].items[0].assetId='unknown';expect(()=>validateHome(bad,catalog)).toThrow();
  expect(validateHome(original,catalog)).toEqual(original);
 });
 it('checks floor bounds, rotation, stored items and actual collisions',()=>{
  const room=createHome(catalog).rooms[0];room.items=[];
  const sofa=findPlace(catalog.find(a=>a.id==='sofa')!,room,catalog);room.items.push(sofa);
  const second={...sofa,id:'another'};
  expect(placementError(second,room,catalog)).toContain('碰到');
  expect(placementError({...sofa,x:8},room,catalog)).toContain('地板');
  sofa.stored=true;expect(placementError(second,room,catalog)).toBe('');
 });
 it('lets a working desk occupy the usable space under a loft',()=>{
  const s=createHome(catalog),r=s.rooms[0];r.items=r.items.filter(i=>['loft','desk'].includes(i.assetId));
  const desk=r.items.find(i=>i.assetId==='desk')!;
  expect(placementError(desk,r,catalog)).toBe('');
 });
 it('keeps recoloring and storage per instance through a JSON round trip',()=>{
  const s=createHome(catalog),r=s.rooms[0],first=r.items.find(i=>i.assetId==='sofa')!;
  const second={...first,id:'duplicate',color:'#A5B99A',stored:true};r.items.push(second);
  const next=validateHome(JSON.parse(JSON.stringify(s)),catalog);
  expect(next.rooms[0].items.find(i=>i.id===first.id)?.color).toBeNull();
  expect(next.rooms[0].items.find(i=>i.id==='duplicate')).toMatchObject({stored:true,color:'#A5B99A'});
 });
 it('does not attach private home layouts to shared character cards',()=>{
  const data={name:'Test',home3D:createHome(catalog),roomConfig:{items:[]}};
  expect(stripSensitiveCardFields(data)).not.toHaveProperty('home3D');expect(data).toHaveProperty('home3D');
 });
});
