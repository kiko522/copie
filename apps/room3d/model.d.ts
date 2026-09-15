import type {Home3DItem,Home3DRoom,Home3DState} from './types';
export interface HomeAsset {id:string;name:string;surface:string;size:number[];default:number[];boxes:number[][];support?:{shape:string;radius?:number;height:number;width?:number;depth?:number}}
export const TYPE_LABELS:Record<string,string>;
export function furnitureType(asset:HomeAsset):string;
export function snapToSupport(item:Home3DItem,room:Home3DRoom,catalog:HomeAsset[]):Home3DItem;
export function moveFurniture(room:Home3DRoom,id:string,patch:Partial<Home3DItem>,catalog:HomeAsset[]):void;
export const PALETTE:string[];
export const STEP:number;
export const DIRECTIONS:Record<string,number[]>;
export function clone<T>(value:T):T;
export function uid():string;
export function createHome(catalog:HomeAsset[]):Home3DState;
export function validateHome(raw:unknown,catalog:HomeAsset[]):Home3DState;
export function addRoom(home:Home3DState,direction:string):Home3DRoom;
export function placementError(item:Home3DItem,room:Home3DRoom,catalog:HomeAsset[]):string;
export function findPlace(asset:HomeAsset,room:Home3DRoom,catalog:HomeAsset[],itemId?:string):Home3DItem;
