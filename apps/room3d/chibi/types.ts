export type Parts = Record<string, HTMLImageElement>;
export interface HairLayer { length:number; width:number; offsetY:number; distance:number; }
export interface ExtraHair extends HairLayer { id:string; source:string; src?:string; }
export interface HairSettings { layers:Record<string,HairLayer>; extras:ExtraHair[]; }
export const defaultHairLayer:HairLayer={length:1,width:1,offsetY:0,distance:0};
export type Motion = 'idle' | 'wave' | 'wave-cute' | 'wave-calm' | 'sleep' | 'angry' | 'walk' | 'dance';
