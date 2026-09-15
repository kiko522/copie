export const clone=value=>JSON.parse(JSON.stringify(value));
export const STEP=.2;
export const DIRECTIONS={left:[-1,0,0],right:[1,0,0],front:[0,1,0],back:[0,-1,0],up:[0,0,1],down:[0,0,-1]};
export const PALETTE=['#A99BE8','#F2B8D5','#91C9F4','#A5B99A','#E8BD8F','#FFF2E3'];
export const uid=()=>globalThis.crypto.randomUUID();
export function createHome(catalog){
 const starter=catalog.filter(a=>a.surface!=='tabletop'&&!['shell','worktable','small_plant','trailing_plant','nightstand','left_shelf'].includes(a.id));
 const room={id:uid(),name:'水母小屋',x:0,z:0,level:0,wall:'#FFF2E3',items:starter.map(a=>({id:uid(),assetId:a.id,x:a.default[0],y:a.default[1],z:a.default[2],rotation:0,color:null,stored:false}))};
 const pouf=room.items.find(i=>i.assetId==='pouf');if(pouf){pouf.x=1.38;pouf.z=2.06}
 for(const i of room.items){const a=catalog.find(a=>a.id===i.assetId);if(['back','left'].includes(a.surface))i.y=Math.min(i.y,4.9-a.size[1]);}
 addStarterProps(room,catalog);
 return {version:1,assetVersion:2,activeRoomId:room.id,rooms:[room]};
}
function addStarterProps(room,catalog){
 for(const id of ['open_book','tea_mug','jelly_lamp']){const a=catalog.find(a=>a.id===id);if(a&&room.items.length<100)try{room.items.push(findPlace(a,room,catalog))}catch{}}
}
export function validateHome(raw,catalog){
 if(!raw||raw.version!==1||!Array.isArray(raw.rooms)||raw.rooms.length<1||raw.rooms.length>24)throw Error('小屋存档格式不正确');
 const assets=new Set(catalog.map(a=>a.id)),cells=new Set(),ids=new Set();
 for(const r of raw.rooms){
  if(typeof r.id!=='string'||ids.has(r.id)||typeof r.name!=='string'||r.name.length>40||![r.x,r.z,r.level].every(Number.isInteger)||Math.abs(r.x)>12||Math.abs(r.z)>12||r.level<0||r.level>5)throw Error('房间信息不正确');
  ids.add(r.id);const key=[r.x,r.z,r.level].join();if(cells.has(key))throw Error('房间位置重复');cells.add(key);
  if(!/^#[0-9a-f]{6}$/i.test(r.wall)||!Array.isArray(r.items)||r.items.length>100)throw Error('房间内容不正确');
  for(const part of ['trim','floor'])if(r[part]!=null&&!/^#[0-9a-f]{6}$/i.test(r[part]))throw Error('房屋颜色不正确');
  for(const i of r.items){
   if(typeof i.id!=='string'||ids.has(i.id)||!assets.has(i.assetId)||i.assetId==='shell'||![i.x,i.y,i.z,i.rotation].every(Number.isFinite)||Math.abs(i.x)>8||Math.abs(i.z)>8||i.y<-.5||i.y>8||![0,90,180,270].includes(i.rotation)||typeof i.stored!=='boolean'||i.color!==null&&!/^#[0-9a-f]{6}$/i.test(i.color))throw Error('家具信息不正确');
   ids.add(i.id);
  }
 }
 if(!raw.rooms.some(r=>r.id===raw.activeRoomId))throw Error('找不到当前房间');
 const result=clone(raw);
 for(const room of result.rooms){
  for(const i of room.items)if(i.supportId!=null){
   const parent=room.items.find(p=>p.id===i.supportId);
   if(typeof i.supportId!=='string'||!parent||parent.id===i.id||!catalog.find(a=>a.id===parent.assetId)?.support||catalog.find(a=>a.id===i.assetId)?.surface!=='tabletop'||parent.stored!==i.stored)throw Error('台面承托关系不正确');
   if(!i.stored&&supportError(i,room,catalog))throw Error('桌上物件超出台面');
  }
  if(!result.assetVersion){for(const i of room.items)if(catalog.find(a=>a.id===i.assetId)?.surface==='tabletop'&&!i.supportId)i.stored=true;addStarterProps(room,catalog)}
  for(const i of room.items)if(!i.stored&&catalog.find(a=>a.id===i.assetId)?.surface==='tabletop'&&!i.supportId)throw Error('桌上物件需要台面');
 }
 result.assetVersion=2;return result;
}
export function furnitureType(a){return a.support?'table':a.surface==='rug'?'rug':a.surface==='tabletop'?'tabletop':['left','back'].includes(a.surface)?'wall':a.surface==='ceiling'?'ceiling':'floor'}
export const TYPE_LABELS={all:'全部',rug:'地毯',table:'桌台',tabletop:'桌上小物',floor:'落地',wall:'墙饰',ceiling:'吊挂'};
function supportError(i,room,catalog){
 const parent=room.items.find(p=>p.id===i.supportId&&!p.stored),a=catalog.find(a=>a.id===i.assetId),s=catalog.find(a=>a.id===parent?.assetId)?.support;
 if(!parent||!s)return '请把小物件放到桌台上';
 if(Math.abs(i.y-parent.y-s.height)>.025)return '小物件需要贴着台面';
 const angle=-parent.rotation*Math.PI/180,c=Math.cos(angle),sn=Math.sin(angle);
 for(const b of boxes(i,a))for(const x of [b[0],b[3]])for(const z of [b[2],b[5]]){
  const dx=x-parent.x,dz=z-parent.z,lx=c*dx+sn*dz,lz=-sn*dx+c*dz;
  if(s.shape==='circle'?Math.hypot(lx,lz)>s.radius+.001:Math.abs(lx)>s.width/2||Math.abs(lz)>s.depth/2)return '小物件要完整放在台面内';
 }
 return '';
}
export function snapToSupport(i,room,catalog){
 if(catalog.find(a=>a.id===i.assetId)?.surface!=='tabletop')return i;
 for(const parent of room.items){const s=catalog.find(a=>a.id===parent.assetId)?.support;if(parent.stored||!s)continue;
  const next={...i,y:parent.y+s.height,supportId:parent.id};if(!supportError(next,room,catalog))return next;
 }
 return {...i,supportId:null};
}
export function moveFurniture(room,id,patch,catalog){
 const original=room.items.find(i=>i.id===id);if(!original)throw Error('找不到家具');
 const next=snapToSupport({...original,...patch},room,catalog),angle=(next.rotation-original.rotation)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const candidates=room.items.map(i=>i.id===id?next:i.supportId===id?{...i,x:next.x+c*(i.x-original.x)+s*(i.z-original.z),z:next.z-s*(i.x-original.x)+c*(i.z-original.z),y:i.y+next.y-original.y,rotation:(i.rotation+next.rotation-original.rotation+360)%360}:i);
 const test={...room,items:candidates};for(const i of candidates)if(i.id===id||i.supportId===id){const why=placementError(i,test,catalog);if(why)throw Error(why)}
 room.items=candidates;
}
export function addRoom(home,direction){
 const room=home.rooms.find(r=>r.id===home.activeRoomId),delta=DIRECTIONS[direction];
 if(!delta)throw Error('未知扩建方向');
 const [x,z,level]=[room.x+delta[0],room.z+delta[1],room.level+delta[2]];
 const existing=home.rooms.find(r=>r.x===x&&r.z===z&&r.level===level);
 if(existing){home.activeRoomId=existing.id;return existing}
 if(home.rooms.length>=24)throw Error('这座小屋最多可以有 24 个房间');
 if(level<0||level>5||Math.abs(x)>12||Math.abs(z)>12)throw Error('已经到达扩建边界（最多六层）');
 if(level>0&&!home.rooms.some(r=>r.x===x&&r.z===z&&r.level===level-1))throw Error('先在下面扩建一间房，再往上盖');
 const next={id:uid(),name:`新房间 ${home.rooms.length+1}`,x,z,level,wall:'#FFF2E3',items:[]};
 home.rooms.push(next);home.activeRoomId=next.id;return next;
}
function boxes(item,asset){
 const a=item.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 return asset.boxes.map(b=>{
  const p=[[b[0],b[2]],[b[0],b[5]],[b[3],b[2]],[b[3],b[5]]].map(([x,z])=>[item.x+c*x+s*z,item.z-s*x+c*z]);
  return [Math.min(...p.map(v=>v[0])),item.y+b[1],Math.min(...p.map(v=>v[1])),Math.max(...p.map(v=>v[0])),item.y+b[4],Math.max(...p.map(v=>v[1]))];
 });
}
export function placementError(item,room,catalog){
 const a=catalog.find(a=>a.id===item.assetId);if(!a)return '找不到这件家具';
 if(a.surface==='tabletop'){const why=supportError(item,room,catalog);if(why)return why}
 const turned=item.rotation%180!==0,halfX=a.size[turned?2:0]/2,halfZ=a.size[turned?0:2]/2;
 if(a.surface==='floor'||a.surface==='rug'){
  if(Math.abs(item.x)+halfX>3.01||Math.abs(item.z)+halfZ>2.55) return '家具要完整放在地板内';
 }
 if(a.surface==='back'&&(Math.abs(item.x)+a.size[0]/2>2.98||item.y<.15||item.y+a.size[1]>4.92))return '请放在后墙范围内';
 if(a.surface==='left'&&(Math.abs(item.z)+a.size[2]/2>2.5||item.y<.15||item.y+a.size[1]>4.92))return '请放在左墙范围内';
 const mine=boxes(item,a);
 for(const other of room.items){
  if(other.id===item.id||other.stored||other.id===item.supportId||other.supportId===item.id)continue;const b=catalog.find(a=>a.id===other.assetId);if(!b)continue;
  for(const u of mine)for(const v of boxes(other,b)){
   if(u[0]<v[3]-.045&&u[3]>v[0]+.045&&u[1]<v[4]-.045&&u[4]>v[1]+.045&&u[2]<v[5]-.045&&u[5]>v[2]+.045)return `这里会碰到${b.name}`;
  }
 }
 return '';
}
export function findPlace(asset,room,catalog,itemId=uid()){
 const item={id:itemId,assetId:asset.id,x:asset.default[0],y:asset.default[1],z:asset.default[2],rotation:0,color:null,stored:false};
 if(asset.surface==='tabletop'){
  const preferred=snapToSupport(item,room,catalog);if(!placementError(preferred,room,catalog))return preferred;
  for(const parent of room.items){if(parent.stored||!catalog.find(a=>a.id===parent.assetId)?.support)continue;
   for(let z=-.8;z<=.8;z+=.12)for(let x=-.8;x<=.8;x+=.12){const test=snapToSupport({...item,x:parent.x+x,z:parent.z+z},room,catalog);if(!placementError(test,room,catalog))return test}
  }
  throw Error('没有可用台面，先放一张桌台，或收纳桌上的物件');
 }
 if(['floor','rug'].includes(asset.surface))item.y=.15;
 if(['back','left'].includes(asset.surface))item.y=Math.min(item.y,4.9-asset.size[1]);
 if(!placementError(item,room,catalog))return item;
 for(let z=-2.2;z<=2.2;z+=.25)for(let x=-2.7;x<=2.7;x+=.25){
  const test={...item,x:asset.surface==='left'?item.x:x,z:asset.surface==='back'?item.z:z};
  if(!placementError(test,room,catalog))return test;
 }
 throw Error('房间里暂时放不下，先收纳一些家具或扩建一间房');
}
