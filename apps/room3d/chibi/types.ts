export type Parts = Record<string, HTMLImageElement>;
export type HairMode='wrap'|'project';
export interface HairLayer { length:number; width:number; offsetY:number; distance:number; mode?:HairMode; offsetX?:number; offsetZ?:number; puff?:number; }
export interface ExtraHair extends HairLayer { id:string; source:string; src?:string; }
export interface HairSettings { layers:Record<string,HairLayer>; extras:ExtraHair[]; assetModes?:Record<string,HairMode>; assets?:Record<string,string>; }
// Reviewed against the shipped PNGs: buns, ponytails, tufts and cat ears.
export const builtinHairModes:Record<string,HairMode>=Object.fromEntries(['back2_05','back2_06','back2_07','back2_010','back2_011','back2_012','back2_013','back2_014'].map(id=>[id,'project']));
export function hairMode(settings:HairSettings|undefined,key:string):HairMode{
 const id=settings?.assets?.[key];
 return (id&&settings?.assetModes?.[id])||(id&&builtinHairModes[id])||settings?.layers[key]?.mode||'wrap';
}
export function selectedHairAssets(state:unknown):Record<string,string>{
 const selected=(state as {selected?:Record<string,unknown>}|undefined)?.selected;
 return Object.fromEntries(['fronthair','earhair','back1','back2'].flatMap(key=>typeof selected?.[key]==='string'?[[key,selected[key] as string]]:[]));
}
export const defaultHairLayer:HairLayer={length:1,width:1,offsetY:0,distance:0,offsetX:0,offsetZ:0,puff:.16};
export type Motion = 'idle' | 'wave' | 'wave-cute' | 'wave-calm' | 'sleep' | 'angry' | 'walk' | 'dance';
