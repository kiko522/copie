// Seat coordinates are in the normalized furniture's local frame: +Y up, +Z front.
export function seatTransform(room,catalog,selection){
 if(!selection||selection.roomId!==room.id)return null;
 const item=room.items.find(i=>i.id===selection.itemId&&!i.stored);
 const seat=catalog.find(a=>a.id===item?.assetId)?.seats?.find(s=>s.id===selection.seatId);
 if(!item||!seat)return null;
 const angle=item.rotation*Math.PI/180,[x,y,z]=seat.position;
 return {position:[item.x+x*Math.cos(angle)+z*Math.sin(angle),item.y+y,item.z-x*Math.sin(angle)+z*Math.cos(angle)],rotation:angle+(seat.rotation??0)*Math.PI/180};
}
export function roomSeats(room,catalog){
 return room.items.filter(i=>!i.stored).flatMap(item=>{
  const asset=catalog.find(a=>a.id===item.assetId);
  return (asset?.seats??[]).map(seat=>({roomId:room.id,itemId:item.id,seatId:seat.id,label:asset.name+(asset.seats.length>1?' · '+seat.label:'')}));
 });
}
