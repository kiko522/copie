export interface Home3DItem {id:string;assetId:string;x:number;y:number;z:number;rotation:number;color:string|null;stored:boolean;supportId?:string|null}
export interface Home3DRoom {id:string;name:string;x:number;z:number;level:number;wall:string;trim?:string;floor?:string;items:Home3DItem[]}
export interface Home3DState {version:1;assetVersion?:number;activeRoomId:string;rooms:Home3DRoom[]}
