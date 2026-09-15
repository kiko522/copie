import type {ChibiVisitor} from './chibi/visitor';
import type {Home3DState} from './types';
export interface HomeEditor {dispose():void;setSuspended?(value:boolean):void;setVisitor?(visitor:ChibiVisitor|null):void;getState?():Home3DState;inspect?():unknown;advanceTime?(ms:number):void}
export function mountHomeEditor(host:HTMLElement,options:{assetBase:string;initialState?:Home3DState;onChange?:(state:Home3DState)=>void;onBack?:()=>void;storageKey?:string;signal?:AbortSignal}):Promise<HomeEditor>;
